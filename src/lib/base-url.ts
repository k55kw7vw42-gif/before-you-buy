/**
 * The app's public base URL.
 *
 * This must never be derived from the incoming request. Behind Render's proxy
 * the request's own origin is the container's internal bind address
 * (0.0.0.0:10000), so anything built from it - an OAuth redirect_uri, a Stripe
 * return link - points somewhere unreachable. Google then rejects the token
 * exchange because the redirect_uri does not match the registered one.
 *
 * It comes from the environment instead, so it is identical on every request.
 */

/** Reads the configured public origin, without a trailing slash. */
function configuredBaseUrl(): string | null {
  const value = process.env.NEXTAUTH_URL?.trim() || process.env.APP_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

/**
 * The public origin, e.g. "https://beforeyoupay.onrender.com".
 *
 * Throws in production when it is not configured rather than guessing: a wrong
 * base URL fails later, further away, and looks like something else.
 */
export function baseUrl(): string {
  const configured = configuredBaseUrl();
  if (configured) return configured;

  // Local development only; never reached in production, which throws above.
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";

  console.error(
    "[config] NEXTAUTH_URL is not set. Sign-in and checkout redirects cannot be built without it.",
  );
  throw new Error("NEXTAUTH_URL is not configured.");
}

/** True when the public origin is configured (or we are in development). */
export function hasBaseUrl(): boolean {
  return configuredBaseUrl() !== null || process.env.NODE_ENV !== "production";
}
