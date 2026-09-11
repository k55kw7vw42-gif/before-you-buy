import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { createDeal } from "@/lib/safeswap/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PRICE_CENTS = 100; // $1.00
const MAX_PRICE_CENTS = 100_000_000; // $1,000,000.00
const MAX_TITLE_LENGTH = 200;

/** Seller creates a new SafeSwap deal (title + price). No buyer yet. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to create a deal." }, { status: 401 });
  }

  const limit = checkRateLimit(`safeswap-create:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { title?: unknown; price?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const price = typeof body?.price === "number" ? body.price : Number(body?.price);
  const priceCents = Math.round(price * 100);

  if (!title || title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Enter a title (up to ${MAX_TITLE_LENGTH} characters).` },
      { status: 400 },
    );
  }
  if (!Number.isFinite(priceCents) || priceCents < MIN_PRICE_CENTS || priceCents > MAX_PRICE_CENTS) {
    return NextResponse.json({ error: "Enter a valid price." }, { status: 400 });
  }

  const deal = createDeal({ sellerId: user.id, title, priceCents });
  return NextResponse.json({ id: deal.id });
}
