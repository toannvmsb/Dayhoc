import type { AiGenerationMode, ExerciseGenerationSpec } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';
import type { AiUsageEvent } from '@copilot/ai';
import {
  orchestrateWorksheet,
  type WorksheetOrchestratorConfig,
  type WorksheetResult,
} from './worksheet-orchestrator.js';
import type { ItemContentGenerator } from './item-generator.js';
import type { AnswerCrosscheckAdapter } from './answer-crosscheck.js';
import type { ReviewQueueStore } from './review-queue.js';
import {
  toWorksheetRecords,
  type WorksheetGenerationStore,
} from './worksheet-persistence.js';
import {
  worksheetTraceToUsageEvents,
  type WorksheetUsageContext,
} from './worksheet-telemetry.js';
import type { DailyCostGuard } from './worksheet-guardrails.js';

/**
 * SHADOW-mode wrapper for the production worksheet orchestrator (doc 65 §1/§11).
 *
 *   OFF   → does nothing, calls NO model.
 *   SHADOW→ runs the full orchestrator against a real planner spec, persists the
 *           run + slots + attempts, records cost telemetry — but the result
 *           NEVER becomes a child-visible worksheet.
 *   LIVE  → reserved. This wrapper treats it exactly like OFF (never serves a
 *           worksheet). Enabling real LIVE delivery is a separate, gated change.
 *
 * NEVER throws back to the caller — every failure is captured so it can only be
 * telemetry, not a user-facing error.
 */

export interface WorksheetShadowJob {
  readonly spec: ExerciseGenerationSpec;
  readonly generators: { readonly default: ItemContentGenerator; readonly highComplexity: ItemContentGenerator };
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly knowledgeBase: KnowledgeBase;
  readonly config?: Partial<WorksheetOrchestratorConfig>;
  readonly crosscheckAdapter?: AnswerCrosscheckAdapter;
  readonly reviewQueue?: ReviewQueueStore;
  readonly store?: WorksheetGenerationStore;
  readonly usageSink?: (event: AiUsageEvent) => void;
  readonly usageContext?: WorksheetUsageContext;
  readonly childRef?: string | null;
  readonly newRunId?: () => string;
  readonly now?: () => Date;
  /** privacy-safe metrics of the LEGACY path, to compare against (doc 65 §11). */
  readonly legacyMetrics?: WorksheetComparisonMetrics | null;
  readonly onComparison?: (c: WorksheetComparison) => void;
  /** cumulative daily spend cap (doc 66 §2). A run is skipped when the cap is
   *  reached; the run's actual cost is recorded after. */
  readonly costGuard?: DailyCostGuard;
}

export interface WorksheetComparisonMetrics {
  readonly path: 'legacy' | 'new';
  readonly completedItems: number;
  readonly totalItems: number;
  /** @deprecated always 0 (doc 68 §7). */
  readonly pendingCrosscheck: number;
  readonly substituted: number;
  readonly omitted: number;
  readonly failed: number;
  readonly modelCalls: number;
  readonly retries: number;
  readonly fallbackCalls: number;
  readonly lastResortCalls: number;
  readonly actualCostUsd: number;
  readonly latencyMs: number;
}

export interface WorksheetComparison {
  readonly generationSpecId: string;
  readonly legacy: WorksheetComparisonMetrics | null;
  readonly next: WorksheetComparisonMetrics;
}

export type WorksheetShadowOutcome =
  | { readonly ran: false; readonly reason: string }
  | {
      readonly ran: true;
      readonly result: WorksheetResult;
      readonly runId: string;
      readonly usageEvents: readonly AiUsageEvent[];
      readonly comparison: WorksheetComparison;
      readonly persisted: boolean;
      readonly persistError: string | null;
    };

function metricsOf(result: WorksheetResult): WorksheetComparisonMetrics {
  const t = result.trace;
  return {
    path: 'new',
    completedItems: result.readySlots,
    totalItems: t.perSlot.length,
    pendingCrosscheck: 0,
    substituted: result.substitutedSlots,
    omitted: result.omittedSlots,
    failed: result.failedSlots,
    modelCalls: t.totals.modelCalls,
    retries: t.totals.retries,
    fallbackCalls: t.totals.fallbackCalls,
    lastResortCalls: t.totals.lastResortCalls,
    actualCostUsd: t.totals.actualCostUsd,
    latencyMs: t.worksheetLatencyMs,
  };
}

