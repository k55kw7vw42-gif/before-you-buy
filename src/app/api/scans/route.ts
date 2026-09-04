import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listScansForUser } from "@/lib/scans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scan history for the signed-in user only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to view your scan history." }, { status: 401 });
  }
  return NextResponse.json({ scans: listScansForUser(user.id) });
}
