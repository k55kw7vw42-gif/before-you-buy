#!/usr/bin/env node
/**
 * End-to-end smoke test for Before You Pay.
 *
 * Exercises the real HTTP surface of a running server: the scan loop, the risk
 * scoring bands, upload validation, authentication, per-user authorisation and
 * rate limiting.
 *
 *   npm run build && npm start          # in one terminal
 *   node scripts/smoke-test.mjs         # in another
 *
 * Override the target with BASE_URL. Requires a server started with a clean
 * database for the rate-limit and history assertions to be meaningful.
 */

import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** A tiny, valid PNG built without any image library. */
function makePng(width = 64, height = 64) {
  const chunk = (type, data) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * 3 + 1);
    for (let x = 0; x < width; x += 1) row[1 + x * 3] = (x + y) % 256;
    rows.push(row);
  }
  // zlib deflate stream; PNG accepts any valid zlib-wrapped deflate.
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Minimal cookie jar so each identity in the test keeps its own session. */
function newJar() {
  const jar = new Map();
  return {
    header: () =>
      [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (response) => {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === "" ) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

async function request(jar, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${BASE}${path}`, { ...options, headers, redirect: "manual" });
  jar?.absorb(response);
  return response;
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The analysis endpoints are rate limited on purpose, and this suite spends
 * most of a window. When a run lands on top of a previous one, wait the window
 * out rather than reporting a false failure. The rate-limiting section sets
 * `expectRateLimit` so its own 429 is not swallowed.
 */
let expectRateLimit = false;

async function withRateLimitRetry(send) {
  let response = await send();
  if (response.status === 429 && !expectRateLimit) {
    const wait = Number(response.headers.get("retry-after") ?? 60) + 1;
    console.log(`  ..   rate limit window is busy, waiting ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    response = await send();
  }
  return response;
}

async function scanImage(jar, context, { filename = "offer.png", body: overrideBody } = {}) {
  const bytes = overrideBody ?? makePng();
  const response = await withRateLimitRetry(() => {
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), filename);
    if (context) form.append("context", context);
    return request(jar, "/api/analyze/image", { method: "POST", body: form });
  });
  return { response, data: await json(response) };
}