export async function runWorksheetShadow(
  mode: AiGenerationMode,
  job: WorksheetShadowJob,
): Promise<WorksheetShadowOutcome> {
  if (mode !== 'SHADOW') {
    return { ran: false, reason: mode === 'LIVE' ? 'LIVE reserved — treated as OFF here (doc 65 §1)' : 'mode OFF' };
  }
  const now = job.now ?? (() => new Date());
  const newRunId = job.newRunId ?? (() => `wsrun_${Math.random().toString(36).slice(2, 12)}`);

  if (job.costGuard) {
    const gate = job.costGuard.canRun();
    if (!gate.ok) return { ran: false, reason: `daily cost guard: ${gate.reason}` };
  }

  let result: WorksheetResult;
  try {
    result = await orchestrateWorksheet({
      spec: job.spec,
      knowledgeBase: job.knowledgeBase,
      referenceLibrary: job.referenceLibrary,
      generators: job.generators,
      ...(job.config ? { config: job.config } : {}),
      ...(job.crosscheckAdapter ? { crosscheckAdapter: job.crosscheckAdapter } : {}),
      ...(job.reviewQueue ? { reviewQueue: job.reviewQueue } : {}),
      ...(job.childRef !== undefined ? { childRef: job.childRef } : {}),
      now,
    });
  } catch (e) {
    return { ran: false, reason: `orchestrator threw: ${(e as Error).message}` };
  }

  job.costGuard?.record(result.trace.totals.actualCostUsd);

  const runId = newRunId();
  const usageEvents = job.usageContext
    ? worksheetTraceToUsageEvents(result.trace, job.usageContext)
    : [];
  if (job.usageSink) for (const ev of usageEvents) job.usageSink(ev);

  let persisted = false;
  let persistError: string | null = null;
  if (job.store) {
    try {
      await job.store.putRun(
        toWorksheetRecords(job.spec, result, {
          runId,
          childRef: job.childRef ?? null,
          mode: 'SHADOW',
          costEventRefs: usageEvents.map((e) => e.requestId),
        }),
      );
      persisted = true;
    } catch (e) {
      persistError = (e as Error).message;
    }
  }

  const comparison: WorksheetComparison = {
    generationSpecId: job.spec.generationSpecId,
    legacy: job.legacyMetrics ?? null,
    next: metricsOf(result),
  };
  job.onComparison?.(comparison);

  return { ran: true, result, runId, usageEvents, comparison, persisted, persistError };
}

/** Fire-and-forget queue for SHADOW worksheet runs — mirrors ShadowGenerationQueue. */
export interface WorksheetShadowQueue {
  enqueue(mode: AiGenerationMode, job: WorksheetShadowJob): void;
}

export class InMemoryWorksheetShadowQueue implements WorksheetShadowQueue {
  #pending: Promise<void>[] = [];
  readonly #onOutcome: ((job: WorksheetShadowJob, outcome: WorksheetShadowOutcome) => void) | undefined;

  constructor(opts?: { onOutcome?: (job: WorksheetShadowJob, outcome: WorksheetShadowOutcome) => void }) {
    this.#onOutcome = opts?.onOutcome;
  }

  enqueue(mode: AiGenerationMode, job: WorksheetShadowJob): void {
    const schedule = typeof setImmediate === 'function' ? setImmediate : (fn: () => void) => setTimeout(fn, 0);
    const p = new Promise<void>((resolve) => {
      schedule(() => {
        runWorksheetShadow(mode, job)
          .then((outcome) => this.#onOutcome?.(job, outcome))
          .catch(() => undefined)
          .finally(resolve);
      });
    });
    this.#pending.push(p);
  }

  /** test helper — await every job enqueued so far. */
  async drain(): Promise<void> {
    const p = this.#pending;
    this.#pending = [];
    await Promise.all(p);
  }
}

export class NoopWorksheetShadowQueue implements WorksheetShadowQueue {
  enqueue(): void {
    /* OFF / not configured — do nothing */
  }
}
