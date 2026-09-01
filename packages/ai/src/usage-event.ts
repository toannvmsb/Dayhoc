/**
 * AI cost telemetry — `AICostLedger` (Pricing/AI Cost/Routing **v1.1** §10, §12).
 * See docs/implementation/15_AI_COST_AND_MODEL_ROUTING.md.
 *
 * Every AI / OCR call emits one `AiUsageEvent`. Ids are pseudonymous (never the
 * raw user/child id). The persisted copy is table `ai_usage_events`. Cost is
 * forecast BY OPERATION, not by tokens/user (v1.1 §12).
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
  readonly modelVersion: string | null; // v1.1
  readonly priceConfigEffectiveDate: string | null; // v1.1 — ISO date of the price row used
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly imageCount: number | null;
  readonly ocrPages: number | null;
  /**
   * FORECAST cost from unit economics (routing, model choice) — used by
   * `forecastByOperation` for budget projections, NEVER the accounting source of
   * truth (doc 14 C4.1 §12).
   */
  readonly estimatedCostUsd: number;
  readonly estimatedCostVnd: number;
  /**
   * ACTUAL cost computed from the provider response after the call (tokens ×
   * price-config, image/OCR usage). `null` until the call returns. This is the
   * ledger's source of truth. Mock → 0.
   */
  readonly actualCostUsd: number | null;
  readonly actualCostVnd: number | null;
  readonly latencyMs: number;
  readonly confidence: number | null;
  readonly retryCount: number; // v1.1
  readonly escalatedFrom: string | null; // v1.1 — primary tier when an escalation fired
  readonly escalationReason: string | null;
  readonly generationSpecId: string | null; // v1.1 — links a call to its ExerciseGenerationSpec
  readonly learningContextSource: string | null; // v1.1 — TEACHER_UPDATE | ... | CURRICULUM_TIMELINE
  readonly kTarget: string | null; // v1.1
  readonly tTarget: string | null; // v1.1
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
  readonly modelVersion?: string | null;
  readonly priceConfigEffectiveDate?: string | null;
  readonly inputTokens?: number | null;
  readonly cachedInputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly imageCount?: number | null;
  readonly ocrPages?: number | null;
  readonly estimatedCostUsd: number;
  /** Computed from the provider response; omit / null until the call returns. Mock → 0. */
  readonly actualCostUsd?: number | null;
  readonly fxVndPerUsd?: number;
  readonly latencyMs: number;
  readonly confidence?: number | null;
  readonly retryCount?: number;
  readonly escalatedFrom?: string | null;
  readonly escalationReason?: string | null;
  readonly generationSpecId?: string | null;
  readonly learningContextSource?: string | null;
  readonly kTarget?: string | null;
  readonly tTarget?: string | null;
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
    modelVersion: input.modelVersion ?? null,
    priceConfigEffectiveDate: input.priceConfigEffectiveDate ?? null,
    inputTokens: input.inputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    imageCount: input.imageCount ?? null,
    ocrPages: input.ocrPages ?? null,
    estimatedCostUsd: input.estimatedCostUsd,
    estimatedCostVnd: usdToVnd(input.estimatedCostUsd, fx),
    actualCostUsd: input.actualCostUsd ?? null,
    actualCostVnd:
      input.actualCostUsd === undefined || input.actualCostUsd === null
        ? null
        : usdToVnd(input.actualCostUsd, fx),
    latencyMs: input.latencyMs,
    confidence: input.confidence ?? null,
    retryCount: input.retryCount ?? 0,
    escalatedFrom: input.escalatedFrom ?? null,
    escalationReason: input.escalationReason ?? null,
    generationSpecId: input.generationSpecId ?? null,
    learningContextSource: input.learningContextSource ?? null,
    kTarget: input.kTarget ?? null,
    tTarget: input.tTarget ?? null,
    schemaValid: input.schemaValid,
    requestId: input.requestId,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/* ---- dashboard rollups (v1.1 §10) ---- */

export interface CostRollup {
  readonly events: number;
  readonly totalVnd: number;
  readonly totalUsd: number;
  readonly cheapPathShare: number; // luna/internal/mock share
  readonly advancedShare: number;
  readonly escalationRate: number;
  readonly ocrFallbackRate: number;
  readonly schemaValidRate: number;
  readonly retryRate: number;
}

