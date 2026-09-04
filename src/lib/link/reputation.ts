import type { SignalObservation } from "@/lib/types";

/**
 * Plug point for deeper domain-reputation checks (blocklist feeds, WHOIS age,
 * TLS certificate age, Safe Browsing, ...). The MVP ships a no-op provider; a
 * real one implements this interface and is returned from
 * `getReputationProvider()` without touching the rest of the link checker.
 */
export interface ReputationProvider {
  readonly name: string;
  check(url: URL): Promise<{ observations: SignalObservation[]; notes: string[] }>;
}

class NoopReputationProvider implements ReputationProvider {
  readonly name = "none";
  async check(): Promise<{ observations: SignalObservation[]; notes: string[] }> {
    return {
      observations: [],
      notes: [
        "This check looks at the shape of the address only. It does not open the page or check the domain against a reputation database.",
      ],
    };
  }
}

let cached: ReputationProvider | null = null;

export function getReputationProvider(): ReputationProvider {
  cached ??= new NoopReputationProvider();
  return cached;
}
