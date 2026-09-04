import { NextResponse } from "next/server";
import { ensureGuestId, getCurrentUser } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { analyzeUrl } from "@/lib/link/analyze";
import { assessRisk } from "@/lib/risk/engine";
import { saveScan } from "@/lib/scans";
import { validateUrl } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link analysis. The URL is inspected as a string only - we never fetch a link
 * the user suspects is hostile.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  const limit = checkRateLimit(`analyze:${rateLimitKey(request, user?.id ?? null)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You have reached the analysis limit. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = (body as Record<string, unknown> | null)?.url;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "Enter a link to check." }, { status: 400 });
  }

  const validation = validateUrl(raw);
  if (!validation.ok || !validation.url) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const extraction = await analyzeUrl(validation.url);
    const risk = assessRisk(extraction.observations);
    const guestId = user ? null : await ensureGuestId();

    const id = saveScan({
      owner: { userId: user?.id ?? null, guestId },
      scanType: "link",
      sourceLabel: validation.url.href.slice(0, 300),
      provider: "url-heuristics",
      extraction,
      risk,
    });

    return NextResponse.json({ id });
  } catch (err) {
    console.error("[analyze/link] failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while checking that link. Please try again." },
      { status: 500 },
    );
  }
}
