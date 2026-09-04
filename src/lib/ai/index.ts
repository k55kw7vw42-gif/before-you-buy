import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { AiProvider } from "./provider";

export * from "./provider";

let cached: AiProvider | null = null;

/**
 * Single place the app resolves its AI provider. Add a vendor by implementing
 * AiProvider and adding a branch here; nothing else in the app changes.
 *
 * Defaults to the real provider when a key is present, and to the offline demo
 * analyser when it is not, so a fresh clone still runs end to end.
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached;

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  const choice = configured || (key ? "anthropic" : "mock");

  switch (choice) {
    case "anthropic":
      if (!key) {
        throw new Error(
          "AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set in the server environment.",
        );
      }
      cached = new AnthropicProvider(key);
      break;
    case "mock":
      cached = new MockProvider();
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER "${choice}". Supported values: anthropic, mock.`);
  }
  return cached;
}

/** True when the app is running without a real vision provider. */
export function isDemoMode(): boolean {
  try {
    return getAiProvider().name === "mock";
  } catch {
    return false;
  }
}
