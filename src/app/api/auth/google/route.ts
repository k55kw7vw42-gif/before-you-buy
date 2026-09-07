import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/billing/stripe";
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
 * Starts Google sign-in.
 */
export async function GET(request: Request) {
  const config = getGoogleConfig();

  if (!config) {
    return NextResponse.redirect(
      new URL("/login?error=google_unavailable", appBaseUrl(request))
    );
  }

  const state = randomBytes(24).toString("hex");
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  // state cookie
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  // next redirect cookie
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

  // ✅ الحل هنا
  const baseUrl = process.env.NEXTAUTH_URL!;
  const redirectUri = googleRedirectUri(baseUrl);

  return NextResponse.redirect(
    buildAuthorizationUrl(config, redirectUri, state)
  );
}
