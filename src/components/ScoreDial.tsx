"use client";

import { useEffect, useRef, useState } from "react";
import type { RiskLevel } from "@/lib/types";

/**
 * Score as a ring, counting up on mount. The number and the badge carry the
 * meaning, so the ring is decorative - colour is never the only indicator.
 * Skips the animation under prefers-reduced-motion, per the same guard the
 * rest of the app's CSS already applies.
 */
export function ScoreDial({ score, level }: { score: number; level: RiskLevel }) {
  const [display, setDisplay] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || score <= 0) {
      setDisplay(score);
      return;
    }

    const duration = 700;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3; // ease-out-cubic
      setDisplay(Math.round(eased * score));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div
      className={`score-dial dial-${level}`}
      style={{ "--pct": String(display) } as React.CSSProperties}
      role="img"
      aria-label={`Risk score ${score} out of 100`}
    >
      <div className="dial-value">
        <div className="num">{display}</div>
        <div className="den">/ 100</div>
      </div>
    </div>
  );
}
