/**
 * AI pricing registry (Pricing + AI Cost Guardrails v1.0 §2, §10.6).
 *
 * Public model prices are EXTERNAL CONFIGURATION with an effective date — never
 * constants baked into educational or billing logic. This module is the typed,
 * effective-dated lookup; the persisted copy is table `ai_pricing_registry`.
 *
 * Rule (§10.6): "never hard-code public API prices into domain logic". Domain
 * code asks the registry for a price *as of* a date; the registry is seeded from
 * config / DB, and the seed below is only a documented default for dev + tests.
 */

export type PricingUnit = 'per_million_tokens' | 'per_1000_pages';

export interface PriceEntry {
  readonly model: string;
  readonly provider: 'openai' | 'anthropic' | 'google';
  readonly unit: PricingUnit;
  /** USD. For token models: per 1M input tokens. For OCR: unused (see pagesPerThousandUsd). */
  readonly inputPerMillionUsd?: number;
  /** USD per 1M output tokens (token models only). */
  readonly outputPerMillionUsd?: number;
  /** USD per 1000 pages, after any free tier (OCR only). */
  readonly pagesPerThousandUsd?: number;
  /** Free allowance before metered pricing applies (OCR only). */
  readonly freeUnits?: number;
  /** ISO date this price becomes effective. */
  readonly effectiveDate: string;
  readonly source: string;
}

/** Planning FX for internal VND estimates only — NOT for billing (§2). */
export const PLANNING_FX_VND_PER_USD = 26_000;

const SRC = 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2 (2026-08-31)';

/**
 * Documented default price table (v1.0). Prices are candidates for planning;
 * the advanced-model choice (Sonnet 5 vs Terra) is benchmark-gated (§3.2, §11).
 */
export const DEFAULT_PRICE_TABLE: readonly PriceEntry[] = [
  { model: 'gpt-5.6-luna', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2, effectiveDate: '2026-08-31', source: SRC },
  { model: 'gpt-5.6-terra', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 2.0, outputPerMillionUsd: 12.0, effectiveDate: '2026-08-31', source: SRC },
  { model: 'gpt-5.6-sol', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 4.0, outputPerMillionUsd: 20.0, effectiveDate: '2026-08-31', source: SRC },
  { model: 'claude-sonnet-5', provider: 'anthropic', unit: 'per_million_tokens', inputPerMillionUsd: 2.0, outputPerMillionUsd: 10.0, effectiveDate: '2026-08-31', source: SRC },
  { model: 'google-document-ai-enterprise-ocr', provider: 'google', unit: 'per_1000_pages', pagesPerThousandUsd: 1.5, freeUnits: 1000, effectiveDate: '2026-08-31', source: SRC },
] as const;

export class PricingRegistry {
  readonly #entries: PriceEntry[];

  constructor(entries: readonly PriceEntry[] = DEFAULT_PRICE_TABLE) {
    this.#entries = [...entries].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  /** The price for `model` in effect on `asOf` (defaults to the latest). */
  priceAt(model: string, asOf: Date = new Date()): PriceEntry {
    const iso = asOf.toISOString().slice(0, 10);
    const match = this.#entries
      .filter((e) => e.model === model && e.effectiveDate <= iso)
      .at(-1);
    if (!match) throw new Error(`no price for model "${model}" effective on or before ${iso}`);
    return match;
  }

  has(model: string): boolean {
    return this.#entries.some((e) => e.model === model);
  }

  list(): readonly PriceEntry[] {
    return this.#entries;
  }
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens: number;
}

/**
 * USD cost of a token-model call. Cached input tokens are billed at input rate
 * here (conservative) unless a provider-specific cached rate is added later.
 */
export function tokenCostUsd(entry: PriceEntry, usage: TokenUsage): number {
  if (entry.unit !== 'per_million_tokens' || entry.inputPerMillionUsd === undefined || entry.outputPerMillionUsd === undefined) {
    throw new Error(`"${entry.model}" is not a per-token model`);
  }
  const inTok = usage.inputTokens + (usage.cachedInputTokens ?? 0);
  return (inTok / 1_000_000) * entry.inputPerMillionUsd + (usage.outputTokens / 1_000_000) * entry.outputPerMillionUsd;
}

/**
 * USD cost of processing `pages` more OCR pages, given how many pages have
 * already been processed this accounting period. The free tier (§2: first 1,000
 * pages free) is consumed before metered pricing applies.
 */
export function ocrCostUsd(entry: PriceEntry, pages: number, pagesProcessedThisPeriod = 0): number {
  if (entry.unit !== 'per_1000_pages' || entry.pagesPerThousandUsd === undefined) {
    throw new Error(`"${entry.model}" is not an OCR page model`);
  }
  const free = entry.freeUnits ?? 0;
  const billedBefore = Math.max(0, pagesProcessedThisPeriod - free);
  const billedAfter = Math.max(0, pagesProcessedThisPeriod + pages - free);
  const newlyBillable = billedAfter - billedBefore;
  return (newlyBillable / 1000) * entry.pagesPerThousandUsd;
}

export function usdToVnd(usd: number, fx: number = PLANNING_FX_VND_PER_USD): number {
  return Math.round(usd * fx);
}
