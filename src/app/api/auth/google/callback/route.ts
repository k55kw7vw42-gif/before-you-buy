import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findOrCreateGoogleUser, getGuestId, startSession } from "@/lib/auth";
import {
  GoogleAuthError,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  getGoogleConfig,
  googleRedirectUri,
  resolveGoogleProfile,
} from "@/lib/oauth/google";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { claimGuestScans } from "@/lib/scans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(reason: string) {
  const baseUrl = process.env.NEXTAUTH_URL!;
  return NextResponse.redirect(
    new URL(`/login?error=${reason}`, baseUrl)
  );
}

export async function GET(request: Request) {
  const config = getGoogleConfig();
  if (!config) return failure("google_unavailable");

  const limit = checkRateLimit(`oauth:${rateLimitKey(request, null)}`, 20, 60000);
  if (!limit.allowed) return failure("rate_limited");

  const url = new URL(request.url);
  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  const next = store.get(OAUTH_NEXT_COOKIE)?.value;

  store.delete(OAUTH_STATE_COOKIE);
  store.delete(OAUTH_NEXT_COOKIE);

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(
      new URL("/login", process.env.NEXTAUTH_URL!)
    );
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!state || !expectedState || state !== expectedState) {
    console.error("[oauth:google] invalid state");
    return failure("google_state");
  }

  if (!code) return failure("google_failed");

  try {
    // ✅ FIX HERE
    const baseUrl = process.env.NEXTAUTH_URL!;
    const profile = await resolveGoogleProfile(
      config,
      code,
      googleRedirectUri(baseUrl)
    );

    if (!profile.emailVerified) {
      console.error("[oauth:google] unverified email");
      return failure("google_unverified");
    }

    const guestId = await getGuestId();
    const user = findOrCreateGoogleUser(profile);

    await startSession(user.id);

    if (guestId) claimGuestScans(guestId, user.id);

    const target =
      next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/scan";

    return NextResponse.redirect(
      new URL(target, process.env.NEXTAUTH_URL!)
    );

  } catch (err) {
    if (err instanceof GoogleAuthError) {
      console.error(`[oauth:google] ${err.message}`);
      return failure("google_failed");
    }

    console.error("[oauth:google] unexpected error:", err);
    return failure("google_failed");
  }
}
