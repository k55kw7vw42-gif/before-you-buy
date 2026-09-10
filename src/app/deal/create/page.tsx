import { redirect } from "next/navigation";
import { DealForm } from "@/components/DealForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Protect a deal - Before You Pay" };

export default async function DealCreatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/deal/create");

  return (
    <div className="stack" style={{ maxWidth: "30rem", margin: "0 auto" }}>
      <div>
        <h1>Protect this deal</h1>
        <p className="muted">
          We hold your payment until you confirm the seller delivered, then release it to
          them - minus a 3% fee.
        </p>
      </div>
      <DealForm />
    </div>
  );
}
