import type { RiskLevel } from "@/lib/types";

/**
 * Score as a ring. The number and the badge carry the meaning, so the ring is
 * decorative - colour is never the only indicator.
 */
export function ScoreDial({ score, level }: { score: number; level: RiskLevel }) {
  return (
    <div
      className={`score-dial dial-${level}`}
      style={{ "--pct": String(score) } as React.CSSProperties}
      role="img"
      aria-label={`Risk score ${score} out of 100`}
    >
      <div className="dial-value">
        <div className="num">{score}</div>
        <div className="den">/ 100</div>
      </div>
    </div>
  );
}
