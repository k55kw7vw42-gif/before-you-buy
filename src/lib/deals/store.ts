import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { splitAmount } from "./fees";
import type { Deal, DealStatus } from "./types";

interface Row {
  id: string;
  buyer_id: string;
  seller_email: string;
  amount_cents: number;
  fee_cents: number;
  currency: string;
  status: string;
  stripe_connect_account_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_charge_id: string | null;
  stripe_transfer_id: string | null;
  created_at: string;
  updated_at: string;
}

function toDeal(row: Row): Deal {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerEmail: row.seller_email,
    amountCents: row.amount_cents,
    feeCents: row.fee_cents,
    currency: row.currency,
    status: row.status as DealStatus,
    stripeConnectAccountId: row.stripe_connect_account_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeChargeId: row.stripe_charge_id,
    stripeTransferId: row.stripe_transfer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDeal(input: { buyerId: string; sellerEmail: string; amountCents: number }): Deal {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { feeCents } = splitAmount(input.amountCents);

  db.prepare(
    `INSERT INTO deals (id, buyer_id, seller_email, amount_cents, fee_cents, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'usd', 'pending_seller', ?, ?)`,
  ).run(id, input.buyerId, input.sellerEmail, input.amountCents, feeCents, now, now);

  return getDeal(id)!;
}

export function getDeal(id: string): Deal | null {
  const row = getDb().prepare("SELECT * FROM deals WHERE id = ?").get(id) as Row | undefined;
  return row ? toDeal(row) : null;
}

interface PatchInput {
  status?: DealStatus;
  stripeConnectAccountId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeChargeId?: string | null;
  stripeTransferId?: string | null;
}

const COLUMN_FOR: Record<keyof PatchInput, string> = {
  status: "status",
  stripeConnectAccountId: "stripe_connect_account_id",
  stripeCheckoutSessionId: "stripe_checkout_session_id",
  stripeChargeId: "stripe_charge_id",
  stripeTransferId: "stripe_transfer_id",
};

/** Applies a partial update. Only fields present in `patch` are touched. */
export function updateDeal(id: string, patch: PatchInput): void {
  const keys = Object.keys(patch) as Array<keyof PatchInput>;
  if (keys.length === 0) return;

  const assignments = keys.map((key) => `${COLUMN_FOR[key]} = ?`);
  const values = keys.map((key) => patch[key] ?? null);

  getDb()
    .prepare(`UPDATE deals SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...values, new Date().toISOString(), id);
}

/**
 * Checks whether the seller's Connect account can now receive a transfer, and
 * advances the deal to "ready_for_payment" the moment it can. Called from the
 * deal page on every load while onboarding is in progress, so the buyer's
 * "Pay" button appears as soon as Stripe reports the account ready, without
 * needing a separate account.updated webhook for this MVP.
 */
export async function syncSellerAccountStatus(stripe: Stripe, deal: Deal): Promise<Deal> {
  if (deal.status !== "seller_onboarding" || !deal.stripeConnectAccountId) return deal;

  const account = await stripe.accounts.retrieve(deal.stripeConnectAccountId);
  if (account.capabilities?.transfers === "active") {
    updateDeal(deal.id, { status: "ready_for_payment" });
    return getDeal(deal.id) ?? deal;
  }
  return deal;
}

/**
 * Applies a confirmed Checkout Session payment to a deal: moves it to
 * "funds_held" and records the underlying Charge, which a later release
 * transfers from. Idempotent and safe to call from both the webhook (the
 * authority) and the deal page's own on-load reconciliation (the fast path) -
 * whichever gets there first wins, and the other becomes a no-op.
 */
export async function applyDealPayment(
  stripe: Stripe,
  dealId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const deal = getDeal(dealId);
  if (!deal || deal.status === "funds_held" || deal.status === "released") return;

  const paid = session.payment_status === "paid" || session.status === "complete";
  if (!paid) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;
  if (!chargeId) return;

  updateDeal(dealId, {
    status: "funds_held",
    stripeCheckoutSessionId: session.id,
    stripeChargeId: chargeId,
  });
}
