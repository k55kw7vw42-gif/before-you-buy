import Link from "next/link";
import { notFound } from "next/navigation";
import { ScanResult } from "@/components/ScanResult";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { getScanForOwner } from "@/lib/scans";

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();

  const scan = getScanForOwner(id, {
    userId: user?.id ?? null,
    guestId,
  });

  if (!scan) notFound();

  return (
    <div className="stack-lg">
      <ScanResult scan={scan} />

      {!user && (
        <p className="notice-strip">
          <Link href="/signup">Create an account</Link> to save this result.
        </p>
      )}
    </div>
  );
}
