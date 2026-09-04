import type { AnalysisExtraction } from "@/lib/types";
import type { AiProvider, ImageAnalysisInput, TextAnalysisInput } from "./provider";
import { keywordObservations } from "./heuristics";

const DEMO_NOTE =
  "Demo analyser: no AI provider is configured, so the screenshot itself was not read. Set ANTHROPIC_API_KEY to enable real image analysis.";

/**
 * Offline stand-in for a real provider so the whole flow runs (and can be
 * tested) without an API key. It cannot see images, so for uploads it reports
 * only what it can honestly derive - any text the user typed as context - and
 * says so in `notes`.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async analyzeImage(input: ImageAnalysisInput): Promise<AnalysisExtraction> {
    const context = input.userContext?.trim() ?? "";
    const observations = keywordObservations(context);

    const fields = [
      { key: "source", label: "Source", value: "Uploaded screenshot" },
      {
        key: "image_type",
        label: "Image type",
        value: input.mediaType,
      },
    ];
    if (context) {
      fields.push({ key: "user_context", label: "Context you added", value: context });
    }

    return {
      summary: context
        ? "Demo analysis based only on the notes you typed - the screenshot itself was not read."
        : "Demo analysis. No AI provider is configured, so no warning signs could be read from this screenshot.",
      fields,
      observations,
      notes: [DEMO_NOTE],
    };
  }

  async analyzeText(input: TextAnalysisInput): Promise<AnalysisExtraction> {
    return {
      summary: "Demo analysis of the text you provided, using keyword rules only.",
      fields: [{ key: "input", label: "Input", value: input.text.slice(0, 300) }],
      observations: keywordObservations(input.text),
      notes: [DEMO_NOTE],
    };
  }
}
