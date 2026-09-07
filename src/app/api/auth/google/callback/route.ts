import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findOrCreateGoogleUser, getGuestId, startSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/billing/stripe";
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

function failure(request: Request, reason: string) {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, appBaseUrl(request)));
}

/** Where Google returns the user. Everything here is verified before a session starts. */
export async function GET(request: Request) {
  const config = getGoogleConfig();
  if (!config) return failure(request, "google_unavailable");

  const limit = checkRateLimit(`oauth:${rateLimitKey(request, null)}`, 20, 60_000);
  if (!limit.allowed) return failure(request, "rate_limited");

  const url = new URL(request.url);
  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  const next = store.get(OAUTH_NEXT_COOKIE)?.value;

  // Single-use: clear them whatever happens next.
  store.delete(OAUTH_STATE_COOKIE);
  store.delete(OAUTH_NEXT_COOKIE);

  if (url.searchParams.get("error")) {
    // The person pressed cancel on Google's screen. Not an error worth shouting about.
    return NextResponse.redirect(new URL("/login", appBaseUrl(request)));
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !expectedState || state !== expectedState) {
    console.error("[oauth:google] state did not match; rejecting the callback");
    return failure(request, "google_state");
  }
  if (!code) return failure(request, "google_failed");

  try {
    const profile = await resolveGoogleProfile(config, code, googleRedirectUri(appBaseUrl(request)));

    // Accounts are matched by email, so an unverified address could be used to
    // take over someone else's account. Google marks its own addresses
    // verified; anything else is refused.
    if (!profile.emailVerified) {
      console.error("[oauth:google] refused a profile with an unverified email");
      return failure(request, "google_unverified");
    }

    const guestId = await getGuestId();
    const user = findOrCreateGoogleUser(profile);
    await startSession(user.id);
    if (guestId) claimGuestScans(guestId, user.id);

    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/scan";
    return NextResponse.redirect(new URL(target, appBaseUrl(request)));
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      console.error(`[oauth:google] ${err.message}`);
      return failure(request, "google_failed");
    }
    console.error("[oauth:google] unexpected failure:", err);
    return failure(request, "google_failed");
  }
}
