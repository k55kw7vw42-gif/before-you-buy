import { notFound } from "next/navigation";
import { DealStatus } from "@/components/DealStatus";
import { baseUrl } from "@/lib/base-url";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { applyDealPayment, getDeal, syncSellerAccountStatus } from "@/lib/deals/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Protected deal - Before You Pay" };

/**
 * Shared by both sides of a deal: the buyer (signed in, sees the share link
 * and later the release button) and the seller (no account needed - the
 * unguessable id in the URL is what they were sent, same trust model as a
 * shareable invoice link).
 *
 * Reconciles with Stripe immediately on load, the same "webhook is the
 * authority, the page fast-paths it" pattern already used on the Pro
 * checkout success page - so neither side is stuck looking at a stale
 * status right after coming back from Stripe.
 */
export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  let deal = getDeal(id);
  if (!deal) notFound();

  const user = await getCurrentUser();
  const isBuyer = user?.id === deal.buyerId;
  const { paid } = await searchParams;
  const stripe = getStripe();

  if (stripe) {
    if (deal.status === "seller_onboarding") {
      deal = await syncSellerAccountStatus(stripe, deal);
    }
    if (paid === "1" && deal.status === "ready_for_payment" && deal.stripeCheckoutSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(deal.stripeCheckoutSessionId);
        await applyDealPayment(stripe, deal.id, session);
        deal = getDeal(id) ?? deal;
      } catch (err) {
        console.error("[deals] could not reconcile the deal Checkout session:", err);
      }
    }
  }

  return (
    <div className="stack" style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <div>
        <h1>Protected deal</h1>
        <p className="muted">
          {isBuyer
            ? "You are the buyer on this deal."
            : "Review this deal below, then accept it to get paid once it completes."}
        </p>
      </div>
      <DealStatus deal={deal} isBuyer={isBuyer} shareUrl={`${baseUrl()}/deal/${deal.id}`} />
    </div>
  );
}
