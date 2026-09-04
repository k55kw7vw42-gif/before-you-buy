import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never cached or prerendered: a health check has to reflect this process, now.
export const dynamic = "force-dynamic";

/**
 * Liveness probe for the platform's health check.
 *
 * Deliberately does nothing: no session lookup, no database read, no call to
 * Stripe or the AI provider. It answers "is this process up and serving?" and
 * nothing else, so a slow dependency can never take a healthy container out of
 * rotation - and it is safe to leave unauthenticated because it discloses
 * nothing about the deployment.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", uptime: Math.round(process.uptime()) },
    { headers: { "cache-control": "no-store" } },
  );
}
