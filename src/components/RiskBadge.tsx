import type { RiskLevel } from "@/lib/types";
import { LEVEL_LABEL } from "@/lib/risk/engine";

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`badge risk-${level}`}>
      <span className="dot" aria-hidden="true" />
      {LEVEL_LABEL[level]}
    </span>
  );
}
