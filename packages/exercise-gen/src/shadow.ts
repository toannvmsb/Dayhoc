import type { AiGenerationMode, ExerciseGenerationSpec } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';
import type { AiUsageEvent } from '@copilot/ai';
import { orchestrateGeneration, type OrchestratorConfig, type OrchestratorResult } from './orchestrator.js';
import { generationOperationToUsageEvent, type UsageContext } from './telemetry.js';
import { toGenerationRecords, type GenerationStore } from './persistence.js';
import type { ExerciseGenerator } from './generator.js';
import { summarizeAnswerVerification, type AnswerVerificationSummary } from './answer-verification.js';

/**
 * Shadow-mode generation (doc 14 C5 §11/§12). Runs the FULL live pipeline
 * (target selection → spec → grounding → generate → validate) in parallel with
 * the legacy practice path, but the result NEVER becomes the child-visible
 * Assignment — see the SHADOW invariant test in `shadow.test.ts`. A shadow run
 * NEVER throws back to its caller; every failure is captured in the result so
 * it can only ever become telemetry, not a user-facing error.
 */

export interface ShadowRunInput {
  readonly spec: ExerciseGenerationSpec;
  readonly generator: ExerciseGenerator;
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly knowledgeBase: KnowledgeBase;
  readonly store?: GenerationStore;
  readonly usageContext?: UsageContext;
  readonly orchestratorConfig?: Partial<OrchestratorConfig>;
  readonly now?: () => Date;
  readonly newSetId?: () => string;
}

export type ShadowRunResult =
  | {
      readonly ok: true;
      readonly result: OrchestratorResult;
      readonly answerVerification: AnswerVerificationSummary | null;
      readonly usageEvents: readonly AiUsageEvent[];
    }
  | { readonly ok: false; readonly error: string };

/** Run one shadow generation. Persistence is best-effort — a store failure is
 * captured, never thrown, and never affects the orchestration result itself. */
export async function runShadowGeneration(input: ShadowRunInput): Promise<ShadowRunResult> {
  try {
    const result = await orchestrateGeneration({
      spec: input.spec,
      generator: input.generator,
      referenceLibrary: input.referenceLibrary,
      knowledgeBase: input.knowledgeBase,
      ...(input.orchestratorConfig ? { config: input.orchestratorConfig } : {}),
      ...(input.now ? { now: input.now } : {}),
    });

    const usageEvents = input.usageContext
      ? result.trace.operations.map((op) => generationOperationToUsageEvent(op, input.usageContext!))
      : [];

    if (input.store) {
      try {
        const setId = (input.newSetId ?? (() => `ges_shadow_${Date.now()}`))();
        const { specRecord, setRecord } = toGenerationRecords(input.spec, result, {
          setId,
          ...(input.now ? { now: input.now } : {}),
        });
        await input.store.putSpec(specRecord).catch((err: unknown) => {
          // append-only store may reject a spec already written by a prior attempt
          // for the same generationSpecId — that is not a shadow-run failure.
          if (!(err instanceof Error) || !/already stored/.test(err.message)) throw err;
        });
        await input.store.putExerciseSet(setRecord);
      } catch {
        // persistence is best-effort for shadow mode — never fails the run
      }
    }

    return {
      ok: true,
      result,
      answerVerification: result.status === 'delivered' ? summarizeAnswerVerification(result.batch) : null,
      usageEvents,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One shadow job to enqueue — everything `runShadowGeneration` needs. */
export type ShadowGenerationJob = ShadowRunInput;

/**
 * Queue/job PORT (doc 14 C5 §12) — the request handler that builds the legacy
 * child response calls `enqueue` and returns immediately; the queue owns
 * scheduling and error isolation so no request handler ever holds a naked
 * fire-and-forget promise.
 */
export interface ShadowGenerationQueue {
  enqueue(job: ShadowGenerationJob): void;
}

/**
 * In-process queue for tests/demo/single-instance deployments — schedules each
 * job on a macrotask (`setImmediate`/`setTimeout(0)`) so it runs AFTER the
 * caller's current synchronous work (and the response it is building)
 * finishes, never inline. A production deployment can swap this for a real
 * job queue (SQS/BullMQ/pg-boss/...) behind the same `ShadowGenerationQueue`
 * port without touching a single call site.
 */
export class InMemoryShadowGenerationQueue implements ShadowGenerationQueue {
  #pending: Promise<void>[] = [];
  readonly #onResult: ((job: ShadowGenerationJob, result: ShadowRunResult) => void) | undefined;

  constructor(opts?: { onResult?: (job: ShadowGenerationJob, result: ShadowRunResult) => void }) {
    this.#onResult = opts?.onResult;
  }

  enqueue(job: ShadowGenerationJob): void {
    const schedule =
      typeof setImmediate === 'function' ? setImmediate : (fn: () => void) => setTimeout(fn, 0);
    const p = new Promise<void>((resolve) => {
      schedule(() => {
        runShadowGeneration(job)
          .then((result) => this.#onResult?.(job, result))
          .catch(() => undefined) // runShadowGeneration itself never throws, but stay defensive
          .finally(resolve);
      });
    });
    this.#pending.push(p);
  }

  /** Test helper — await every job enqueued so far. */
  async drain(): Promise<void> {
    const snapshot = [...this.#pending];
    await Promise.all(snapshot);
    this.#pending = this.#pending.filter((p) => !snapshot.includes(p));
  }
}

/** A queue that does nothing — used when `AI_GENERATION_MODE` is `OFF`. */
export class NoopShadowGenerationQueue implements ShadowGenerationQueue {
  enqueue(): void {
    // intentionally does nothing
  }
}

export function shadowQueueFor(mode: AiGenerationMode, real: ShadowGenerationQueue): ShadowGenerationQueue {
  return mode === 'SHADOW' ? real : new NoopShadowGenerationQueue();
}
