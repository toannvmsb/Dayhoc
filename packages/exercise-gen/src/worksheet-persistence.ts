import type { ExerciseGenerationSpec } from '@copilot/domain';
import type { WorksheetResult, WorksheetTrace } from './worksheet-orchestrator.js';

/**
 * Persistence contract for the production worksheet orchestrator (doc 65 §3).
 * Three append-only tables: `worksheet_generation_runs`, `worksheet_slots`,
 * `worksheet_slot_attempts` (migration `*_worksheet_generation.js`).
 *
 * Rows carry PSEUDONYMOUS ids and OPERATIONAL metadata ONLY — never child name,
 * school, evidence, gap content, prompt/answer/solution text. (A separate,
 * explicitly-gated QA path holds raw content; see `config.captureRaw`.)
 */

export interface WorksheetRunRecord {
  readonly id: string;
  readonly generationSpecId: string;
  readonly childRef: string | null; // pseudonymous
  readonly mode: 'SHADOW' | 'LIVE';
  readonly worksheetState: WorksheetResult['worksheetState'];
  readonly readySlots: number;
  readonly pendingCrosscheckSlots: number;
  readonly failedSlots: number;
  readonly orchestratorVersion: string;
  readonly routerVersion: string;
  readonly retryContextVersion: string;
  readonly lastResortVersion: string;
  readonly contentQualityVersion: string;
  readonly itemValidatorVersion: string;
  readonly crosscheckAdapterName: string | null;
  readonly modelCalls: number;
  readonly retries: number;
  readonly fallbackCalls: number;
  readonly lastResortCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number;
  readonly costCeilingHit: boolean;
  readonly worksheetLatencyMs: number;
  readonly costEventRefs: readonly string[]; // ai_usage_events request ids
  readonly createdAt: string;
}

export interface WorksheetSlotRecord {
  readonly id: string; // `${runId}:${itemId}`
  readonly runId: string;
  readonly generationSpecId: string;
  readonly itemId: string; // pseudonymous slot id
  readonly index: number;
  readonly kernelFamily: string | null;
  readonly initialRole: string;
  readonly routeReason: string;
  readonly finalState: string;
  readonly lastResortUsed: boolean;
  readonly crosscheckRequired: boolean;
  readonly crosscheckVerdict: string | null;
  readonly contentQualityCodes: readonly string[];
  readonly reviewQueueId: string | null;
  readonly answerStatus: string | null;
  readonly productionReady: boolean;
  readonly slotLatencyMs: number;
}

export interface WorksheetSlotAttemptRecord {
  readonly id: string; // `${runId}:${itemId}:${attempt}`
  readonly runId: string;
  readonly itemId: string;
  readonly attempt: number;
  readonly model: string;
  readonly role: string;
  readonly step: string;
  readonly accepted: boolean;
  readonly failureCategory: string | null;
  readonly retryReason: string | null;
  readonly latencyMs: number;
}

export interface WorksheetPersistBundle {
  readonly run: WorksheetRunRecord;
  readonly slots: readonly WorksheetSlotRecord[];
  readonly attempts: readonly WorksheetSlotAttemptRecord[];
}

export interface WorksheetGenerationStore {
  putRun(bundle: WorksheetPersistBundle): Promise<void>;
  getRun(runId: string): Promise<WorksheetRunRecord | null>;
  listRuns(generationSpecId: string): Promise<readonly WorksheetRunRecord[]>;
  listSlots(runId: string): Promise<readonly WorksheetSlotRecord[]>;
  listAttempts(runId: string): Promise<readonly WorksheetSlotAttemptRecord[]>;
}

export class InMemoryWorksheetGenerationStore implements WorksheetGenerationStore {
  readonly #runs = new Map<string, WorksheetRunRecord>();
  readonly #slots = new Map<string, WorksheetSlotRecord[]>();
  readonly #attempts = new Map<string, WorksheetSlotAttemptRecord[]>();

