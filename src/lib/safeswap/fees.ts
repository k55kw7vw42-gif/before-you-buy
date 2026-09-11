/**
 * SafeSwap's fee split. Deliberately not shared with lib/deals/fees.ts (the
 * other, separate escrow feature) - these two systems are kept independent
 * on purpose, so a future change to one's commission never silently changes
 * the other's.
 */
export const SAFESWAP_FEE_BPS = 300; // 3.00%

/**
 * Splits a deal price into the platform's fee and the seller's payout, in
 * integer cents. The fee is rounded and the payout takes the remainder, so
 * the two always sum to exactly the original price.
 */
export function splitAmount(priceCents: number): { platformFeeCents: number; sellerAmountCents: number } {
  const platformFeeCents = Math.round((priceCents * SAFESWAP_FEE_BPS) / 10_000);
  return { platformFeeCents, sellerAmountCents: priceCents - platformFeeCents };
}
