/**
 * Placeholder for Stripe Connect account lookup.
 *
 * Onboarding is explicitly out of scope for this MVP - there is no UI or
 * Stripe Account Link flow yet, so this always returns null. Release Funds
 * checks for null and fails with a clear, honest error rather than silently
 * doing nothing or sending a Transfer nowhere. Wiring a real Connect account
 * id in here later (e.g. reading it back from a users/connect table once
 * onboarding exists) is the only change needed to make releases actually
 * pay a seller out.
 */
export function getSellerStripeAccountId(_userId: string): string | null {
  return null;
}
