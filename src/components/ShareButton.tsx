"use client";

import { useState } from "react";
import type { RiskLevel } from "@/lib/types";

/**
 * Shares the verdict, not the result. Results are owner-only and 404 for
 * anyone else (see getScanForOwner), so a link to this specific scan would be
 * broken for whoever receives it - the share links to the app itself instead.
 *
 * Copy stays inside the app's own hedged tone (never "this is a scam"),
 * because that wording is a deliberate, tested product decision, not a style
 * choice this component gets to override.
 */

const LEAD: Record<RiskLevel, string> = {
  high: "⚠️ Potential risk detected",
  medium: "⚠️ Warning signs found",
  low: "✅ No strong warning signs found",
};

function shareText(score: number, level: RiskLevel, appUrl: string): string {
  return `${LEAD[level]} — I checked this before paying with Before You Pay (risk score ${score}/100). Verify before you send money: ${appUrl}`;
}

export function ShareButton({ score, level }: { score: number; level: RiskLevel }) {
  const [state, setState] = useState<"idle" | "copied" | "shared">("idle");

  async function share() {
    const appUrl = typeof window !== "undefined" ? window.location.origin : "";
    const text = shareText(score, level, appUrl);

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text, title: "Before You Pay" });
        setState("shared");
        window.setTimeout(() => setState("idle"), 2000);
        return;
      } catch {
        // Cancelled or unsupported mid-call - fall through to copy.
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      /* Clipboard access denied - nothing more we can do here. */
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-share${state === "copied" ? " copied" : ""}`}
      onClick={share}
    >
      {state === "copied" ? "Copied ✓" : state === "shared" ? "Shared ✓" : "Share this result"}
    </button>
  );
}
