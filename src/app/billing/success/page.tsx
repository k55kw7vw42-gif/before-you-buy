import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { applyStripeSubscription, getEntitlement } from "@/lib/billing/subscription";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome to Pro - Before You Pay" };

/**
 * Where Stripe returns the customer after Checkout.
 *
 * The webhook is the authority, but it can land a moment after the redirect, so
 * this page reconciles immediately. It does not trust the URL: the session id
 * is read back from Stripe, and Pro is granted only if Stripe says the session
 * is paid AND it belongs to the signed-in user.
 */
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const { session_id: sessionId } = await searchParams;
  const stripe = getStripe();
  let reconciled = false;

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });
      const belongsToUser =
        session.client_reference_id === user.id || session.metadata?.userId === user.id;
      const paid = session.payment_status === "paid" || session.status === "complete";

      if (belongsToUser && paid && session.subscription) {
        const subscription =
          typeof session.subscription === "string"
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;
        applyStripeSubscription(user.id, subscription);
        reconciled = true;
      } else if (!belongsToUser) {
        console.error("[billing] a Checkout session was opened by a different user");
      }
    } catch (err) {
      console.error("[billing] could not reconcile the Checkout session:", err);
    }
  }

  const { plan } = getEntitlement(user.id);
  const isPro = plan.id === "pro";

  return (
    <div className="stack" style={{ maxWidth: "34rem", margin: "2rem auto" }}>
      <section className="card">
        <h1 style={{ fontSize: "1.6rem" }}>
          {isPro ? "You're on Pro" : "Payment received"}
        </h1>
        {isPro ? (
          <p className="muted">
            Your plan now includes {plan.monthlyScans} screenshot analyses a month. Thank you for
            supporting the app.
          </p>
        ) : (
          <p className="muted">
            Thanks - Stripe is still confirming your payment. This usually takes a few seconds.
            Refresh this page, or check your account, and it will appear.
          </p>
        )}
        {!reconciled && !isPro && (
          <p className="notice-strip" style={{ marginTop: "1rem" }}>
            If your plan has not updated in a minute or two, contact support - your payment is
            safe either way.
          </p>
        )}
        <div className="btn-row" style={{ marginTop: "1.5rem" }}>
          <Link className="btn btn-primary" href="/scan">
            Scan a screenshot
          </Link>
          <Link className="btn btn-secondary" href="/account">
            View my plan
          </Link>
        </div>
      </section>
    </div>
  );
}
