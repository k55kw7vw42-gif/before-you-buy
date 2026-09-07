"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleButton } from "./GoogleButton";
import { useState } from "react";

const OAUTH_ERRORS: Record<string, string> = {
  google_unavailable: "Google sign-in is not set up on this server yet.",
  google_state: "That sign-in link expired. Please try again.",
  google_unverified: "Google has not verified that email address, so we cannot use it to sign in.",
  google_failed: "We could not complete sign-in with Google. Please try again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
};

export function AuthForm({ mode, googleEnabled }: { mode: "login" | "signup"; googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";
  // Google redirects back here with ?error=... when a flow could not finish.
  const oauthError = OAUTH_ERRORS[searchParams.get("error") ?? ""];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      // Only allow same-site relative redirects.
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/history";
      router.replace(target);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <h1 style={{ fontSize: "1.5rem" }}>{isSignup ? "Create an account" : "Log in"}</h1>
      <p className="muted small">
        {isSignup
          ? "An account keeps your scan history private to you."
          : "Welcome back. Your scan history is private to your account."}
      </p>

      {googleEnabled && (
        <div style={{ marginTop: "1.25rem" }}>
          <GoogleButton
            next={next ?? undefined}
            label={isSignup ? "Sign up with Google" : "Continue with Google"}
          />
          <div className="or-divider">
            <span>or use your email</span>
          </div>
        </div>
      )}

      <form onSubmit={submit} style={{ marginTop: googleEnabled ? 0 : "1.25rem" }}>
        {(error || oauthError) && (
          <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>
            {error ?? oauthError}
          </p>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">
            Password {isSignup && <span className="hint">(at least 8 characters)</span>}
          </label>
          <input
            id="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={isSignup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? "Please wait..." : isSignup ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="small muted" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
        {isSignup ? (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/signup">Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
