export default async function PricingPage({
  searchParams,
}: {
  searchParams: { checkout?: string }; // ✅ مش Promise
}) {
  const { checkout } = searchParams; // ✅ بدون await

  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();
  const usage = getUsage({ userId: user?.id ?? null, guestId });
  const billingConfigured = isBillingConfigured();
  const currentPlan = usage.plan.id;

  return (
    <div className="stack-lg">
      {/* باقي الكود زي ما هو */}
    </div>
  );
}
