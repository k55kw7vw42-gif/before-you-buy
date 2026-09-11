import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { SafeSwapDeal, SafeSwapDealStatus } from "./types";

interface DealRow {
  id: string;
  seller_id: string;
  buyer_id: string | null;
  title: string;
  price_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
}

function toDeal(row: DealRow): SafeSwapDeal {
  return {
    id: row.id,
    sellerId: row.seller_id,
    buyerId: row.buyer_id,
    title: row.title,
    priceCents: row.price_cents,
    status: row.status as SafeSwapDealStatus,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at,
  };
}

/** Seller creates a new deal. Starts "pending" with no buyer assigned yet. */
export function createDeal(input: { sellerId: string; title: string; priceCents: number }): SafeSwapDeal {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO safeswap_deals (id, seller_id, buyer_id, title, price_cents, status, created_at)
     VALUES (?, ?, NULL, ?, ?, 'pending', ?)`,
  ).run(id, input.sellerId, input.title, input.priceCents, now);

  return getDeal(id)!;
}

export function getDeal(id: string): SafeSwapDeal | null {
  const row = getDb().prepare("SELECT * FROM safeswap_deals WHERE id = ?").get(id) as DealRow | undefined;
  return row ? toDeal(row) : null;
}

/** Every deal where the user is either the seller or the assigned buyer. */
export function listDealsForUser(userId: string): SafeSwapDeal[] {
  const rows = getDb()
    .prepare("SELECT * FROM safeswap_deals WHERE seller_id = ? OR buyer_id = ? ORDER BY created_at DESC")
    .all(userId, userId) as unknown as DealRow[];
  return rows.map(toDeal);
}

interface PatchInput {
  status?: SafeSwapDealStatus;
  buyerId?: string | null;
  stripePaymentIntentId?: string | null;
}

const COLUMN_FOR: Record<keyof PatchInput, string> = {
  status: "status",
  buyerId: "buyer_id",
  stripePaymentIntentId: "stripe_payment_intent_id",
};

/** Applies a partial update. Only fields present in `patch` are touched. */
export function updateDeal(id: string, patch: PatchInput): void {
  const keys = Object.keys(patch) as Array<keyof PatchInput>;
  if (keys.length === 0) return;

  const assignments = keys.map((key) => `${COLUMN_FOR[key]} = ?`);
  const values = keys.map((key) => patch[key] ?? null);

  getDb()
    .prepare(`UPDATE safeswap_deals SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values, id);
}

/** Records a completed release's payout split, for audit purposes. */
export function recordTransaction(input: {
  dealId: string;
  amountCents: number;
  platformFeeCents: number;
  sellerAmountCents: number;
  status: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO safeswap_transactions
         (id, deal_id, amount_cents, platform_fee_cents, seller_amount_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.dealId,
      input.amountCents,
      input.platformFeeCents,
      input.sellerAmountCents,
      input.status,
      new Date().toISOString(),
    );
}

/**
 * Applies a confirmed PaymentIntent to a deal: moves it to "paid" and
 * assigns the buyer. Idempotent - only acts on a "pending" deal, so it is
 * safe to call from both the webhook (the authority) and the deal page's
 * own on-load reconciliation (the fast path) without double-applying.
 */
export function applyDealPayment(dealId: string, buyerId: string): void {
  const deal = getDeal(dealId);
  if (!deal || deal.status !== "pending") return;
  updateDeal(dealId, { status: "paid", buyerId });
}
