import { randomUUID } from 'node:crypto';
import { PricingRegistry, buildUsageEvent, tokenCostUsd, type AiUsageEvent } from '@copilot/ai';
import type { VisionUsage, VisionUsageContext } from '@copilot/uploads';

/**
 * Backlog B2-01 — every live document-vision call is written to the AI cost ledger
 * (`ai_usage_events`, operation `vision_extraction`), including calls whose output was rejected:
 * the provider bills those too. Cost = tokens × the effective-dated price in the registry; a model
 * with no registered price is recorded at 0 with no price date, which `visionDailyUsage` and the
 * measurement script surface as "unpriced" instead of hiding it.
 */
const registry = new PricingRegistry();

export function visionUsageEvent(usage: VisionUsage, ctx: VisionUsageContext | undefined, now: Date): AiUsageEvent {
  let cost = 0;
  let priceDate: string | null = null;
  if (registry.has(usage.model)) {
    const entry = registry.priceAt(usage.model, now);
    cost = tokenCostUsd(entry, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    priceDate = entry.effectiveDate;
  }
  return buildUsageEvent({
    userRef: ctx?.userRef ?? 'unknown',
    childRef: ctx?.childRef ?? null,
    plan: 'free',
    operationType: 'vision_extraction',
    provider: usage.provider === 'openai' ? 'openai' : 'internal',
    model: usage.model,
    priceConfigEffectiveDate: priceDate,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    imageCount: usage.imageCount,
    ocrPages: usage.imageCount,
    estimatedCostUsd: cost,
    actualCostUsd: priceDate === null ? null : cost,
    latencyMs: usage.latencyMs,
    schemaValid: usage.schemaValid,
    requestId: randomUUID(),
    now: () => now,
  });
}

/** Hard ceilings so a bug or an abusive client cannot turn photo reading into an open tap. */
export const VISION_DAILY_LIMITS = { perChild: 10, global: 100 } as const;

export function visionLimitsFromEnv(env: Readonly<Record<string, string | undefined>>): { perChild: number; global: number } {
  const n = (v: string | undefined, d: number): number => {
    const x = Number(v);
    return Number.isInteger(x) && x > 0 ? x : d;
  };
  return {
    perChild: n(env['DZ_VISION_DAILY_PER_CHILD'], VISION_DAILY_LIMITS.perChild),
    global: n(env['DZ_VISION_DAILY_GLOBAL'], VISION_DAILY_LIMITS.global),
  };
}
