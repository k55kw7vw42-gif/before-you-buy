#!/usr/bin/env node
/**
 * Tests Sign in with Google end to end against a stubbed Google.
 *
 *   npm run build && npm run test:google
 *
 * Google's three endpoints are served locally (GOOGLE_OAUTH_BASE), so no client
 * credentials and no network are needed. Our own half of the flow is real: the
 * state check, the account matching, the session, and the refusal cases.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const GOOGLE_PORT = 3151;
const APP_PORT = 3150;
const APP = `http://127.0.0.1:${APP_PORT}`;

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

// What the stubbed Google reports back, keyed by the one-time code.
const PROFILES = {
  "code-new": { sub: "google-uid-1", email: "newcomer@example.test", email_verified: true },
  "code-again": { sub: "google-uid-1", email: "newcomer@example.test", email_verified: true },
  "code-unverified": { sub: "google-uid-2", email: "sketchy@example.test", email_verified: false },
  "code-existing": { sub: "google-uid-3", email: "PASSWORD-USER", email_verified: true },
};

let tokenRequests = [];

const googleStub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://stub");
    const send = (payload, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === "/token") {
      const params = new URLSearchParams(body);
      tokenRequests.push(Object.fromEntries(params));
      const code = params.get("code");
      if (!PROFILES[code]) return send({ error: "invalid_grant" }, 400);
      return send({ access_token: `tok:${code}`, token_type: "Bearer" });
    }

    if (url.pathname === "/userinfo") {
      const token = (req.headers.authorization ?? "").replace("Bearer ", "");
      const profile = PROFILES[token.replace("tok:", "")];
      if (!profile) return send({ error: "invalid_token" }, 401);
      return send(profile);
    }

    // /auth is never called by the server - the browser would go there.
    return send({ error: "not_found" }, 404);
  });
});

async function requirePortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
  } catch {
    return;
  }
  console.error(`\nPort ${port} is already in use. Stop the leftover server:\n  pkill -f next-server\n`);
  process.exit(1);
}

function newJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (r) => {
      for (const raw of r.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      }
    },
    get: (name) => jar.get(name),
  };
}

async function req(jar, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  const r = await fetch(`${APP}${path}`, {
    ...options,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  jar?.absorb(r);
  return r;
}

/** Walks the browser half of the flow: start, then come back with a code. */
async function signInWithGoogle(jar, code, { tamperState = null } = {}) {
  const start = await req(jar, "/api/auth/google?next=/scan");
  const location = start.headers.get("location") ?? "";
  const state = new URL(location, APP).searchParams.get("state");
  const used = tamperState ?? state;
  const callback = await req(jar, `/api/auth/google/callback?code=${code}&state=${used}`);
  return { start, location, state, callback };
}

const me = async (jar) => (await req(jar, "/api/auth/me")).json();

