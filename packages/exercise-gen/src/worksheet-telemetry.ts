import type { Plan } from '@copilot/domain';
import { buildUsageEvent, type AiUsageEvent } from '@copilot/ai';
import type { WorksheetTrace } from './worksheet-orchestrator.js';

/**
 * Map a `WorksheetTrace` to canonical `AiUsageEvent` rows for the `AICostLedger`
 * (`ai_usage_events`) — one event per model that participated (doc 65 §4).
 *
 * Cost accounting is INDEPENDENT of subscription plan: `plan` is recorded for
 * budget rollups but never gates routing. `actualCostUsd` from the per-model
 * breakdown is the ledger's source of truth; `estimatedCostUsd` is a forecast.
 *
 * NO PII: `userRef` / `childRef` are pseudonymous; no prompt / answer text.
 */

export interface WorksheetUsageContext {
  readonly userRef: string; // pseudonymous
  readonly childRef?: string | null; // pseudonymous
  readonly plan: Plan;
  readonly learningContextSource?: string | null;
  readonly kTarget?: string | null;
  readonly tTarget?: string | null;
  readonly fxVndPerUsd?: number;
  readonly now?: () => Date;
  readonly newRequestId?: () => string;
}

export function worksheetTraceToUsageEvents(
  trace: WorksheetTrace,
  ctx: WorksheetUsageContext,
): readonly AiUsageEvent[] {
  const newId = ctx.newRequestId ?? (() => `wsu_${Math.random().toString(36).slice(2, 12)}`);
  const events: AiUsageEvent[] = [];

  for (const m of trace.totals.byModel) {
    events.push(
      buildUsageEvent({
        userRef: ctx.userRef,
        childRef: ctx.childRef ?? null,
        plan: ctx.plan,
        operationType: 'worksheet_batch_generation',
        provider: m.provider as never,
        model: m.model,
        modelVersion: m.modelVersion,
        priceConfigEffectiveDate: m.priceConfigEffectiveDate,
        inputTokens: m.inputTokens || null,
        outputTokens: m.outputTokens || null,
        estimatedCostUsd: 0,
        actualCostUsd: m.actualCostUsd,
        ...(ctx.fxVndPerUsd !== undefined ? { fxVndPerUsd: ctx.fxVndPerUsd } : {}),
        latencyMs: m.latencyMs,
        retryCount: m.retries,
        escalatedFrom: m.fallbackCalls > 0 ? trace.totals.byModel.find((x) => x.model !== m.model)?.model ?? null : null,
        escalationReason: m.fallbackCalls > 0 ? 'default-model failures escalated' : null,
        generationSpecId: trace.generationSpecId,
        learningContextSource: ctx.learningContextSource ?? null,
        kTarget: ctx.kTarget ?? null,
        tTarget: ctx.tTarget ?? null,
        schemaValid: m.schemaValidCalls === m.calls,
        requestId: newId(),
        ...(ctx.now ? { now: ctx.now } : {}),
      }),
    );
  }
  return events;
}
