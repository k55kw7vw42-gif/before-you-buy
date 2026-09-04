import { NextResponse } from "next/server";
import { createUser, getGuestId, startSession, validateCredentials } from "@/lib/auth";
import { claimGuestScans } from "@/lib/scans";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limit = checkRateLimit(`signup:${rateLimitKey(request, null)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  const result = validateCredentials(email, password);
  if ("message" in result) {
    return NextResponse.json({ error: result.message, field: result.field }, { status: 400 });
  }

  const user = createUser(result.email, result.password);
  if (!user) {
    return NextResponse.json(
      { error: "An account with that email already exists.", field: "email" },
      { status: 409 },
    );
  }

  const guestId = await getGuestId();
  await startSession(user.id);
  if (guestId) claimGuestScans(guestId, user.id);

  return NextResponse.json({ user });
}
