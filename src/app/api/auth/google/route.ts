import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/base-url";
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
 *
 * A random `state` is stored in an httpOnly cookie and echoed to Google, so the
 * callback can prove the response belongs to a flow this browser began rather
 * than one an attacker started.
 */
export async function GET(request: Request) {
  const config = getGoogleConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/login?error=google_unavailable", baseUrl()));
  }

  const state = randomBytes(24).toString("hex");
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  // Where to land afterwards. Only same-site relative paths are ever honoured.
  const requested = new URL(request.url).searchParams.get("next");
  const next = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/scan";
  store.set(OAUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  const redirectUri = googleRedirectUri(baseUrl());
  return NextResponse.redirect(buildAuthorizationUrl(config, redirectUri, state));
}
