import type { z } from 'zod';

/**
 * Replaceable AI provider port (Engineering rules: keep AI providers replaceable;
 * no LLM output trusted without validation; track token/cost/latency).
 *
 * Every operation returns raw text + usage; the orchestrator validates the text
 * against a schema and records provenance. Swapping Anthropic ↔ any other model
 * is a provider swap, nothing else changes.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** JSON schema the caller expects back — passed to providers that support it. */
  readonly responseSchemaName?: string;
}

export interface LlmResponse {
  readonly text: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/** Vision/OCR provider port — same replaceability contract. */
export interface VisionProvider {
  readonly name: string;
  recognize(request: VisionRequest): Promise<LlmResponse>;
}

export interface VisionRequest {
  readonly imageRefs: readonly string[];
  readonly instruction: string;
  readonly responseSchemaName?: string;
}

export interface ProviderPricing {
  /** USD per 1M input / output tokens. */
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

export function estimateCostUsd(
  usage: LlmResponse['usage'],
  pricing: ProviderPricing,
): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export type SchemaOf<T> = z.ZodType<T>;
