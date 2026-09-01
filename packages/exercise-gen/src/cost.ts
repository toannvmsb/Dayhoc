import { PricingRegistry, tokenCostUsd, usdToVnd, type TokenUsage } from '@copilot/ai';
import type { GenerationUsage } from './generator.js';

/**
 * ACTUAL cost of one generation call (doc 14 C5 §15) — computed from what the
 * provider actually reported, priced by the registry entry effective ON the
 * call date. Never a guess: if the model has no price entry, cost is `null`
 * and `priceConfigVersion` says why (§15: "do not pretend estimate is actual").
 */
export interface ActualCostResult {
  readonly actualCostUsd: number | null;
  readonly actualCostVnd: number | null;
  /** The resolved price entry's effective date — traces which price was used. */
  readonly priceConfigVersion: string | null;
}

const NO_PRICE: ActualCostResult = { actualCostUsd: null, actualCostVnd: null, priceConfigVersion: null };

/**
 * Compute actual cost from real provider usage. `registry` defaults to the
 * documented price table (`@copilot/ai` `DEFAULT_PRICE_TABLE`) — pass a live
 * one once prices move to config/DB (doc 15 §10.6: never hard-code prices into
 * domain logic; this function only *looks up*, it carries no prices itself).
 */
export function computeActualCost(
  usage: GenerationUsage | undefined,
  model: string,
  at: Date,
  registry: PricingRegistry = new PricingRegistry(),
  fxVndPerUsd?: number,
): ActualCostResult {
  if (!usage || !registry.has(model)) return NO_PRICE;
  try {
    const entry = registry.priceAt(model, at);
    if (entry.unit !== 'per_million_tokens') return NO_PRICE;
    const tokenUsage: TokenUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.cachedInputTokens !== undefined ? { cachedInputTokens: usage.cachedInputTokens } : {}),
    };
    const usd = tokenCostUsd(entry, tokenUsage);
    return {
      actualCostUsd: usd,
      actualCostVnd: usdToVnd(usd, fxVndPerUsd),
      priceConfigVersion: entry.effectiveDate,
    };
  } catch {
    return NO_PRICE;
  }
}
