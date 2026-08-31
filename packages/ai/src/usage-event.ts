/**
 * AI cost telemetry (Pricing + AI Cost Guardrails v1.0 §7).
 *
 * Every AI / OCR call emits one `AiUsageEvent`. Ids are pseudonymous (never the
 * raw user/child id — Privacy Architecture). The persisted copy is table
 * `ai_usage_events`; dashboards roll these up by plan / cohort (§7).
 */

import type { Plan } from '@copilot/domain';
import type { AiOperation } from './routing.js';
import { PLANNING_FX_VND_PER_USD, usdToVnd } from './pricing.js';

export type UsageProvider = 'openai' | 'anthropic' | 'google' | 'internal' | 'mock';

export interface AiUsageEvent {
  readonly userRef: string; // pseudonymous
  readonly childRef: string | null; // pseudonymous
  readonly plan: Plan;
  readonly operationType: AiOperation;
  readonly provider: UsageProvider;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly imageCount: number | null;
  readonly ocrPages: number | null;
  readonly estimatedCostUsd: number;
  readonly estimatedCostVnd: number;
  readonly latencyMs: number;
  readonly confidence: number | null;
  readonly escalationReason: string | null;
  readonly schemaValid: boolean;
  readonly requestId: string;
  readonly createdAt: string; // ISO
}

export type UsageEventSink = (event: AiUsageEvent) => void;

export interface BuildUsageEventInput {
  readonly userRef: string;
  readonly childRef?: string | null;
  readonly plan: Plan;
  readonly operationType: AiOperation;
  readonly provider: UsageProvider;
  readonly model: string;
  readonly inputTokens?: number | null;
  readonly cachedInputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly imageCount?: number | null;
  readonly ocrPages?: number | null;
  readonly estimatedCostUsd: number;
  readonly fxVndPerUsd?: number;
  readonly latencyMs: number;
  readonly confidence?: number | null;
  readonly escalationReason?: string | null;
  readonly schemaValid: boolean;
  readonly requestId: string;
  readonly now?: () => Date;
}

export function buildUsageEvent(input: BuildUsageEventInput): AiUsageEvent {
  const fx = input.fxVndPerUsd ?? PLANNING_FX_VND_PER_USD;
  return {
    userRef: input.userRef,
    childRef: input.childRef ?? null,
    plan: input.plan,
    operationType: input.operationType,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    imageCount: input.imageCount ?? null,
    ocrPages: input.ocrPages ?? null,
    estimatedCostUsd: input.estimatedCostUsd,
    estimatedCostVnd: usdToVnd(input.estimatedCostUsd, fx),
    latencyMs: input.latencyMs,
    confidence: input.confidence ?? null,
    escalationReason: input.escalationReason ?? null,
    schemaValid: input.schemaValid,
    requestId: input.requestId,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/* ---- dashboard rollups (§7) ---- */

export interface CostRollup {
  readonly events: number;
  readonly totalVnd: number;
  readonly totalUsd: number;
  readonly cheapPathShare: number; // deterministic/bank/cache/luna share
  readonly advancedShare: number;
  readonly escalationRate: number;
  readonly ocrFallbackRate: number;
  readonly schemaValidRate: number;
}

const CHEAP_MODELS = /luna|internal|mock/i;

export function rollup(events: readonly AiUsageEvent[]): CostRollup {
  const n = events.length;
  if (n === 0) {
    return { events: 0, totalVnd: 0, totalUsd: 0, cheapPathShare: 1, advancedShare: 0, escalationRate: 0, ocrFallbackRate: 0, schemaValidRate: 1 };
  }
  const cheap = events.filter((e) => CHEAP_MODELS.test(e.model)).length;
  const advanced = events.filter((e) => /terra|sonnet|sol/i.test(e.model)).length;
  const escalated = events.filter((e) => e.escalationReason !== null).length;
  const ocr = events.filter((e) => (e.ocrPages ?? 0) > 0).length;
  const valid = events.filter((e) => e.schemaValid).length;
  return {
    events: n,
    totalVnd: events.reduce((s, e) => s + e.estimatedCostVnd, 0),
    totalUsd: events.reduce((s, e) => s + e.estimatedCostUsd, 0),
    cheapPathShare: cheap / n,
    advancedShare: advanced / n,
    escalationRate: escalated / n,
    ocrFallbackRate: ocr / n,
    schemaValidRate: valid / n,
  };
}

/** Per-plan AI COGS per active user for the traffic-light dashboard (§7). */
export function cogsPerUser(events: readonly AiUsageEvent[], plan: Plan, activeUsers: number): number {
  if (activeUsers <= 0) return 0;
  const planVnd = events.filter((e) => e.plan === plan).reduce((s, e) => s + e.estimatedCostVnd, 0);
  return planVnd / activeUsers;
}
