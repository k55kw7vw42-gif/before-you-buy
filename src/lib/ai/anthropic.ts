import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisExtraction } from "@/lib/types";
import {
  AiProviderError,
  type AiProvider,
  type ImageAnalysisInput,
  type TextAnalysisInput,
} from "./provider";
import { IMAGE_USER_PROMPT, buildSystemPrompt, urlUserPrompt } from "./prompt";
import { parseExtraction } from "./parse";

const DEFAULT_MODEL = "claude-sonnet-5";
const SUPPORTED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function isSupported(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/**
 * Anthropic vision implementation of the AiProvider seam.
 * The API key is read from the server environment and never leaves this module.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  private async complete(content: Anthropic.MessageParam["content"]): Promise<AnalysisExtraction> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content }],
      });
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status ?? 502 : 502;
      // Log the status for operators; the response body can echo configuration,
      // so it is never logged and never forwarded to the user.
      console.error(`[ai:anthropic] request failed with status ${status}`);
      throw new AiProviderError(
        status === 429
          ? "The analysis service is busy right now. Please try again in a moment."
          : "The analysis service could not be reached. Please try again.",
        status === 429 ? 429 : 502,
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    try {
      return parseExtraction(text);
    } catch {
      throw new AiProviderError("The analysis service returned an unreadable response.", 502);
    }
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<AnalysisExtraction> {
    if (!isSupported(input.mediaType)) {
      throw new AiProviderError(`Unsupported image type: ${input.mediaType}`, 415);
    }
    const content: Anthropic.MessageParam["content"] = [
      {
        type: "image",
        source: { type: "base64", media_type: input.mediaType, data: input.base64 },
      },
      {
        type: "text",
        text: input.userContext?.trim()
          ? `${IMAGE_USER_PROMPT}\n\nContext the user added: ${input.userContext.trim()}`
          : IMAGE_USER_PROMPT,
      },
    ];
    return this.complete(content);
  }

  async analyzeText(input: TextAnalysisInput): Promise<AnalysisExtraction> {
    return this.complete(input.kind === "url" ? urlUserPrompt(input.text) : input.text);
  }
}
