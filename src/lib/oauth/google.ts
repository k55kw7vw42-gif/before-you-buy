/**
 * Sign in with Google, via the OAuth 2.0 authorization-code flow.
 *
 * The client secret is read from the server environment and never leaves it:
 * the browser only ever follows a redirect to Google and back. We read the
 * user's profile from Google's userinfo endpoint with the access token rather
 * than verifying an id_token ourselves - fewer moving parts, same guarantee,
 * because the token came straight from Google over TLS.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * Short-lived cookies that carry the flow across the redirect to Google. They
 * live here rather than in a route file: Next only allows a fixed set of
 * exports from a route module.
 */
export const OAUTH_STATE_COOKIE = "byp_oauth_state";
export const OAUTH_NEXT_COOKIE = "byp_oauth_next";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
}

/** Reads config, or null when Google sign-in is not set up on this server. */
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  // GOOGLE_OAUTH_BASE points the whole flow at a local stub. Test-only; leave
  // it unset everywhere else.
  const base = process.env.GOOGLE_OAUTH_BASE?.trim();
  return {
    clientId,
    clientSecret,
    authUrl: base ? `${base}/auth` : GOOGLE_AUTH_URL,
    tokenUrl: base ? `${base}/token` : GOOGLE_TOKEN_URL,
    userinfoUrl: base ? `${base}/userinfo` : GOOGLE_USERINFO_URL,
  };
}

export function isGoogleConfigured(): boolean {
  return getGoogleConfig() !== null;
}

/** The redirect Google sends the user back to. Must match the console exactly. */
export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function buildAuthorizationUrl(
  config: GoogleConfig,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(config.authUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // Ask for an account chooser rather than silently reusing one signed-in
  // Google account, which surprises people on shared machines.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export class GoogleAuthError extends Error {}

/** Trades the one-time code for an access token. */
async function exchangeCode(
  config: GoogleConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // The body can echo the client secret back; log only the status.
    console.error(`[oauth:google] token exchange failed with status ${response.status}`);
    throw new GoogleAuthError("Could not complete sign-in with Google.");
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new GoogleAuthError("Google did not return an access token.");
  return data.access_token;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
}

async function fetchProfile(config: GoogleConfig, accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(config.userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error(`[oauth:google] userinfo failed with status ${response.status}`);
    throw new GoogleAuthError("Could not read your Google profile.");
  }

  const data = (await response.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
  };
  if (!data.sub || !data.email) {
    throw new GoogleAuthError("Google did not return an email address.");
  }

  return {
    googleId: data.sub,
    email: data.email.trim().toLowerCase(),
    // Google sends this as a boolean, and historically as a string.
    emailVerified: data.email_verified === true || data.email_verified === "true",
  };
}

/** Full callback exchange: code in, verified Google profile out. */
export async function resolveGoogleProfile(
  config: GoogleConfig,
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  const accessToken = await exchangeCode(config, code, redirectUri);
  return fetchProfile(config, accessToken);
}
