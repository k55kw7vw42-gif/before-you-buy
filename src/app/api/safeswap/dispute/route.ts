import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getDeal, updateDeal } from "@/lib/safeswap/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buyer marks a paid deal as disputed. MVP scope: a status change only, with
 * no automation, refund, or moderation behind it - that is explicitly future
 * work, not something this route fakes.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to dispute this deal." }, { status: 401 });
  }

  const limit = checkRateLimit(`safeswap-dispute:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { dealId?: unknown } | null;
  const dealId = typeof body?.dealId === "string" ? body.dealId : "";
  const deal = dealId ? getDeal(dealId) : null;
  if (!deal || deal.buyerId !== user.id) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }
  if (deal.status !== "paid") {
    return NextResponse.json({ error: "Only a paid deal can be disputed." }, { status: 409 });
  }

  updateDeal(deal.id, { status: "disputed" });
  return NextResponse.json({ ok: true });
}
