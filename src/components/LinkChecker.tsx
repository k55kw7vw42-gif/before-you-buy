"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateUrl } from "@/lib/validation";

export function LinkChecker() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const validation = validateUrl(url);
    if (!validation.ok) {
      setError(validation.error ?? "That does not look like a valid link.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "We could not check that link. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/results/${data.id}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && (
        <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="url">Link to check</label>
        <input
          id="url"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="paypal-secure-billing.example.com/verify"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="hint" style={{ marginTop: "0.4rem" }}>
          Paste the whole address if you can. Do not open a link you are unsure about.
        </p>
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={!url.trim() || busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Checking...
          </>
        ) : (
          "Check this link"
        )}
      </button>

      {busy && (
        <div className="skeleton-block" aria-hidden="true">
          <div className="skeleton-line w-40" />
          <div className="skeleton-line w-60" />
        </div>
      )}

      <p className="small muted" style={{ margin: "0.85rem 0 0" }}>
        This check reads the address only. It does not open the page, and it does not yet check the
        domain against a reputation database.
      </p>
    </form>
  );
}
