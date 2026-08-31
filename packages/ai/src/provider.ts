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

/**
 * Child-data categories (Privacy Architecture §4). A payload sent to a provider
 * declares which of these it contains; the provider declares which it may receive.
 */
export const DATA_CATEGORIES = [
  'profile_context', // display name, grade, school context, goals
  'raw_schoolwork', // photos/PDFs/handwriting
  'learning_activity', // attempts, submissions, hint use, time
  'derived_state', // evidence, twin, mastery, gaps, thinking profile
  'ai_insights', // classifications, diagnoses, summaries
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/**
 * Per-provider compliance metadata (Privacy Architecture §10). The orchestrator
 * refuses a call whose payload categories exceed `dataCategoriesAllowed`, and
 * refuses any provider with `trainingAllowed === true` for child-data operations.
 */
export interface ProviderCompliance {
  readonly provider: string;
  readonly processingRegion: string;
  readonly crossBorder: boolean;
  readonly dataCategoriesAllowed: readonly DataCategory[];
  readonly providerRetention: string;
  /** MUST be false for any provider that touches child data. */
  readonly trainingAllowed: boolean;
  readonly dpaStatus: 'signed' | 'pending' | 'not_applicable';
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
