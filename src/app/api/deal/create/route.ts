import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDeal } from "@/lib/deals/store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1_000_000;

/** Starts a protected deal. The buyer must be signed in; the seller need not be. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to create a protected deal." }, { status: 401 });
  }

  const limit = checkRateLimit(`deal-create:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { amount?: unknown; sellerEmail?: unknown }
    | null;
  const amount = typeof body?.amount === "number" ? body.amount : Number(body?.amount);
  const sellerEmail = typeof body?.sellerEmail === "string" ? body.sellerEmail.trim().toLowerCase() : "";

  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return NextResponse.json(
      { error: `Enter an amount between $${MIN_AMOUNT} and $${MAX_AMOUNT.toLocaleString()}.` },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail)) {
    return NextResponse.json({ error: "Enter a valid seller email address." }, { status: 400 });
  }

  const deal = createDeal({
    buyerId: user.id,
    sellerEmail,
    amountCents: Math.round(amount * 100),
  });

  return NextResponse.json({ id: deal.id });
}