  putRun(bundle: WorksheetPersistBundle): Promise<void> {
    if (this.#runs.has(bundle.run.id)) {
      return Promise.reject(new Error(`worksheet run ${bundle.run.id} already stored (append-only)`));
    }
    this.#runs.set(bundle.run.id, bundle.run);
    this.#slots.set(bundle.run.id, [...bundle.slots]);
    this.#attempts.set(bundle.run.id, [...bundle.attempts]);
    return Promise.resolve();
  }
  getRun = (id: string) => Promise.resolve(this.#runs.get(id) ?? null);
  listRuns = (specId: string) =>
    Promise.resolve([...this.#runs.values()].filter((r) => r.generationSpecId === specId));
  listSlots = (runId: string) => Promise.resolve(this.#slots.get(runId) ?? []);
  listAttempts = (runId: string) => Promise.resolve(this.#attempts.get(runId) ?? []);
}

/**
 * Map an `orchestrateWorksheet` result to append-only rows. NO PII — only ids,
 * states, categories, counts, versions, latency, cost.
 */
export function toWorksheetRecords(
  spec: ExerciseGenerationSpec,
  result: WorksheetResult,
  opts: { runId: string; childRef?: string | null; mode?: 'SHADOW' | 'LIVE'; costEventRefs?: readonly string[] },
): WorksheetPersistBundle {
  const t: WorksheetTrace = result.trace;
  const run: WorksheetRunRecord = {
    id: opts.runId,
    generationSpecId: spec.generationSpecId,
    childRef: opts.childRef ?? null,
    mode: opts.mode ?? 'SHADOW',
    worksheetState: result.worksheetState,
    readySlots: result.readySlots,
    pendingCrosscheckSlots: result.pendingCrosscheckSlots,
    failedSlots: result.failedSlots,
    orchestratorVersion: t.orchestratorVersion,
    routerVersion: t.routerVersion,
    retryContextVersion: t.retryContextVersion,
    lastResortVersion: t.lastResortVersion,
    contentQualityVersion: t.contentQualityVersion,
    itemValidatorVersion: t.itemValidatorVersion,
    crosscheckAdapterName: t.crosscheckAdapterName,
    modelCalls: t.totals.modelCalls,
    retries: t.totals.retries,
    fallbackCalls: t.totals.fallbackCalls,
    lastResortCalls: t.totals.lastResortCalls,
    inputTokens: t.totals.inputTokens,
    outputTokens: t.totals.outputTokens,
    estimatedCostUsd: t.totals.estimatedCostUsd,
    actualCostUsd: t.totals.actualCostUsd,
    costCeilingHit: t.totals.costCeilingHit,
    worksheetLatencyMs: t.worksheetLatencyMs,
    costEventRefs: opts.costEventRefs ?? [],
    createdAt: t.createdAt,
  };
  const slots: WorksheetSlotRecord[] = t.perSlot.map((s) => ({
    id: `${opts.runId}:${s.itemId}`,
    runId: opts.runId,
    generationSpecId: spec.generationSpecId,
    itemId: s.itemId,
    index: s.index,
    kernelFamily: s.kernelFamily,
    initialRole: s.initialRole,
    routeReason: s.routeReason,
    finalState: s.finalState,
    lastResortUsed: s.lastResortUsed,
    crosscheckRequired: s.crosscheckRequired,
    crosscheckVerdict: s.crosscheckVerdict,
    contentQualityCodes: s.contentQualityFindings.map((f) => `${f.code}:${f.severity}`),
    reviewQueueId: s.reviewQueueId,
    answerStatus: s.answerStatus,
    productionReady: s.productionReady,
    slotLatencyMs: s.slotLatencyMs,
  }));
  const attempts: WorksheetSlotAttemptRecord[] = t.perSlot.flatMap((s) =>
    s.attempts.map((a) => ({
      id: `${opts.runId}:${s.itemId}:${a.attempt}`,
      runId: opts.runId,
      itemId: s.itemId,
      attempt: a.attempt,
      model: a.model,
      role: a.role,
      step: a.step,
      accepted: a.accepted,
      failureCategory: a.failureCategory,
      retryReason: a.retryReason,
      latencyMs: a.latencyMs,
    })),
  );
  return { run, slots, attempts };
}
