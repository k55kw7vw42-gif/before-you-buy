import { NextResponse } from "next/server";
import { AiProviderError, getAiProvider } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { releaseScanSlot, reserveScanSlot } from "@/lib/billing/usage";
import { assessRisk } from "@/lib/risk/engine";
import { saveScan } from "@/lib/scans";
import { MAX_IMAGE_BYTES, formatBytes, isAllowedImageType, sniffImageType } from "@/lib/validation";

export const runtime = "nodejs";
// Analysis is per-request work with no cacheable output.
export const dynamic = "force-dynamic";

const MAX_CONTEXT_CHARS = 1000;

/**
 * Screenshot analysis. The image is held in memory for the duration of the
 * request only - it is sent to the AI provider and then dropped; nothing is
 * written to disk or to the database.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  // Screenshot analysis is the one thing here that costs money to run, so it is
  // for account holders only. An anonymous allowance would be tracked by cookie,
  // which anyone can clear to get another one. Link checks stay open to
  // everybody - they call no model and cost nothing.
  if (!user) {
    return NextResponse.json(
      {
        error: "Sign in to scan a screenshot. Checking a link needs no account.",
        code: "auth_required",
      },
      { status: 401 },
    );
  }

  const limit = checkRateLimit(`analyze:${rateLimitKey(request, user.id)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `You have reached the analysis limit. Try again in ${limit.retryAfterSeconds} seconds.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Please choose a screenshot to scan." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.` },
      { status: 413 },
    );
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PNG, JPEG, WebP or GIF image." },
      { status: 415 },
    );
  }

  // The scan always belongs to the signed-in account.
  const owner = { userId: user.id, guestId: null };

  // Claim a slot atomically. Checking the count and then writing the scan would
  // leave a window - the whole analysis - in which a second request could pass
  // the same check, so the slot is taken up front and given back at the end.
  const reservation = reserveScanSlot(owner);
  if (!reservation.allowed) {
    const { usage } = reservation;
    return NextResponse.json(
      {
        error:
          usage.plan.id === "pro"
            ? `You have used all ${usage.limit} analyses included in this billing period.`
            : `You have used your ${usage.limit} free analyses this month.`,
        code: "quota_exceeded",
        plan: usage.plan.id,
        used: usage.used,
        limit: usage.limit,
        periodEnd: usage.periodEnd,
      },
      { status: 402 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The declared Content-Type is client-controlled; trust the magic bytes.
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return NextResponse.json(
        { error: "That file does not look like a real image. Upload a PNG, JPEG, WebP or GIF." },
        { status: 415 },
      );
    }

    const rawContext = form.get("context");
    const userContext =
      typeof rawContext === "string" ? rawContext.slice(0, MAX_CONTEXT_CHARS) : undefined;

    const provider = getAiProvider();
    const extraction = await provider.analyzeImage({
      base64: Buffer.from(bytes).toString("base64"),
      mediaType: sniffed,
      userContext,
    });

    const risk = assessRisk(extraction.observations);

    const id = saveScan({
      owner,
      scanType: "screenshot",
      sourceLabel: file.name?.slice(0, 120) || "Uploaded screenshot",
      provider: provider.name,
      extraction,
      risk,
    });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof AiProviderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[analyze/image] failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while analysing that screenshot. Please try again." },
      { status: 500 },
    );
  } finally {
    // Released after the scan row is written, so the slot is never unaccounted
    // for: either the reservation or the saved scan is holding it at all times.
    // On a failure or a rejected file, nothing is charged.
    releaseScanSlot(reservation.id);
  }
}
