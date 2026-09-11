/** SafeSwap: seller-initiated escrow between two users, with a 3% platform fee. */

export type SafeSwapDealStatus = "pending" | "paid" | "released" | "disputed";

export interface SafeSwapDeal {
  id: string;
  sellerId: string;
  /** Set only once a buyer has actually paid - null before that. */
  buyerId: string | null;
  title: string;
  /** The full deal price, in cents. */
  priceCents: number;
  status: SafeSwapDealStatus;
  stripePaymentIntentId: string | null;
  createdAt: string;
}

export interface SafeSwapTransaction {
  id: string;
  dealId: string;
  amountCents: number;
  platformFeeCents: number;
  sellerAmountCents: number;
  status: string;
  createdAt: string;
}
