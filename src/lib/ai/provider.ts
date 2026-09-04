import type { AnalysisExtraction } from "@/lib/types";

export interface ImageAnalysisInput {
  /** Raw image bytes, base64 encoded. Never persisted. */
  base64: string;
  /** Validated MIME type, e.g. "image/png". */
  mediaType: string;
  /** Optional free-text context the user typed alongside the upload. */
  userContext?: string;
}

export interface TextAnalysisInput {
  text: string;
  /** What the text is, e.g. "url" - lets a provider tailor its prompt. */
  kind: "url" | "message";
}

/**
 * The seam every AI provider implements. Route handlers depend only on this
 * interface, so swapping the vendor means adding one file and one factory
 * branch - nothing in the app or the risk engine changes.
 */
export interface AiProvider {
  readonly name: string;
  analyzeImage(input: ImageAnalysisInput): Promise<AnalysisExtraction>;
  /** Optional: providers that cannot do text-only analysis may omit this. */
  analyzeText?(input: TextAnalysisInput): Promise<AnalysisExtraction>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