async function scanLink(jar, url) {
  const response = await withRateLimitRetry(() =>
    request(jar, "/api/analyze/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
  return { response, data: await json(response) };
}

async function readScan(jar, id) {
  const response = await request(jar, `/api/scans/${id}`);
  return { response, data: await json(response) };
}

const GIFT_CARD_CASE =
  "They contacted me first and want a 250 deposit today in Apple gift cards, said other buyers are waiting, and asked me to continue on WhatsApp.";

async function main() {
  console.log(`Before You Pay - smoke test against ${BASE}`);

  // -- Pages render -------------------------------------------------------
  section("Pages");
  for (const path of ["/", "/scan", "/link", "/login", "/signup"]) {
    const response = await request(null, path);
    check(`GET ${path} renders`, response.status === 200, `status ${response.status}`);
  }
  {
    const response = await request(null, "/history");
    check(
      "GET /history redirects anonymous visitors to login",
      response.status === 307 || response.status === 302,
      `status ${response.status}`,
    );
  }

  // -- Health probe -------------------------------------------------------
  section("Health probe");
  {
    const response = await request(null, "/api/health");
    const body = await json(response);
    check("GET /api/health returns 200", response.status === 200, `status ${response.status}`);
    check("it reports ok", body?.status === "ok", JSON.stringify(body));
    check("it works with no session and no cookies", (response.headers.getSetCookie?.() ?? []).length === 0);
    check(
      "it is not cached",
      /no-store/.test(response.headers.get("cache-control") ?? ""),
      response.headers.get("cache-control") ?? "(none)",
    );
    // A liveness probe must not disclose configuration.
    const text = JSON.stringify(body ?? {});
    check(
      "it discloses nothing about the deployment",
      !/sk-|sk_|whsec|DATABASE|password|email/i.test(text),
      text,
    );
  }

  // -- Core loop as a guest ----------------------------------------------
  section("Core loop (guest)");
  const guest = newJar();
  const { response: scanResponse, data: scanData } = await scanImage(guest, GIFT_CARD_CASE);
  check("screenshot scan succeeds", scanResponse.status === 200 && !!scanData?.id, `status ${scanResponse.status}`);

  if (!scanData?.id) {
    console.log("\nCannot continue without a successful scan. Response was:", scanData);
    process.exitCode = 1;
    return;
  }
  const scanId = scanData.id;
  const { data: read } = await readScan(guest, scanId);
  const scan = read?.scan;
  check("result is readable by the guest that created it", !!scan);
  check(
    "gift-card + deposit + urgency + off-platform scores High Risk",
    scan?.level === "high" && scan.score >= 61,
    `got ${scan?.score} (${scan?.level})`,
  );
  check("warning signs are returned", (scan?.warningSigns?.length ?? 0) >= 3, `${scan?.warningSigns?.length} signs`);
  check(
    "gift card warning is present",
    scan?.warningSigns?.some((w) => w.code === "gift_card_payment"),
  );
  check("recommendations are returned", (scan?.recommendations?.length ?? 0) >= 3);
  check("extracted fields are returned", (scan?.fields?.length ?? 0) >= 1);
  check(
    "no result asserts fraud outright",
    !JSON.stringify(scan).match(/\bis a scam\b|\bthis is fraud\b/i),
  );

  // -- Risk bands ---------------------------------------------------------
  section("Risk bands");
  // A legitimate site whose path happens to contain a brand name must not be
  // treated as impersonation.
  const brandInPath = await scanLink(guest, "https://github.com/apple/swift");
  const brandInPathScan = (await readScan(guest, brandInPath.data?.id)).data?.scan;
  check(
    "a brand name in the path of a legitimate domain is not called impersonation",
    !brandInPathScan?.warningSigns?.some((w) => w.code === "impersonation"),
    `got ${brandInPathScan?.score} (${brandInPathScan?.level})`,
  );
  check(
    "such a link still scores Low Risk",
    brandInPathScan?.level === "low",
    `got ${brandInPathScan?.score}`,
  );

  const clean = await scanLink(guest, "https://www.wikipedia.org/");
  const cleanScan = (await readScan(guest, clean.data?.id)).data?.scan;
  check(
    "an ordinary https link scores Low Risk",
    cleanScan?.level === "low" && cleanScan.score <= 30,
    `got ${cleanScan?.score} (${cleanScan?.level})`,
  );

  const hostile = await scanLink(
    guest,
    "http://paypal.secure-billing-update.verify-account.tk/login/confirm?id=99",
  );
  const hostileScan = (await readScan(guest, hostile.data?.id)).data?.scan;
  check(
    "a lookalike payment link scores High Risk",
    hostileScan?.level === "high",
    `got ${hostileScan?.score} (${hostileScan?.level})`,
  );
  check(
    "the several address problems merge into one warning sign",
    hostileScan?.warningSigns?.filter((w) => w.code === "suspicious_url").length === 1,
  );
  check(
    "brand-in-subdomain is flagged as possible impersonation",
    hostileScan?.warningSigns?.some((w) => w.code === "impersonation"),
  );
  check(
    "scores stay inside 0-100",
    [scan, cleanScan, hostileScan, brandInPathScan].every(
      (s) => s && s.score >= 0 && s.score <= 100,
    ),
  );

  // -- Authorisation ------------------------------------------------------
  section("Authorisation");
  const stranger = newJar();
  await request(stranger, "/api/auth/me");
  const strangerRead = await readScan(stranger, scanId);
  check("another visitor cannot read the scan", strangerRead.response.status === 404);

  const noCookie = await request(null, `/api/scans/${scanId}`);
  check("a request with no cookies cannot read the scan", noCookie.status === 404);

  const strangerPage = await request(stranger, `/results/${scanId}`);
  check("the results page 404s for another visitor", strangerPage.status === 404);

  const ownerPage = await request(guest, `/results/${scanId}`);
  check("the results page renders for the owner", ownerPage.status === 200);

  const historyAnon = await request(null, "/api/scans");
  check("history API rejects anonymous callers", historyAnon.status === 401);

  // -- Upload validation --------------------------------------------------
  section("Upload validation");
  const notAnImage = await scanImage(guest, null, { body: Buffer.from("this is not a png at all") });
  check(
    "a text file renamed .png is rejected",
    notAnImage.response.status === 415,
    `status ${notAnImage.response.status}`,
  );

  const oversized = await scanImage(guest, null, { body: Buffer.alloc(9 * 1024 * 1024, 1) });
  check(
    "an oversized upload is rejected",
    oversized.response.status === 413 || oversized.response.status === 415,
    `status ${oversized.response.status}`,
  );

  const noFile = await withRateLimitRetry(() =>
    request(guest, "/api/analyze/image", { method: "POST", body: new FormData() }),
  );
  check("a request with no file is rejected", noFile.status === 400, `status ${noFile.status}`);

  const badUrl = await scanLink(guest, "javascript:alert(1)");
  check("a non-http scheme is rejected", badUrl.response.status === 400, `status ${badUrl.response.status}`);

  const emptyUrl = await scanLink(guest, "   ");
  check("an empty link is rejected", emptyUrl.response.status === 400);

  // -- Accounts -----------------------------------------------------------
  section("Accounts");
  const stamp = Date.now();
  const alice = guest; // the guest signs up, so their scans should carry over
  const aliceEmail = `alice-${stamp}@example.test`;

  const signup = await request(alice, "/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: aliceEmail, password: "correct-horse-battery" }),
  });
  check("signup succeeds", signup.status === 200, `status ${signup.status}`);

  const dupe = await request(newJar(), "/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: aliceEmail, password: "correct-horse-battery" }),
  });
  check("duplicate signup is rejected", dupe.status === 409, `status ${dupe.status}`);

  const weak = await request(newJar(), "/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `weak-${stamp}@example.test`, password: "short" }),
  });
  check("a short password is rejected", weak.status === 400, `status ${weak.status}`);

  const history = await json(await request(alice, "/api/scans"));
  check(
    "scans run before signing up are carried into the account",
    (history?.scans?.length ?? 0) >= 3,
    `${history?.scans?.length} scans`,
  );
  check(
    "history entries carry score, level and summary",
    history?.scans?.every((s) => typeof s.score === "number" && s.level && s.summary),
  );

  const historyPage = await request(alice, "/history");
  check("history page renders for a signed-in user", historyPage.status === 200);

  // A second account must not see the first one's scans.
  const bob = newJar();
  await request(bob, "/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `bob-${stamp}@example.test`, password: "correct-horse-battery" }),
  });
  const bobRead = await readScan(bob, scanId);
  check("a different account cannot read the first account's scan", bobRead.response.status === 404);
  const bobHistory = await json(await request(bob, "/api/scans"));
  check("a new account's history is empty", (bobHistory?.scans?.length ?? 0) === 0);

  // Login: wrong password, then the right one.
  const wrong = await request(newJar(), "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: aliceEmail, password: "not-the-password" }),
  });
  check("login with the wrong password fails", wrong.status === 401, `status ${wrong.status}`);

  const aliceAgain = newJar();
  const login = await request(aliceAgain, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: aliceEmail, password: "correct-horse-battery" }),
  });
  check("login with the right password succeeds", login.status === 200, `status ${login.status}`);
  const relogHistory = await json(await request(aliceAgain, "/api/scans"));
  check("history survives a fresh login", (relogHistory?.scans?.length ?? 0) >= 3);

  // Logout clears the session.
  await request(aliceAgain, "/api/auth/logout", { method: "POST" });
  const afterLogout = await request(aliceAgain, "/api/scans");
  check("history is inaccessible after logout", afterLogout.status === 401, `status ${afterLogout.status}`);

  // -- Rate limiting ------------------------------------------------------
  section("Rate limiting");
  expectRateLimit = true;
  const limited = newJar();
  await request(limited, "/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `flood-${stamp}@example.test`, password: "correct-horse-battery" }),
  });
  let sawLimit = false;
  let retryAfter = null;
  for (let i = 0; i < 14; i += 1) {
    const { response } = await scanLink(limited, `https://example.com/page-${i}`);
    if (response.status === 429) {
      sawLimit = true;
      retryAfter = response.headers.get("retry-after");
      break;
    }
  }
  check("the analysis endpoint rate limits a burst", sawLimit);
  check("the 429 carries a Retry-After header", !!retryAfter, `got ${retryAfter}`);

  // -- Report -------------------------------------------------------------
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nSmoke test crashed:", err);
  process.exitCode = 1;
});
