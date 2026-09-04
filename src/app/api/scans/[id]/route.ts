import { NextResponse } from "next/server";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { getScanForOwner } from "@/lib/scans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();

  const scan = getScanForOwner(id, { userId: user?.id ?? null, guestId });
  // Same response whether the scan is missing or belongs to someone else, so
  // the endpoint cannot be used to probe for valid scan ids.
  if (!scan) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  return NextResponse.json({ scan });
}
