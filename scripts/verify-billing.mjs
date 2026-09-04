#!/usr/bin/env node
/**
 * End-to-end test of the whole paid flow:
 *
 *   upload screenshot -> vision analysis -> risk score -> warnings
 *   -> usage count -> free limit reached -> Stripe Checkout -> Pro status
 *
 *   npm run build && npm run test:billing
 *
 * Both third parties are stubbed locally (ANTHROPIC_BASE_URL, STRIPE_API_BASE),
 * so this spends no API credits and takes no payment. What is NOT stubbed is
 * our own logic: webhook signatures are produced with Stripe's own signing
 * helper and verified by the real `stripe.webhooks.constructEvent`, so the
 * signature check is genuinely exercised - including a forged one, which must
 * be rejected.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";
import Stripe from "stripe";

const ANTHROPIC_PORT = 3111;
const STRIPE_PORT = 3112;
const APP_PORT = 3110;
const APP = `http://127.0.0.1:${APP_PORT}`;
const WEBHOOK_SECRET = "whsec_test_secret_for_local_verification";
const PRICE_ID = "price_test_pro_monthly";

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

function makePng(w = 200, h = 140) {
  const chunk = (type, data) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(w * 3 + 1);
    for (let x = 0; x < w; x += 1) row[1 + x * 3] = (x + y) % 256;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Stub vision model -----------------------------------------------------
const MODEL_REPLY = {
  summary: "This appears to be a private-sale listing with a request for a deposit.",
  fields: [
    { key: "seller_name", label: "Seller", value: "Marcus T." },
    { key: "price", label: "Price", value: "$900" },
    { key: "payment_method", label: "Payment method", value: "Gift cards" },
  ],
  observations: [
    {
      code: "gift_card_payment",
      confidence: 0.92,
      evidence: "The seller asks to be paid in supermarket gift cards.",
    },
    {
      code: "urgency_pressure",
      confidence: 0.8,
      evidence: "The buyer is told the item will be gone by tonight.",
    },
  ],
  notes: [],
};

const anthropicStub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 200 },
        content: [{ type: "text", text: JSON.stringify(MODEL_REPLY) }],
      }),
    );
  });
});

// --- Stub Stripe API -------------------------------------------------------
let customerSeq = 0;
let sessionSeq = 0;
const stripeCalls = [];
const sessions = new Map();
const subscriptions = new Map();

function futureIso(days = 30) {
  return Math.floor((Date.now() + days * 86_400_000) / 1000);
}

function makeSubscription(id, customer, userId, status = "active", periodEnd = futureIso()) {
  const sub = {
    id,
    object: "subscription",
    status,
    customer,
    cancel_at_period_end: false,
    metadata: { userId },
    items: { object: "list", data: [{ id: "si_test", current_period_end: periodEnd }] },
  };
  subscriptions.set(id, sub);
  return sub;
}

const stripeStub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://stub");
    const path = url.pathname;
    const params = new URLSearchParams(body);
    stripeCalls.push({ method: req.method, path, params: Object.fromEntries(params) });

    const send = (payload, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && path === "/v1/customers") {
      customerSeq += 1;
      return send({
        id: `cus_test_${customerSeq}`,
        object: "customer",
        email: params.get("email"),
        metadata: { userId: params.get("metadata[userId]") },
      });
    }

    if (req.method === "POST" && path === "/v1/checkout/sessions") {
      sessionSeq += 1;
      const id = `cs_test_${sessionSeq}`;
      const userId = params.get("client_reference_id");
      const customer = params.get("customer");
      const subId = `sub_test_${sessionSeq}`;
      makeSubscription(subId, customer, userId);
      const session = {
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.test/pay/${id}`,
        client_reference_id: userId,
        customer,
        metadata: { userId },
        mode: params.get("mode"),
        payment_status: "paid",
        status: "complete",
        subscription: subId,
      };
      sessions.set(id, session);
      return send(session);
    }

    const sessionMatch = path.match(/^\/v1\/checkout\/sessions\/(.+)$/);
    if (req.method === "GET" && sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) return send({ error: { message: "No such session" } }, 404);
      return send(session);
    }

    const subMatch = path.match(/^\/v1\/subscriptions\/(.+)$/);
    if (req.method === "GET" && subMatch) {
      const sub = subscriptions.get(subMatch[1]);
      if (!sub) return send({ error: { message: "No such subscription" } }, 404);
      return send(sub);
    }

    if (req.method === "POST" && path === "/v1/billing_portal/sessions") {
      return send({
        id: "bps_test",
        object: "billing_portal.session",
        url: "https://billing.stripe.test/session/test",
      });
    }

    return send({ error: { message: `stub has no route for ${req.method} ${path}` } }, 404);
  });
});

// Real Stripe SDK, used only to sign webhook payloads exactly as Stripe does.
const signer = new Stripe("sk_test_stub", { host: "127.0.0.1", port: STRIPE_PORT, protocol: "http" });

function signedHeaders(payload) {
  return {
    "content-type": "application/json",
    "stripe-signature": signer.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

async function main() {
  await new Promise((r) => anthropicStub.listen(ANTHROPIC_PORT, "127.0.0.1", r));
  await new Promise((r) => stripeStub.listen(STRIPE_PORT, "127.0.0.1", r));
  console.log(`Stubs up: vision :${ANTHROPIC_PORT}, stripe :${STRIPE_PORT}`);

  const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${ANTHROPIC_PORT}`,
      AI_PROVIDER: "anthropic",
      STRIPE_SECRET_KEY: "sk_test_stub",
      STRIPE_PRICE_ID: PRICE_ID,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`,
      APP_URL: APP,
      DATABASE_PATH: "./data/verify-billing.db",
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

    const jar = new Map();
    const absorb = (r) => {
      for (const raw of r.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      }
    };
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const req = async (path, options = {}) => {
      const headers = new Headers(options.headers ?? {});
      if (cookie()) headers.set("cookie", cookie());
      const r = await fetch(`${APP}${path}`, {
        ...options,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      absorb(r);
      return r;
    };
    const json = async (r) => r.json().catch(() => null);
    /**
     * React splits interpolated values into separate text nodes and marks the
     * boundary with an HTML comment, so "{plan.name} plan" ships as
     * "Pro<!-- --> plan". Strip those the way a browser does before asserting
     * on visible copy.
     */
    const visibleText = async (path) =>
      (await req(path).then((r) => r.text())).replaceAll("<!-- -->", "");

    const png = makePng();
    async function scan() {
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "offer.png");
      const r = await req("/api/analyze/image", { method: "POST", body: form });
      return { status: r.status, data: await json(r) };
    }
    const status = async () => json(await req("/api/billing/status"));

    // ---- Sign up --------------------------------------------------------
    section("Account");
    const email = `pro-${Date.now()}@example.test`;
    const signup = await req("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    check("signup succeeds", signup.status === 200, `status ${signup.status}`);

    let st = await status();
    check("a new account starts on Free", st?.plan === "free", st?.plan);
    check("the Free allowance is 3", st?.limit === 3, String(st?.limit));
    check("nothing is used yet", st?.used === 0 && st?.remaining === 3);
    check("billing reports itself configured", st?.billingConfigured === true);

    // ---- The core loop, three times --------------------------------------
    section("Screenshot -> analysis -> score -> warnings -> usage");
    for (let i = 1; i <= 3; i += 1) {
      const result = await scan();
      check(`scan ${i} succeeds`, result.status === 200 && !!result.data?.id, `status ${result.status}`);
      if (i === 1) {
        const scanned = await json(await req(`/api/scans/${result.data.id}`));
        const s = scanned?.scan;
        check("the vision model's summary is used", s?.summary === MODEL_REPLY.summary);
        check(
          "the model's observations became warning signs",
          s?.warningSigns?.some((w) => w.code === "gift_card_payment"),
        );
        check("a risk score was produced", s?.score > 60 && s?.level === "high", `${s?.score} (${s?.level})`);
        check("recommendations were produced", (s?.recommendations?.length ?? 0) >= 3);
      }
      st = await status();
      check(`usage counts ${i} of 3 after scan ${i}`, st?.used === i, `used ${st?.used}`);
      check(`remaining is ${3 - i}`, st?.remaining === 3 - i, `remaining ${st?.remaining}`);
    }

    // ---- Free limit -------------------------------------------------------
    section("Free limit");
    st = await status();
    check("the plan reports itself exhausted", st?.exhausted === true);

    const blocked = await scan();
    check("a fourth scan is refused", blocked.status === 402, `status ${blocked.status}`);
    check("the refusal is machine-readable", blocked.data?.code === "quota_exceeded");
    check("the refusal explains the limit", /free analyses this month/i.test(blocked.data?.error ?? ""));

    const scanPage = await visibleText("/scan");
    check("the scan page shows the upgrade screen", scanPage.includes("Limit reached"));
    check("the upgrade screen names the Pro allowance", scanPage.includes("100 screenshot analyses"));

    const usedBefore = (await status())?.used;
    check("a refused scan is not charged to the allowance", usedBefore === 3, `used ${usedBefore}`);

    // ---- Checkout ---------------------------------------------------------
    section("Stripe Checkout");
    const checkout = await req("/api/billing/checkout", { method: "POST" });
    const checkoutData = await json(checkout);
    check("checkout returns a Stripe URL", checkout.status === 200 && !!checkoutData?.url, `status ${checkout.status}`);
    check(
      "the URL points at Stripe, not at us",
      (checkoutData?.url ?? "").startsWith("https://checkout.stripe.test/"),
      checkoutData?.url,
    );

    const createCall = stripeCalls.find((c) => c.path === "/v1/checkout/sessions");
    check("a subscription-mode session was created", createCall?.params.mode === "subscription");
    check("it used the configured price", createCall?.params["line_items[0][price]"] === PRICE_ID);
    check("it carries our user id for later verification", !!createCall?.params.client_reference_id);

    check(
      "the user is still on Free before payment is confirmed",
      (await status())?.plan === "free",
    );

    // ---- Webhook: the only thing that grants Pro ---------------------------
    section("Webhook verification");
    const sessionId = [...sessions.keys()].at(-1);
    const session = sessions.get(sessionId);
    const event = {
      id: `evt_test_${Date.now()}`,
      object: "event",
      type: "checkout.session.completed",
      data: { object: session },
    };
    const payload = JSON.stringify(event);

    const forged = await req("/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: payload,
    });
    check("a forged signature is rejected", forged.status === 400, `status ${forged.status}`);
    check("a forged webhook does not grant Pro", (await status())?.plan === "free");

    const unsigned = await req("/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    check("an unsigned webhook is rejected", unsigned.status === 400, `status ${unsigned.status}`);

    const accepted = await req("/api/billing/webhook", {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    });
    check("a correctly signed webhook is accepted", accepted.status === 200, `status ${accepted.status}`);

    st = await status();
    check("the user is now on Pro", st?.plan === "pro", st?.plan);
    check("the Pro allowance is 100", st?.limit === 100, String(st?.limit));
    check("earlier usage carries over", st?.used === 3, `used ${st?.used}`);
    check("remaining reflects the new limit", st?.remaining === 97, `remaining ${st?.remaining}`);

    const replay = await req("/api/billing/webhook", {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    });
    check("a duplicate delivery is ignored", (await json(replay))?.duplicate === true);

    // ---- Pro can scan again ----------------------------------------------
    section("Pro");
    const proScan = await scan();
    check("a Pro user can scan past the free limit", proScan.status === 200, `status ${proScan.status}`);
    check("usage keeps counting on Pro", (await status())?.used === 4);

    const account = await visibleText("/account");
    check("the account page shows the Pro plan", account.includes("Pro plan"));
    check("the account page shows monthly usage", /4<\/strong> of 100/.test(account));

    const portal = await req("/api/billing/portal", { method: "POST" });
    check("a Pro user can open the billing portal", portal.status === 200, `status ${portal.status}`);

    // ---- Cancellation lapses the entitlement ------------------------------
    section("Cancellation");
    const subId = session.subscription;
    const cancelled = { ...subscriptions.get(subId), status: "canceled" };
    const cancelEvent = {
      id: `evt_cancel_${Date.now()}`,
      object: "event",
      type: "customer.subscription.deleted",
      data: { object: cancelled },
    };
    const cancelPayload = JSON.stringify(cancelEvent);
    const cancelRes = await req("/api/billing/webhook", {
      method: "POST",
      headers: signedHeaders(cancelPayload),
      body: cancelPayload,
    });
    check("the cancellation webhook is accepted", cancelRes.status === 200, `status ${cancelRes.status}`);

    st = await status();
    check("the user drops back to Free", st?.plan === "free", st?.plan);
    check("the Free allowance applies again", st?.limit === 3, String(st?.limit));
    const afterCancel = await scan();
    check(
      "scanning is blocked again once cancelled",
      afterCancel.status === 402,
      `status ${afterCancel.status}`,
    );

    // ---- Secrets stay server-side ----------------------------------------
    section("Secrets");
    const pricingHtml = await req("/pricing").then((r) => r.text());
    check("no Stripe secret key in the pricing page", !pricingHtml.includes("sk_test_stub"));
    check("no webhook secret in the pricing page", !pricingHtml.includes(WEBHOOK_SECRET));
    check("no Anthropic key in the pricing page", !pricingHtml.includes("sk-ant-test-key"));
    const log = appLog.join("");
    check("no Stripe secret key in the server log", !log.includes("sk_test_stub"));
    check("no webhook secret in the server log", !log.includes(WEBHOOK_SECRET));
  } finally {
    app.kill("SIGKILL");
    anthropicStub.closeAllConnections?.();
    anthropicStub.close();
    stripeStub.closeAllConnections?.();
    stripeStub.close();
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
  process.exit(1);
});
