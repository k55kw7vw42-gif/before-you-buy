#!/usr/bin/env node
/**
 * One-off backfill: populate current_period_start / current_period_end for
 * subscribers who predate those columns.
 *
 * Allowances follow the Stripe billing period on Pro. Subscribers who existed
 * before that shipped have no stored period, so they fall back to the calendar
 * month until their next Stripe webhook fills it in - at renewal, or on any
 * subscription change. This reads the period straight from Stripe instead, so
 * they move onto billing periods immediately.
 *
 *   node scripts/backfill-subscription-periods.mjs             # dry run
 *   node scripts/backfill-subscription-periods.mjs --apply     # write
 *
 * Safety properties:
 *   - Dry run by default. Nothing is written without --apply.
 *   - Idempotent. Only rows missing a period are considered, so a second run
 *     finds nothing to do. (--force re-reads every active Pro row.)
 *   - Narrow. It writes the two period columns and nothing else: plan, status,
 *     customer and subscription ids are left exactly as they are, so it can
 *     neither grant nor revoke access.
 *   - Free users are never selected, let alone written.
 *   - One bad row does not stop the run; failures are reported and exit 1.
 *
 * Environment:
 *   STRIPE_SECRET_KEY  required
 *   DATABASE_PATH      same value the app runs with (default ./data/before-you-pay.db)
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(resolvePath(ROOT, "scripts/ts-alias-hook.mjs")));

const { getDb } = await import(pathToFileURL(resolvePath(ROOT, "src/lib/db.ts")).href);
const { createStripeClient } = await import(
  pathToFileURL(resolvePath(ROOT, "src/lib/billing/stripe.ts")).href
);
const { subscriptionPeriod, upsertSubscription } = await import(
  pathToFileURL(resolvePath(ROOT, "src/lib/billing/subscription.ts")).href
);

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const FORCE = args.has("--force");
const QUIET = args.has("--quiet");

for (const arg of args) {
  if (!["--apply", "--force", "--quiet"].includes(arg)) {
    console.error(`Unknown option: ${arg}`);
    console.error("Usage: node scripts/backfill-subscription-periods.mjs [--apply] [--force] [--quiet]");
    process.exit(2);
  }
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey) {
  console.error("STRIPE_SECRET_KEY is not set. Run this with the same environment as the app.");
  process.exit(2);
}

const log = (...a) => {
  if (!QUIET) console.log(...a);
};

const stripe = createStripeClient(secretKey);
const db = getDb();

// Only entitled Pro rows are candidates. Free users are not selected at all.
const candidates = db
  .prepare(
    `SELECT user_id, stripe_subscription_id, current_period_start, current_period_end
       FROM subscriptions
      WHERE plan = 'pro'
        AND status IN ('active', 'trialing')
        ${FORCE ? "" : "AND (current_period_start IS NULL OR current_period_end IS NULL)"}
      ORDER BY user_id`,
  )
  .all();

log(
  `${APPLY ? "Applying" : "Dry run"}${FORCE ? " (--force: re-reading every active Pro row)" : ""}`,
);
log(`Database: ${process.env.DATABASE_PATH ?? "./data/before-you-pay.db"}`);
log(`Candidates: ${candidates.length}\n`);

if (candidates.length === 0) {
  log("Nothing to do.");
  process.exit(0);
}

let updated = 0;
let unchanged = 0;
const skipped = [];
const failed = [];

for (const row of candidates) {
  const who = row.user_id;

  if (!row.stripe_subscription_id) {
    skipped.push(`${who}: no stripe_subscription_id on the row`);
    continue;
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  } catch (err) {
    const status = err?.statusCode ?? err?.status;
    if (status === 404) {
      // The subscription is gone from Stripe. Leaving the row alone is correct:
      // a webhook, not a backfill, is what should retire an entitlement.
      skipped.push(`${who}: ${row.stripe_subscription_id} not found in Stripe`);
    } else {
      failed.push(`${who}: ${err?.message ?? "unknown error"}`);
    }
    continue;
  }

  const { start, end } = subscriptionPeriod(subscription);
  if (!start || !end) {
    skipped.push(`${who}: Stripe returned no period for ${row.stripe_subscription_id}`);
    continue;
  }

  if (row.current_period_start === start && row.current_period_end === end) {
    unchanged += 1;
    continue;
  }

  // Stripe's own view of the subscription may have moved on since we last heard
  // from it. That is a webhook's job to reconcile, not this script's - report it
  // and still write the period, which cannot grant or revoke anything on its own.
  if (!["active", "trialing"].includes(subscription.status)) {
    skipped.push(
      `${who}: Stripe reports status "${subscription.status}" - left for the webhook to reconcile`,
    );
    continue;
  }

  log(`${who}: ${start} -> ${end}`);
  if (APPLY) {
    upsertSubscription({ userId: who, currentPeriodStart: start, currentPeriodEnd: end });
  }
  updated += 1;
}

log("");
log(`${APPLY ? "Updated" : "Would update"}: ${updated}`);
if (unchanged) log(`Already correct: ${unchanged}`);
if (skipped.length) {
  log(`Skipped: ${skipped.length}`);
  for (const reason of skipped) log(`  - ${reason}`);
}
if (failed.length) {
  console.error(`Failed: ${failed.length}`);
  for (const reason of failed) console.error(`  - ${reason}`);
}

if (!APPLY && updated > 0) {
  log("\nThis was a dry run. Re-run with --apply to write these changes.");
}

process.exit(failed.length ? 1 : 0);