const CHEAP_MODELS = /luna|internal|mock/i;
const ADVANCED_MODELS = /terra|sonnet|sol/i;

export function rollup(events: readonly AiUsageEvent[]): CostRollup {
  const n = events.length;
  if (n === 0) {
    return { events: 0, totalVnd: 0, totalUsd: 0, cheapPathShare: 1, advancedShare: 0, escalationRate: 0, ocrFallbackRate: 0, schemaValidRate: 1, retryRate: 0 };
  }
  const cheap = events.filter((e) => CHEAP_MODELS.test(e.model)).length;
  const advanced = events.filter((e) => ADVANCED_MODELS.test(e.model)).length;
  const escalated = events.filter((e) => e.escalationReason !== null || e.escalatedFrom !== null).length;
  const ocr = events.filter((e) => (e.ocrPages ?? 0) > 0).length;
  const valid = events.filter((e) => e.schemaValid).length;
  const retried = events.filter((e) => e.retryCount > 0).length;
  return {
    events: n,
    // accounting totals: ACTUAL cost, falling back to the forecast until a call returns
    totalVnd: events.reduce((s, e) => s + (e.actualCostVnd ?? e.estimatedCostVnd), 0),
    totalUsd: events.reduce((s, e) => s + (e.actualCostUsd ?? e.estimatedCostUsd), 0),
    cheapPathShare: cheap / n,
    advancedShare: advanced / n,
    escalationRate: escalated / n,
    ocrFallbackRate: ocr / n,
    schemaValidRate: valid / n,
    retryRate: retried / n,
  };
}

/** Per-plan AI COGS per active user — feeds the guardrail. */
export function cogsPerUser(events: readonly AiUsageEvent[], plan: Plan, activeUsers: number): number {
  if (activeUsers <= 0) return 0;
  const planVnd = events
    .filter((e) => e.plan === plan)
    .reduce((s, e) => s + (e.actualCostVnd ?? e.estimatedCostVnd), 0);
  return planVnd / activeUsers;
}

/* ---- operation-dimension forecast (v1.1 §12) ---- */

export interface OperationUnitCost {
  readonly operation: AiOperation;
  /** Measured mean VND per operation (from telemetry). */
  readonly unitCostVnd: number;
  /** Projected monthly volume per active user. */
  readonly monthlyVolumePerUser: number;
  /** ×(1 + retry rate + escalation uplift). */
  readonly retryEscalationFactor: number;
}

/**
 * `Monthly AI COGS per active user = Σ(volume × unit cost × retry/escalation factor)`.
 * NOT a tokens/user estimate (v1.1 §12).
 */
export function forecastByOperation(lines: readonly OperationUnitCost[]): number {
  return lines.reduce(
    (sum, l) => sum + l.monthlyVolumePerUser * l.unitCostVnd * l.retryEscalationFactor,
    0,
  );
}

/** Derive per-operation mean unit cost + retry factor from a telemetry window. */
export function measuredUnitCosts(events: readonly AiUsageEvent[]): Map<AiOperation, { unitCostVnd: number; retryEscalationFactor: number; n: number }> {
  const by = new Map<AiOperation, { cost: number; n: number; retriesOrEsc: number }>();
  for (const e of events) {
    const rec = by.get(e.operationType) ?? { cost: 0, n: 0, retriesOrEsc: 0 };
    rec.cost += e.actualCostVnd ?? e.estimatedCostVnd; // measured unit economics prefer ACTUAL
    rec.n += 1;
    if (e.retryCount > 0 || e.escalatedFrom !== null) rec.retriesOrEsc += 1;
    by.set(e.operationType, rec);
  }
  const out = new Map<AiOperation, { unitCostVnd: number; retryEscalationFactor: number; n: number }>();
  for (const [op, r] of by) {
    out.set(op, {
      unitCostVnd: r.cost / r.n,
      retryEscalationFactor: 1 + r.retriesOrEsc / r.n,
      n: r.n,
    });
  }
  return out;
}
