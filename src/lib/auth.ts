import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import type { PublicUser } from "./types";

export const SESSION_COOKIE = "byp_session";
export const GUEST_COOKIE = "byp_guest";
const SESSION_DAYS = 30;

const SCRYPT_KEYLEN = 64;

/** scrypt with a per-user salt, stored as "scrypt:<salt>:<hash>". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface AuthError {
  field?: "email" | "password";
  message: string;
}

export function validateCredentials(
  email: unknown,
  password: unknown,
): { email: string; password: string } | AuthError {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { field: "email", message: "Enter a valid email address." };
  }
  if (typeof password !== "string" || password.length < 8) {
    return { field: "password", message: "Password must be at least 8 characters." };
  }
  if (password.length > 200) {
    return { field: "password", message: "Password must be 200 characters or fewer." };
  }
  return { email: email.trim().toLowerCase(), password };
}

export function createUser(email: string, password: string): PublicUser | null {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return null;

  const user = { id: randomUUID(), email, createdAt: new Date().toISOString() };
  db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run(user.id, user.email, hashPassword(password), user.createdAt);
  return user;
}

export function authenticate(email: string, password: string): PublicUser | null {
  const row = getDb()
    .prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; password_hash: string; created_at: string } | undefined;

  // Always run a hash comparison so a missing account and a wrong password take
  // a similar amount of time.
  const stored = row?.password_hash ?? hashPassword(randomBytes(16).toString("hex"));
  if (!verifyPassword(password, stored) || !row) return null;

  return { id: row.id, email: row.email, createdAt: row.created_at };
}

function purgeExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

/** Creates a server-side session row and sets the httpOnly session cookie. */
export async function startSession(userId: string): Promise<void> {
  const id = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  purgeExpiredSessions();
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, expires.toISOString(), now.toISOString());

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  store.delete(SESSION_COOKIE);
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(id) as { id: string; email: string; created_at: string; expires_at: string } | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

/**
 * Anonymous browsers get an opaque guest id so they can read back the result of
 * a scan they just ran - and nobody else's. Read-only variant for pages, which
 * cannot set cookies during render.
 */
export async function getGuestId(): Promise<string | null> {
  return (await cookies()).get(GUEST_COOKIE)?.value ?? null;
}

/** Route-handler variant: issues the guest cookie if the browser has none. */
export async function ensureGuestId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;
  if (existing) return existing;

  const id = randomBytes(24).toString("hex");
  store.set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}

/**
 * Stored in place of a password hash for accounts that sign in with Google.
 * `verifyPassword` requires the "scrypt" scheme, so this value can never match
 * any password - a Google account cannot be logged into with one.
 */
const OAUTH_PASSWORD_SENTINEL = "oauth:google";

interface UserRow {
  id: string;
  email: string;
  created_at: string;
}

/**
 * Finds or creates the account behind a Google profile.
 *
 * Matching is by Google's stable account id first, then by email so that
 * someone who signed up with a password and later uses Google lands in the same
 * account instead of a duplicate. Linking by email is only safe because Google
 * told us the address is verified; the caller checks that first.
 */
export function findOrCreateGoogleUser(profile: {
  googleId: string;
  email: string;
}): PublicUser {
  const db = getDb();
  const now = new Date().toISOString();
  const email = profile.email.trim().toLowerCase();

  const byGoogleId = db
    .prepare("SELECT id, email, created_at FROM users WHERE google_id = ?")
    .get(profile.googleId) as UserRow | undefined;
  if (byGoogleId) {
    return { id: byGoogleId.id, email: byGoogleId.email, createdAt: byGoogleId.created_at };
  }

  const byEmail = db
    .prepare("SELECT id, email, created_at FROM users WHERE email = ?")
    .get(email) as UserRow | undefined;
  if (byEmail) {
    // Existing password account: attach the Google id so future sign-ins match
    // on it directly. The password keeps working.
    db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(profile.googleId, byEmail.id);
    return { id: byEmail.id, email: byEmail.email, createdAt: byEmail.created_at };
  }

  const user = { id: randomUUID(), email, createdAt: now };
  db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at, google_id) VALUES (?, ?, ?, ?, ?)",
  ).run(user.id, user.email, OAUTH_PASSWORD_SENTINEL, user.createdAt, profile.googleId);
  return user;
}
