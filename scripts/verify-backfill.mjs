#!/usr/bin/env node
/**
 * Tests the one-off period backfill against realistic existing Pro data.
 *
 *   npm run test:backfill
 *
 * Seeds a database in the state a real deployment is in after the migration -
 * Pro subscribers whose period columns are still NULL - stands up a stub Stripe
 * API, and runs the actual CLI as a subprocess. Checks the safety properties
 * that matter for a script pointed at production data: dry run writes nothing,
 * only the two period columns change, Free users are untouched, bad rows are
 * skipped rather than fatal, and a second run is a no-op.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const STRIPE_PORT = 3141;
const DB = resolvePath(tmpdir(), `byp-backfill-${process.pid}-${Date.now()}.db`);

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

const unix = (days) => Math.floor((Date.now() + days * 86_400_000) / 1000);

// Periods the stub will report, and therefore what the backfill should store.
const PERIODS = {
  sub_active: { start: unix(-6), end: unix(24) },
  sub_second: { start: unix(-2), end: unix(28) },
  sub_fresh: { start: unix(-1), end: unix(29) },
};

const stripeStub = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const send = (payload, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  const match = path.match(/^\/v1\/subscriptions\/(.+)$/);
  if (!match) return send({ error: { message: "no route" } }, 404);

  const id = match[1];
  if (id === "sub_missing") {
    return send({ error: { type: "invalid_request_error", message: "No such subscription" } }, 404);
  }
  if (id === "sub_cancelled") {
    return send({
      id,
      object: "subscription",
      status: "canceled",
      customer: "cus_x",
      cancel_at_period_end: false,
      items: { object: "list", data: [{ id: "si", current_period_start: unix(-40), current_period_end: unix(-10) }] },
    });
  }
  const period = PERIODS[id];
  if (!period) return send({ error: { message: "unknown sub" } }, 404);
  return send({
    id,
    object: "subscription",
    status: "active",
    customer: "cus_x",
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [{ id: "si", current_period_start: period.start, current_period_end: period.end }],
    },
  });
});

/**
 * Runs the CLI as a child process, asynchronously. This must not be
 * synchronous: the Stripe stub lives in this process, so a blocking spawn would
 * stop the event loop and the child's requests would never be answered.
 */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [resolvePath(ROOT, "scripts/backfill-subscription-periods.mjs"), ...args],
      { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function runBackfill(extraArgs = []) {
  return run(extraArgs, {
    ...process.env,
    STRIPE_SECRET_KEY: "sk_test_backfill",
    STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`,
    DATABASE_PATH: DB,
  });
}

function openDb() {
  return new DatabaseSync(DB);
}

function rows() {
  const db = openDb();
  const out = db.prepare("SELECT * FROM subscriptions ORDER BY user_id").all();
  db.close();
  return Object.fromEntries(out.map((r) => [r.user_id, r]));
}

const iso = (unixSeconds) => new Date(unixSeconds * 1000).toISOString();

async function main() {
  await new Promise((r) => stripeStub.listen(STRIPE_PORT, "127.0.0.1", r));

  // Create the schema through the app's own code, then seed the legacy state.
  register(pathToFileURL(resolvePath(ROOT, "scripts/ts-alias-hook.mjs")));
  process.env.DATABASE_PATH = DB;
  const { getDb } = await import(pathToFileURL(resolvePath(ROOT, "src/lib/db.ts")).href);
  const seeded = getDb();
  const now = new Date().toISOString();

  const users = [
    // A pre-existing Pro subscriber with no stored period: the whole point.
    ["pro-legacy", "sub_active", "pro", "active", null, null],
    // A second one, to prove the run is not single-row.
    ["pro-legacy-2", "sub_second", "pro", "active", null, null],
    // Already backfilled: must be left alone.
    ["pro-current", "sub_fresh", "pro", "active", iso(PERIODS.sub_fresh.start), iso(PERIODS.sub_fresh.end)],
    // A Free user: must never be selected.
    ["free-user", null, "free", "inactive", null, null],
    // Pro row with no subscription id: skipped, not fatal.
    ["pro-orphan", null, "pro", "active", null, null],
    // Subscription deleted at Stripe: skipped, not fatal.
    ["pro-gone", "sub_missing", "pro", "active", null, null],
    // Stripe now says cancelled: left for the webhook to reconcile.
    ["pro-stale", "sub_cancelled", "pro", "active", null, null],
  ];

  for (const [id, subId, plan, status, start, end] of users) {
    seeded
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, `${id}@example.test`, "scrypt:salt:hash", now);
    seeded
      .prepare(
        `INSERT INTO subscriptions
           (user_id, stripe_customer_id, stripe_subscription_id, plan, status,
            current_period_start, current_period_end, cancel_at_period_end, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, "cus_x", subId, plan, status, start, end, 0, now);
  }
  // Release the database before spawning any child: db.ts caches its handle on
  // globalThis, and a connection held here would contend with the child's writes.
  seeded.close();
  delete globalThis.__bypDb;

  const before = rows();

  // ---- Dry run ----------------------------------------------------------
  section("Dry run (the default)");
  const dry = await runBackfill();
  check("the dry run succeeds", dry.status === 0, `exit ${dry.status}: ${dry.stderr}`);
  check("it reports what it would update", /Would update: 2/.test(dry.stdout), dry.stdout.trim());
  check("it says it changed nothing", /This was a dry run/.test(dry.stdout));

  const afterDry = rows();
  check(
    "nothing is written without --apply",
    JSON.stringify(afterDry) === JSON.stringify(before),
    "the database changed during a dry run",
  );

  // ---- Apply ------------------------------------------------------------
  section("Apply");
  const applied = await runBackfill(["--apply"]);
  check("the run succeeds", applied.status === 0, `exit ${applied.status}: ${applied.stderr}`);
  check("it reports the rows it updated", /Updated: 2/.test(applied.stdout), applied.stdout.trim());

  const after = rows();
  check(
    "the legacy subscriber gets the period from Stripe",
    after["pro-legacy"].current_period_start === iso(PERIODS.sub_active.start) &&
      after["pro-legacy"].current_period_end === iso(PERIODS.sub_active.end),
    `${after["pro-legacy"].current_period_start} -> ${after["pro-legacy"].current_period_end}`,
  );
  check(
    "the second subscriber is backfilled too",
    after["pro-legacy-2"].current_period_start === iso(PERIODS.sub_second.start),
  );

  // ---- Nothing else may change -----------------------------------------
  section("Blast radius");
  for (const id of Object.keys(before)) {
    const a = before[id];
    const b = after[id];
    const untouched =
      a.plan === b.plan &&
      a.status === b.status &&
      a.stripe_customer_id === b.stripe_customer_id &&
      a.stripe_subscription_id === b.stripe_subscription_id &&
      a.cancel_at_period_end === b.cancel_at_period_end;
    check(`${id}: plan, status and ids are unchanged`, untouched);
  }
  check(
    "the Free user's row is byte-for-byte identical",
    JSON.stringify(before["free-user"]) === JSON.stringify(after["free-user"]),
  );
  check(
    "an already-correct row is not rewritten",
    before["pro-current"].updated_at === after["pro-current"].updated_at,
  );

  // ---- Rows that cannot be backfilled ----------------------------------
  section("Rows it declines to touch");
  check("a row with no subscription id is skipped", /pro-orphan: no stripe_subscription_id/.test(applied.stdout));
  check("a subscription missing from Stripe is skipped", /pro-gone: .*not found in Stripe/.test(applied.stdout));
  check("a cancelled subscription is left for the webhook", /pro-stale: Stripe reports status "canceled"/.test(applied.stdout));
  check("none of those are left with a period", after["pro-orphan"].current_period_start === null);
  check("a cancelled subscriber is not given a period", after["pro-stale"].current_period_start === null);
  check(
    "a cancelled subscriber keeps the plan and status it had",
    after["pro-stale"].plan === "pro" && after["pro-stale"].status === "active",
  );

  // ---- Idempotence ------------------------------------------------------
  section("Idempotence");
  const second = await runBackfill(["--apply"]);
  check("a second run succeeds", second.status === 0, `exit ${second.status}`);
  check("a second run finds nothing to update", /Updated: 0/.test(second.stdout), second.stdout.trim());
  check(
    "a second run leaves the data alone",
    JSON.stringify(rows()) === JSON.stringify(after),
  );

  const forced = await runBackfill(["--apply", "--force"]);
  check("--force re-reads every active Pro row", forced.status === 0, `exit ${forced.status}`);
  check(
    "--force still writes nothing when the periods already match",
    /Updated: 0/.test(forced.stdout),
    forced.stdout.trim(),
  );

  // ---- The effect it was for --------------------------------------------
  section("Effect on entitlement");
  const { resolvePeriod, getUsage } = await import(
    pathToFileURL(resolvePath(ROOT, "src/lib/billing/usage.ts")).href
  );
  const owner = { userId: "pro-legacy", guestId: null };
  check(
    "the backfilled subscriber now uses the billing period",
    resolvePeriod(owner).basis === "billing",
    resolvePeriod(owner).basis,
  );
  check(
    "their window is the one Stripe reported",
    resolvePeriod(owner).end === iso(PERIODS.sub_active.end),
  );
  check("their Pro allowance is intact", getUsage(owner).limit === 100);
  check(
    "a Free user is still on the calendar month",
    resolvePeriod({ userId: "free-user", guestId: null }).basis === "calendar",
  );

  // ---- Guard rails ------------------------------------------------------
  section("Guard rails");
  const noKey = await run([], { ...process.env, STRIPE_SECRET_KEY: "", DATABASE_PATH: DB });
  check("it refuses to run without STRIPE_SECRET_KEY", noKey.status === 2, `exit ${noKey.status}`);
  const badArg = await runBackfill(["--yolo"]);
  check("an unknown option is rejected", badArg.status === 2, `exit ${badArg.status}`);
}

main()
  .catch((err) => {
    console.error("\nVerification crashed:", err);
    failures.push("crashed");
  })
  .finally(() => {
    stripeStub.closeAllConnections?.();
    stripeStub.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(DB + suffix);
      } catch {
        /* not created */
      }
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    process.exit(failures.length ? 1 : 0);
  });
