/** The platform's cut of a protected deal. */
export const DEAL_FEE_BPS = 300; // 3.00%

/**
 * Splits a deal amount into the platform's fee and the seller's payout, in
 * integer cents. The fee is rounded and the payout takes the remainder, so
 * the two always sum to exactly the original amount - no half-cent is ever
 * lost or invented by rounding both sides independently.
 */
export function splitAmount(amountCents: number): { feeCents: number; payoutCents: number } {
  const feeCents = Math.round((amountCents * DEAL_FEE_BPS) / 10_000);
  return { feeCents, payoutCents: amountCents - feeCents };
}
