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

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Thinking is on by default on this model tier and its tokens count towards
 * `max_tokens`, so the ceiling has to leave room for reasoning *and* the JSON
 * we actually want back. Too low and the reply is truncated mid-object.
 */
const MAX_TOKENS = 16000;

/**
 * Extraction from a single screenshot is bounded work, and a person is waiting
 * on a spinner. "medium" keeps latency and cost sane; raise it to "high" if you
 * would rather spend more per scan on the model's judgement.
 */
const EFFORT = "medium" as const;

/** The formats the vision API accepts. Mirrors our own upload allowlist. */
const SUPPORTED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function isSupported(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/**
 * Anthropic vision implementation of the AiProvider seam.
 *
 * The API key is read from the server environment, held only in this module,
 * and never logged or returned. Upstream error bodies are never forwarded to
 * the user - only a status code reaches the server log.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /** Maps an SDK error onto a message that is safe to show a user. */
  private translateError(err: unknown): AiProviderError {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error(
        `[ai:anthropic] auth rejected (status ${err.status}). Check that ANTHROPIC_API_KEY is set correctly in the server environment.`,
      );
      return new AiProviderError("The analysis service is not configured correctly.", 502);
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[ai:anthropic] rate limited (status 429)");
      return new AiProviderError(
        "The analysis service is busy right now. Please try again in a moment.",
        429,
      );
    }
    if (err instanceof Anthropic.BadRequestError) {
      // Usually an image the API will not take: over 10 MB base64, or larger
      // than 8000x8000 px. Our own limits catch the common cases first.
      console.error("[ai:anthropic] request rejected (status 400)");
      return new AiProviderError(
        "That image could not be processed. Try a smaller or clearer screenshot.",
        400,
      );
    }
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    console.error(`[ai:anthropic] request failed with status ${status}`);
    return new AiProviderError("The analysis service could not be reached. Please try again.", 502);
  }

  private async complete(content: Anthropic.MessageParam["content"]): Promise<AnalysisExtraction> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // We never surface the model's reasoning, so keep it out of the response.
        thinking: { type: "adaptive", display: "omitted" },
        output_config: { effort: EFFORT },
        system: buildSystemPrompt(),
        messages: [{ role: "user", content }],
      });
    } catch (err) {
      throw this.translateError(err);
    }

    // A refusal is a successful HTTP response with no usable content, so it has
    // to be checked before reading the blocks.
    if (message.stop_reason === "refusal") {
      console.error(
        `[ai:anthropic] model declined the request (category: ${message.stop_details?.category ?? "unknown"})`,
      );
      throw new AiProviderError(
        "The analysis service could not review that image. Try a different screenshot.",
        422,
      );
    }
    if (message.stop_reason === "max_tokens") {
      console.error("[ai:anthropic] response hit max_tokens; raise MAX_TOKENS if this recurs");
      throw new AiProviderError(
        "The analysis did not finish. Please try again with a smaller screenshot.",
        502,
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    try {
      return parseExtraction(text);
    } catch {
      console.error("[ai:anthropic] could not parse the model response as JSON");
      throw new AiProviderError("The analysis service returned an unreadable response.", 502);
    }
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<AnalysisExtraction> {
    if (!isSupported(input.mediaType)) {
      throw new AiProviderError(`Unsupported image type: ${input.mediaType}`, 415);
    }
    // The image goes first: Claude reads image-then-text prompts most reliably.
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
