import { notFound, redirect } from "next/navigation";
import { SafeSwapDealActions } from "@/components/safeswap/SafeSwapDealActions";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { applyDealPayment, getDeal } from "@/lib/safeswap/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "SafeSwap deal - Before You Pay" };

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Shared by both sides: the seller (who created it, no action button once
 * created) and the buyer (Pay while pending, Confirm Delivery / Dispute once
 * paid). Unlike Deal Protection's link-based seller, both sides here need an
 * account - a signed-out visitor is sent to log in first.
 */
export default async function SafeSwapDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/safeswap/${id}`);

  let deal = getDeal(id);
  if (!deal) notFound();

  const isSeller = deal.sellerId === user.id;
  const isBuyer = deal.buyerId === user.id;

  // Fast-path reconciliation: if this deal's PaymentIntent already succeeded
  // on Stripe's side but the webhook has not landed yet, apply it now so the
  // buyer is never stuck looking at a stale "pending" status right after
  // paying. The webhook (see /api/billing/webhook) remains the authority.
  const stripe = getStripe();
  if (stripe && deal.status === "pending" && deal.stripePaymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(deal.stripePaymentIntentId);
      if (intent.status === "succeeded" && intent.metadata?.buyerId) {
        applyDealPayment(deal.id, intent.metadata.buyerId);
        deal = getDeal(id) ?? deal;
      }
    } catch (err) {
      console.error("[safeswap] could not reconcile the PaymentIntent:", err);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <div>
        <h1>{deal.title}</h1>
        <p className="muted">
          {formatPrice(deal.priceCents)}
          {isSeller && " · You are the seller"}
          {isBuyer && " · You are the buyer"}
        </p>
      </div>

      <div className="card">
        <span className="badge risk-medium">
          <span className="dot" aria-hidden="true" />
          {deal.status}
        </span>
      </div>

      <SafeSwapDealActions deal={deal} isBuyer={isBuyer} isSeller={isSeller} />
    </div>
  );
}
