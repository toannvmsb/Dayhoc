import type { Plan } from '@copilot/domain';
import { buildUsageEvent, type AiUsageEvent, type UsageProvider } from '@copilot/ai';

/**
 * Operation / cost contract (doc 14 C4 §M). Every generator call — Mock included —
 * produces one `GenerationOperation` whose shape maps 1:1 onto `AiUsageEvent`
 * (`operationType: 'worksheet_batch_generation'`). For the mock: provider MOCK,
 * model MOCK, cost 0. C5 swaps the generator for Luna without touching the
 * orchestrator or this contract.
 */
export interface GenerationOperation {
  readonly operationType: 'worksheet_batch_generation';
  readonly provider: UsageProvider;
  readonly model: string;
  readonly modelVersion: string | null;
  readonly generationSpecId: string;
  readonly kTarget: string | null;
  readonly tTarget: string | null;
  readonly retryCount: number;
  readonly schemaValid: boolean;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly requestId: string;
  readonly createdAt: string;
}

/** Identity + billing context the API layer adds when persisting telemetry (kept OUT of generation). */
export interface UsageContext {
  readonly plan: Plan;
  readonly userRef: string; // pseudonymous
  readonly childRef: string | null; // pseudonymous
  readonly fxVndPerUsd?: number;
  readonly learningContextSource?: string | null;
}

/** Map a generation operation onto the AI cost ledger event. */
export function generationOperationToUsageEvent(
  op: GenerationOperation,
  ctx: UsageContext,
): AiUsageEvent {
  return buildUsageEvent({
    userRef: ctx.userRef,
    childRef: ctx.childRef,
    plan: ctx.plan,
    operationType: op.operationType,
    provider: op.provider,
    model: op.model,
    modelVersion: op.modelVersion,
    estimatedCostUsd: op.estimatedCostUsd,
    ...(ctx.fxVndPerUsd !== undefined ? { fxVndPerUsd: ctx.fxVndPerUsd } : {}),
    latencyMs: op.latencyMs,
    retryCount: op.retryCount,
    generationSpecId: op.generationSpecId,
    learningContextSource: ctx.learningContextSource ?? null,
    kTarget: op.kTarget,
    tTarget: op.tTarget,
    schemaValid: op.schemaValid,
    requestId: op.requestId,
    now: () => new Date(op.createdAt),
  });
}
