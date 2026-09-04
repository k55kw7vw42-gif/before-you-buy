#!/usr/bin/env node
/**
 * Verifies the real Anthropic vision path without spending API credits.
 *
 *   npm run build && npm run test:vision
 *
 * Stands up a fake Anthropic endpoint, points the app at it with
 * ANTHROPIC_BASE_URL, and drives a real screenshot upload through the app.
 * Then asserts on both sides of the call:
 *
 *   - what the app SENT upstream (the image really is attached as base64, with
 *     the right media type, model, and prompt), and
 *   - what the app DID with the reply (the model's observations, not any
 *     canned data, produced the score, warnings and recommendations).
 *
 * It also exercises the failure paths a real key can hit: a refusal, a
 * truncated reply, and a rejected key.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";

const UPSTREAM_PORT = 3101;
const APP_PORT = 3100;
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

/** A small valid PNG, built without an image library. */
function makePng(w = 240, h = 160) {
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
    for (let x = 0; x < w; x += 1) row[1 + x * 3] = (x * y) % 256;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * What the fake model "sees" in the screenshot. Deliberately specific, so that
 * finding these exact strings in the result proves the reply drove the output.
 */
const MODEL_REPLY = {
  summary:
    "This appears to be a marketplace listing for a tractor with a request for an up-front deposit.",
  fields: [
    { key: "seller_name", label: "Seller", value: "Ridgeway Farm Equipment" },
    { key: "product_or_service", label: "Product", value: "2019 Kubota L3901 tractor" },
    { key: "price", label: "Price", value: "$4,200" },
    { key: "payment_method", label: "Payment method", value: "Zelle transfer" },
    { key: "phone", label: "Phone", value: "(555) 0142" },
  ],
  observations: [
    {
      code: "unrealistic_price",
      confidence: 0.9,
      evidence: "A $4,200 price for this tractor is far below the usual market range.",
    },
    {
      code: "deposit_request",
      confidence: 0.85,
      evidence: "The seller asks for a $500 deposit before you can see the tractor.",
    },
    {
      code: "unusual_payment_method",
      confidence: 0.8,
      evidence: "Payment is requested by Zelle, which offers no buyer protection.",
    },
    {
      code: "urgency_pressure",
      confidence: 0.75,
      evidence: "The message says the tractor will be sold by this evening.",
    },
  ],
  notes: ["The bottom of the screenshot was cut off."],
};

/** Records every upstream request so the test can assert on what was sent. */
const received = [];
let mode = "ok";

const upstream = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ url: req.url, headers: req.headers, body: JSON.parse(body || "{}") });

    const send = (status, payload) => {
      const json = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(json);
    };

    if (mode === "unauthorized") {
      return send(401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      });
    }

    const base = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      stop_sequence: null,
      usage: { input_tokens: 1800, output_tokens: 320 },
    };

    if (mode === "refusal") {
      return send(200, {
        ...base,
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
      });
    }
    if (mode === "truncated") {
      return send(200, {
        ...base,
        content: [{ type: "text", text: '{"summary":"cut off mid' }],
        stop_reason: "max_tokens",
      });
    }
    // Reply the way a model actually does: a fenced JSON block.
    return send(200, {
      ...base,
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "```json\n" + JSON.stringify(MODEL_REPLY) + "\n```" },
      ],
      stop_reason: "end_turn",
    });
  });
});

