/** Deal Protection: a buyer-funded, seller-released escrow with a 3% fee. */

export type DealStatus =
  | "pending_seller" // created, waiting for the seller to open the link
  | "seller_onboarding" // seller accepted, Stripe Connect onboarding in progress
  | "ready_for_payment" // seller's Connect account can receive a transfer
  | "funds_held" // buyer paid; funds sit in the platform's Stripe balance
  | "released"; // 97% transferred to the seller; deal complete

export interface Deal {
  id: string;
  buyerId: string;
  sellerEmail: string;
  /** The full deal amount, in cents. */
  amountCents: number;
  /** The platform's 3% cut, in cents. */
  feeCents: number;
  currency: string;
  status: DealStatus;
  stripeConnectAccountId: string | null;
  stripeCheckoutSessionId: string | null;
  /** The Charge behind the buyer's payment - what a release Transfers from. */
  stripeChargeId: string | null;
  stripeTransferId: string | null;
  createdAt: string;
  updatedAt: string;
}
