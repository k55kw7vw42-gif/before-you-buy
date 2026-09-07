export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const { session_id: sessionId } = searchParams;
  const stripe = getStripe();
  let reconciled = false;

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });

      const belongsToUser =
        session.client_reference_id === user.id ||
        session.metadata?.userId === user.id;

      const paid =
        session.payment_status === "paid" ||
        session.status === "complete";

      if (belongsToUser && paid && session.subscription) {
        const subscription =
          typeof session.subscription === "string"
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;

        applyStripeSubscription(user.id, subscription);
        reconciled = true;
      }
    } catch (err) {
      console.error("billing error:", err);
    }
  }

  const { plan } = getEntitlement(user.id);
  const isPro = plan.id === "pro";

  return (
    <div className="stack">
      <h1>{isPro ? "You're on Pro" : "Payment received"}</h1>
    </div>
  );
}
