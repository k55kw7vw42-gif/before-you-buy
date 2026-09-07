import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  buildAuthorizationUrl,
  getGoogleConfig,
  googleRedirectUri,
} from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts Google sign-in flow
 */
export async function GET(request: Request) {
  const config = getGoogleConfig();

  // ❌ If Google config is missing → redirect safely using correct domain
  if (!config) {
    const baseUrl = process.env.NEXTAUTH_URL!;
    return NextResponse.redirect(
      new URL("/login?error=google_unavailable", baseUrl)
    );
  }

  // Generate secure random state
  const state = randomBytes(24).toString("hex");

  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  // Store OAuth state (CSRF protection)
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  // Handle redirect after login
  const requested = new URL(request.url).searchParams.get("next");
  const next =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/scan";

  store.set(OAUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  // ✅ ALWAYS use correct domain (fixes 0.0.0.0 issue)
  const baseUrl = process.env.NEXTAUTH_URL!;
  const redirectUri = googleRedirectUri(baseUrl);

  // Redirect to Google OAuth
  return NextResponse.redirect(
    buildAuthorizationUrl(config, redirectUri, state)
  );
}