async function main() {
  await new Promise((r) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", r));
  console.log(`Fake Anthropic endpoint on :${UPSTREAM_PORT}`);

  const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      // A dummy key: the request never leaves this machine.
      ANTHROPIC_API_KEY: "sk-ant-test-key-not-real",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      AI_PROVIDER: "anthropic",
      DATABASE_PATH: "./data/verify-vision.db",
      RATE_LIMIT_MAX: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  app.stdout.on("data", (d) => appLog.push(d.toString()));
  app.stderr.on("data", (d) => appLog.push(d.toString()));

  try {
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(APP, { redirect: "manual" });
        if (r.ok || r.status < 500) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const jar = new Map();
    const absorb = (r) => {
      for (const raw of r.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    };
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const png = makePng();
    async function scan() {
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "listing.png");
      const r = await fetch(`${APP}/api/analyze/image`, {
        method: "POST",
        body: form,
        headers: cookie() ? { cookie: cookie() } : {},
        signal: AbortSignal.timeout(30_000),
      });
      absorb(r);
      return { status: r.status, data: await r.json().catch(() => null) };
    }

    // ---- The happy path -------------------------------------------------
    console.log("\nApp is not in demo mode");
    const home = await fetch(APP).then((r) => r.text());
    check("home page does not show the demo-mode notice", !home.includes("Running in demo mode"));

    console.log("\nWhat the app sent to the vision model");
    const scanned = await scan();
    check("the scan succeeds", scanned.status === 200 && !!scanned.data?.id, `status ${scanned.status}`);
    check("exactly one upstream call was made", received.length === 1, `${received.length} calls`);

    const sent = received[0];
    check("it went to POST /v1/messages", sent.url === "/v1/messages");
    check("the API key was sent as a header", !!sent.headers["x-api-key"]);
    check("the model is claude-opus-5", sent.body.model === "claude-opus-5", sent.body.model);
    check("max_tokens leaves room for thinking", sent.body.max_tokens >= 8000, sent.body.max_tokens);
    check("adaptive thinking is requested", sent.body.thinking?.type === "adaptive");
    check("an effort level is set", !!sent.body.output_config?.effort, sent.body.output_config?.effort);
    check("the system prompt is attached", typeof sent.body.system === "string" && sent.body.system.length > 200);
    check(
      "the system prompt lists the signal catalog",
      sent.body.system.includes("gift_card_payment") && sent.body.system.includes("unrealistic_price"),
    );

    const blocks = sent.body.messages?.[0]?.content ?? [];
    const imageBlock = blocks.find((b) => b.type === "image");
    const textBlock = blocks.find((b) => b.type === "text");
    check("the message carries an image block", !!imageBlock);
    check("the image comes before the text", blocks[0]?.type === "image");
    check("the image is sent as base64", imageBlock?.source?.type === "base64");
    check("the media type is image/png", imageBlock?.source?.media_type === "image/png");
    check(
      "the bytes sent are exactly the uploaded screenshot",
      imageBlock?.source?.data === png.toString("base64"),
      `${imageBlock?.source?.data?.length} chars vs ${png.toString("base64").length}`,
    );
    check("a text instruction accompanies the image", !!textBlock?.text);

    // ---- What the app did with the reply --------------------------------
    console.log("\nWhat the app did with the model's reply");
    const scan1 = await fetch(`${APP}/api/scans/${scanned.data.id}`, {
      headers: { cookie: cookie() },
    }).then((r) => r.json());
    const s = scan1.scan;

    check("the model's summary is used", s.summary === MODEL_REPLY.summary, s.summary);
    check(
      "the model's extracted fields are stored",
      s.fields.some((f) => f.value === "Ridgeway Farm Equipment") &&
        s.fields.some((f) => f.value === "2019 Kubota L3901 tractor"),
      JSON.stringify(s.fields.map((f) => f.value)),
    );
    check(
      "every observation became a warning sign",
      MODEL_REPLY.observations.every((o) => s.warningSigns.some((w) => w.code === o.code)),
      JSON.stringify(s.warningSigns.map((w) => w.code)),
    );
    check(
      "the model's own evidence text is shown to the user",
      s.warningSigns.some((w) => w.detail.includes("far below the usual market range")),
    );
    check(
      "the score came from those observations, not a default",
      s.score > 60 && s.level === "high",
      `${s.score} (${s.level})`,
    );
    check("the model's caveat is carried through", s.notes.includes(MODEL_REPLY.notes[0]));
    check("recommendations were generated", s.recommendations.length >= 3);
    check("the scan is attributed to the anthropic provider", s.provider === "anthropic");

    // Prove the score tracks the model: a reply with no observations must be low.
    const observationsBackup = MODEL_REPLY.observations;
    MODEL_REPLY.observations = [];
    const cleanScan = await scan();
    const clean = await fetch(`${APP}/api/scans/${cleanScan.data.id}`, {
      headers: { cookie: cookie() },
    }).then((r) => r.json());
    check(
      "a reply with no observations scores Low Risk",
      clean.scan.score === 0 && clean.scan.level === "low",
      `${clean.scan.score} (${clean.scan.level})`,
    );
    MODEL_REPLY.observations = observationsBackup;

    // ---- Failure paths a real key can hit --------------------------------
    console.log("\nFailure paths");
    mode = "refusal";
    const refused = await scan();
    check("a model refusal is handled, not crashed", refused.status === 422, `status ${refused.status}`);
    check("the refusal message is user-facing", /could not review/i.test(refused.data?.error ?? ""));

    mode = "truncated";
    const truncated = await scan();
    check("a truncated reply is reported clearly", truncated.status === 502, `status ${truncated.status}`);

    mode = "unauthorized";
    const badKey = await scan();
    check("a rejected API key returns a clean error", badKey.status === 502, `status ${badKey.status}`);
    check(
      "the bad-key error tells the user nothing sensitive",
      !/sk-ant|x-api-key|invalid x-api-key/i.test(JSON.stringify(badKey.data)),
      JSON.stringify(badKey.data),
    );

    const log = appLog.join("");
    check("the API key never appears in the server log", !log.includes("sk-ant-test-key-not-real"));
    check(
      "the operator log explains the auth failure",
      log.includes("ANTHROPIC_API_KEY"),
      "expected a hint naming the env var",
    );
    mode = "ok";
  } finally {
    app.kill("SIGKILL");
    upstream.closeAllConnections?.();
    upstream.close();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  // The spawned server and its sockets can keep the loop alive; we are done.
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nVerification crashed:", err);
  upstream.closeAllConnections?.();
  upstream.close();
  process.exit(1);
});