async function main() {
  await requirePortFree(APP_PORT);
  await new Promise((r) => googleStub.listen(GOOGLE_PORT, "127.0.0.1", r));

  const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GOOGLE_OAUTH_BASE: `http://127.0.0.1:${GOOGLE_PORT}`,
      NEXTAUTH_URL: APP,
      DATABASE_PATH: "./data/verify-google.db",
      RATE_LIMIT_MAX: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  app.stdout.on("data", (d) => appLog.push(d.toString()));
  app.stderr.on("data", (d) => appLog.push(d.toString()));

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        const r = await fetch(APP, { redirect: "manual" });
        if (r.status < 500) break;
      } catch {
        /* not up */
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // ---- Starting the flow ------------------------------------------------
    section("Starting the flow");
    const jar = newJar();
    const start = await req(jar, "/api/auth/google?next=/scan");
    check("it redirects the browser onward", start.status === 307 || start.status === 302, `status ${start.status}`);

    const target = new URL(start.headers.get("location") ?? "", APP);
    check("it redirects to Google", target.pathname.endsWith("/auth"), target.toString());
    check("it sends our client id", target.searchParams.get("client_id") === "test-client-id.apps.googleusercontent.com");
    check("it asks for the email scope", (target.searchParams.get("scope") ?? "").includes("email"));
    check("it uses the authorization-code flow", target.searchParams.get("response_type") === "code");
    check(
      "the redirect_uri points back at our callback",
      target.searchParams.get("redirect_uri") === `${APP}/api/auth/google/callback`,
      target.searchParams.get("redirect_uri"),
    );
    check("it carries a state value", (target.searchParams.get("state") ?? "").length >= 16);
    check("the state is stored in a cookie for the callback to check", !!jar.get("byp_oauth_state"));

    const loginPage = await req(null, "/login").then((r) => r.text());
    check("the login page offers the Google button", /Continue with Google/.test(loginPage));
    const signupPage = await req(null, "/signup").then((r) => r.text());
    check("the signup page offers it too", /Sign up with Google/.test(signupPage));

    // ---- A forged callback ------------------------------------------------
    section("Rejecting a forged callback");
    const forged = newJar();
    const forgedFlow = await signInWithGoogle(forged, "code-new", { tamperState: "not-the-state" });
    check(
      "a mismatched state is rejected",
      (forgedFlow.callback.headers.get("location") ?? "").includes("error=google_state"),
      forgedFlow.callback.headers.get("location"),
    );
    check("no session is created", (await me(forged)).user === null);

    const noState = newJar();
    const bare = await req(noState, "/api/auth/google/callback?code=code-new&state=whatever");
    check(
      "a callback with no stored state is rejected",
      (bare.headers.get("location") ?? "").includes("error=google_state"),
    );
    check("still no session", (await me(noState)).user === null);

    // ---- The happy path ---------------------------------------------------
    section("Signing in");
    const alice = newJar();
    const flow = await signInWithGoogle(alice, "code-new");
    check(
      "a valid callback lands on the page we asked for",
      (flow.callback.headers.get("location") ?? "").endsWith("/scan"),
      flow.callback.headers.get("location"),
    );

    const aliceUser = (await me(alice)).user;
    check("the session belongs to the Google account", aliceUser?.email === "newcomer@example.test", JSON.stringify(aliceUser));
    check("the state cookie is cleared after use", !alice.get("byp_oauth_state"));

    const exchange = tokenRequests.at(-1);
    check("the code was exchanged server-side", exchange?.code === "code-new");
    check("the exchange sent the client secret", exchange?.client_secret === "test-client-secret");
    check("it used the authorization_code grant", exchange?.grant_type === "authorization_code");

    // The session must be a real one: scanning requires an account.
    const scanPage = await req(alice, "/scan").then((r) => r.text());
    check(
      "the signed-in user can reach the scanner",
      !/Create an account to scan/.test(scanPage),
    );

    // ---- Signing in again -------------------------------------------------
    section("Signing in again");
    const aliceAgain = newJar();
    await signInWithGoogle(aliceAgain, "code-again");
    const second = (await me(aliceAgain)).user;
    check("the same Google account maps to the same user", second?.id === aliceUser?.id, `${second?.id} vs ${aliceUser?.id}`);

    // ---- An unverified Google email ---------------------------------------
    section("Refusing an unverified email");
    const sketchy = newJar();
    const refused = await signInWithGoogle(sketchy, "code-unverified");
    check(
      "an unverified Google email is refused",
      (refused.callback.headers.get("location") ?? "").includes("error=google_unverified"),
      refused.callback.headers.get("location"),
    );
    check("no session is created for it", (await me(sketchy)).user === null);

    // ---- Linking to an existing password account --------------------------
    section("Linking to an existing account");
    const pwEmail = `both-${Date.now()}@example.test`;
    PROFILES["code-existing"].email = pwEmail;

    const bob = newJar();
    const signup = await req(bob, "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pwEmail, password: "correct-horse-battery" }),
    });
    check("a password account is created first", signup.status === 200, `status ${signup.status}`);
    const bobUser = (await me(bob)).user;

    const bobViaGoogle = newJar();
    await signInWithGoogle(bobViaGoogle, "code-existing");
    const linked = (await me(bobViaGoogle)).user;
    check(
      "signing in with Google lands in the same account, not a duplicate",
      linked?.id === bobUser?.id,
      `${linked?.id} vs ${bobUser?.id}`,
    );

    // The original password must keep working after linking.
    const pwLogin = newJar();
    const relog = await req(pwLogin, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pwEmail, password: "correct-horse-battery" }),
    });
    check("the password still works after linking", relog.status === 200, `status ${relog.status}`);

    // ---- A Google-only account has no password ----------------------------
    section("A Google account has no password");
    for (const guess of ["", "password", "oauth:google", "google"]) {
      const attempt = await req(newJar(), "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newcomer@example.test", password: guess }),
      });
      check(`password "${guess || "(empty)"}" is refused`, attempt.status === 401, `status ${attempt.status}`);
    }

    // ---- Guest work carries over ------------------------------------------
    section("Guest work carries over");
    const carry = newJar();
    const link = await req(carry, "/api/analyze/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/before-google" }),
    });
    check("a guest can check a link", link.status === 200, `status ${link.status}`);

    PROFILES["code-carry"] = { sub: "google-uid-4", email: `carry-${Date.now()}@example.test`, email_verified: true };
    await signInWithGoogle(carry, "code-carry");
    const history = await req(carry, "/api/scans").then((r) => r.json());
    check(
      "the link check made before signing in is in the new account",
      (history?.scans?.length ?? 0) >= 1,
      `${history?.scans?.length} scans`,
    );

    // ---- The base URL must never come from the request --------------------
    // This is the actual production bug: behind a proxy, request.url / the Host
    // header is the proxy's internal address, not the public one. If baseUrl()
    // ever regresses to deriving from the request, this must fail.
    section("Base URL never comes from the request");
    const spoofed = newJar();
    const spoofedStart = await req(spoofed, "/api/auth/google?next=/scan", {
      headers: {
        host: "0.0.0.0:10000",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "http",
      },
    });
    const spoofedTarget = new URL(spoofedStart.headers.get("location") ?? "", APP);
    const spoofedRedirectUri = spoofedTarget.searchParams.get("redirect_uri") ?? "";
    check(
      "redirect_uri uses the configured public URL, not the Host header",
      spoofedRedirectUri.startsWith(APP),
      spoofedRedirectUri,
    );
    check("redirect_uri does not contain 0.0.0.0", !spoofedRedirectUri.includes("0.0.0.0"));
    check(
      "redirect_uri does not reflect a forwarded/spoofed host",
      !spoofedRedirectUri.includes("attacker.example"),
      spoofedRedirectUri,
    );

    const spoofedState = spoofedTarget.searchParams.get("state");
    const spoofedCallback = await req(
      spoofed,
      `/api/auth/google/callback?code=code-new&state=${spoofedState}`,
      { headers: { host: "0.0.0.0:10000", "x-forwarded-host": "attacker.example" } },
    );
    const spoofedLocation = spoofedCallback.headers.get("location") ?? "";
    check(
      "the post-login redirect also uses the configured URL",
      spoofedLocation.startsWith(APP),
      spoofedLocation,
    );
    check("the post-login redirect does not leak the spoofed host", !spoofedLocation.includes("attacker.example"));

    // ---- Secrets stay server-side -----------------------------------------
    section("Secrets");
    check("no client secret in the login page", !loginPage.includes("test-client-secret"));
    check("no client secret in the server log", !appLog.join("").includes("test-client-secret"));
  } finally {
    app.kill("SIGKILL");
    googleStub.closeAllConnections?.();
    googleStub.close();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nVerification crashed:", err);
  googleStub.closeAllConnections?.();
  googleStub.close();
  process.exit(1);
});
