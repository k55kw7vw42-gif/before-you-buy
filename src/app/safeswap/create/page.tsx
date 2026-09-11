import { redirect } from "next/navigation";
import { SafeSwapCreateForm } from "@/components/safeswap/SafeSwapCreateForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a SafeSwap deal - Before You Pay" };

export default async function SafeSwapCreatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/safeswap/create");

  return (
    <div className="stack" style={{ maxWidth: "30rem", margin: "0 auto" }}>
      <div>
        <h1>Create a SafeSwap deal</h1>
        <p className="muted">
          The buyer pays up front. We hold it until they confirm delivery, then release 97% to
          you - keeping a 3% fee.
        </p>
      </div>
      <SafeSwapCreateForm />
    </div>
  );
}
