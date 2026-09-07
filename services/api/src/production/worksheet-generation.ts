import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AiGenerationMode, Plan } from '@copilot/domain';
import {
  createOpenAiProviderAdapter,
  loadAiGenerationConfig,
  type AiCapability,
  type AiUsageEvent,
  type ProviderCompliance,
} from '@copilot/ai';
import {
  createLunaItemContentGenerator,
  createOpenAiAnswerCrosscheck,
  createRoutedAnswerCrosscheck,
  DailyCostGuard,
  InMemoryWorksheetShadowQueue,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  PgWorksheetJobQueue,
  resolveCrosscheckAdapter,
  WorksheetJobWorker,
  type AnswerCrosscheckAdapter,
  type ItemContentGenerator,
  type ReviewQueueStore,
  type WorksheetCostCaps,
  type WorksheetGenerationStore,
  type WorksheetJobDeps,
  type WorksheetShadowJob,
  type WorksheetShadowOutcome,
  type WorksheetShadowQueue,
  type WorksheetUsageContext,
} from '@copilot/exercise-gen';
import type { KnowledgeBase } from '@copilot/math-data';
import { validateWorksheetStagingConfig } from './worksheet-staging-config.js';
import { loadReferenceLibrary, type ReferenceExample } from '@copilot/reference-library';
import { createLogger, type Logger } from '@copilot/observability';

/**
 * Production wiring for the worksheet recovery orchestrator (doc 66 §1).
 *
 * LOCKED roles: DEFAULT = gpt-4.1-mini, HIGH_COMPLEXITY & fallback = gpt-5-mini.
 * gpt-4o-mini is NOT built. Routing is never tier-bound.
 *
 * Mode from `AI_GENERATION_MODE` (`@copilot/ai` `loadAiGenerationConfig`):
 *   OFF  → returns `null` — the API hook never runs.
 *   SHADOW → generators + pg stores + crosscheck stub are built; runs persist,
 *            never serve.
 *   LIVE → this module still builds SHADOW infra (so LIVE is reachable) but the
 *          API hook treats LIVE like OFF until separately approved.
 */

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'production',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

export interface ProductionWorksheetGeneration {
  readonly mode: AiGenerationMode;
  readonly queue: WorksheetShadowQueue;
  readonly generators: { readonly default: ItemContentGenerator; readonly highComplexity: ItemContentGenerator };
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly crosscheckAdapter?: AnswerCrosscheckAdapter;
  readonly reviewQueue?: ReviewQueueStore;
  readonly store?: WorksheetGenerationStore;
  readonly usageSink?: (event: AiUsageEvent) => void;
  readonly resolveUsageContext?: (childId: string, ctx: { userId: string }) => WorksheetUsageContext;
  readonly resolveChildRef?: (childId: string) => string;
  readonly costGuard?: DailyCostGuard;
  readonly perWorksheetCostCeilingUsd?: number;
}

export interface ResolveWorksheetGenerationOpts {
  readonly pool: Pool;
  readonly env?: Record<string, string | undefined>;
  readonly logger?: Logger;
  /** userId → the family's plan (for budget rollups only — never gates routing). */
  readonly planFor?: (userId: string) => Plan;
  /** persist every AiUsageEvent to the canonical ledger. */
  readonly usageSink?: (event: AiUsageEvent) => void;
  /** in-process, single-instance queue by default; a deployment can inject a real one. */
  readonly queue?: WorksheetShadowQueue;
  /** observe every completed SHADOW run (dashboards / alerts). */
  readonly onOutcome?: (job: WorksheetShadowJob, outcome: WorksheetShadowOutcome) => void;
  /** cumulative daily spend cap — one guard shared across all runs (doc 66 §2). */
  readonly costGuard?: DailyCostGuard;
}

/** sha256(id) → 16-hex — the same opaque, non-reversible ref shape the analytics
 *  layer uses. NEVER store the raw id anywhere generation telemetry can see it. */
export const pseudonymize = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);

/** the non-serializable deps a worksheet run needs — built once here so
 *  `resolveWorksheetGeneration` (in-process) and `createWorksheetJobWorker`
 *  (durable queue worker) share exactly the same LOCKED routing + gates. */
function buildGenerationDeps(
  env: Record<string, string | undefined>,
): {
  generators: { default: ItemContentGenerator; highComplexity: ItemContentGenerator };
  crosscheckAdapter?: AnswerCrosscheckAdapter;
} {
  const mkGen = (model: string): ItemContentGenerator =>
    createLunaItemContentGenerator({
      adapter: createOpenAiProviderAdapter({
        apiKey: env.OPENAI_API_KEY!,
        model,
        capability: 'generate_problem' as AiCapability,
        compliance: COMPLIANCE,
      }),
      structuredOutputMode: 'STRICT_JSON_SCHEMA',
    });
  const generators = {
    default: mkGen(env.WORKSHEET_DEFAULT_MODEL ?? 'gpt-4.1-mini'),
    highComplexity: mkGen(env.WORKSHEET_HIGH_COMPLEXITY_MODEL ?? 'gpt-5-mini'),
  };

  // Paid crosscheck runs ONLY when AI_CROSSCHECK_MODE=LIVE (+ key). Otherwise
  // NO adapter → Group C items sit PENDING_CROSSCHECK (honest). Verifier routing
  // (doc 66 §4): normal reasoning → CROSSCHECK_MODEL (gpt-4.1-mini); geometry /
  // theorem-criteria / proof → CROSSCHECK_GEOMETRY_MODEL (gpt-5-mini). Verifier
  // only — the LOCKED generator routing is untouched.
  const mkCrosscheck = (model: string) =>
    createOpenAiAnswerCrosscheck(
      createOpenAiProviderAdapter({
        apiKey: env.OPENAI_API_KEY!,
        model,
        capability: 'advanced_verification' as AiCapability,
        compliance: COMPLIANCE,
      }),
    );
  const { adapter: paidAdapter, paidEnabled } = resolveCrosscheckAdapter(env, () =>
    createRoutedAnswerCrosscheck({
      base: mkCrosscheck(env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini'),
      geometryProof: mkCrosscheck(env.CROSSCHECK_GEOMETRY_MODEL ?? 'gpt-5-mini'),
    }),
  );
  return { generators, ...(paidEnabled ? { crosscheckAdapter: paidAdapter } : {}) };
}

/**
 * doc 69 §5 — after a completed run, if it was persisted as LIVE, record a
 * serving intent (verified items held for the next authenticated child request)
 * and the operational spend against the INTERNAL LIVE daily caps. Best-effort;
 * never affects the product flow.
 */
async function recordLiveOutcome(
  pool: Pool,
  env: Record<string, string | undefined>,
  job: { readonly spec: { readonly generationSpecId: string }; readonly childRef?: string | null },
  outcome: Extract<WorksheetShadowOutcome, { ran: true }>,
): Promise<void> {
  const { rows } = await pool.query<{ mode: string }>(
    `SELECT mode FROM worksheet_generation_runs WHERE id = $1`,
    [outcome.runId],
  );
  if (rows[0]?.mode !== 'LIVE') return;

  const { recordInternalLiveSpend } = await import('./internal-live.js');
  const { recordServingIntent } = await import('./internal-live-serving.js');

  const byModel = outcome.result.trace.totals.byModel;
  const genUsd = byModel
    .filter((m) => m.operationType !== 'advanced_verification')
    .reduce((a, m) => a + (m.actualCostUsd ?? 0), 0);
  const xUsd = byModel
    .filter((m) => m.operationType === 'advanced_verification')
    .reduce((a, m) => a + (m.actualCostUsd ?? 0), 0);
  if (genUsd > 0) await recordInternalLiveSpend(pool, 'generation', genUsd).catch(() => undefined);
  if (xUsd > 0) await recordInternalLiveSpend(pool, 'crosscheck', xUsd).catch(() => undefined);

  if (job.childRef) {
    await recordServingIntent(pool, {
      runId: outcome.runId,
      childRef: job.childRef,
      generationSpecId: job.spec.generationSpecId,
      result: outcome.result,
      env,
    }).catch(() => undefined);
  }
}

export function resolveWorksheetGeneration(
  opts: ResolveWorksheetGenerationOpts,
): ProductionWorksheetGeneration | null {
  const env = opts.env ?? process.env;
  const logger = opts.logger ?? createLogger({ level: 'warn' });
  const cfg = loadAiGenerationConfig(env);

  const validation = validateWorksheetStagingConfig(env);
  for (const w of validation.warnings) logger.warn(`worksheet generation config: ${w}`);
  if (cfg.mode === 'OFF') return null;
  if (validation.blocking.length > 0) {
    for (const b of validation.blocking) logger.warn(`worksheet generation config BLOCKING: ${b}`);
    return null;
  }
  if (!env.OPENAI_API_KEY) {
    logger.warn('worksheet generation: AI_GENERATION_MODE set but OPENAI_API_KEY missing — staying OFF');
    return null;
  }

  const { generators, crosscheckAdapter } = buildGenerationDeps(env);

  const store = new PgWorksheetGenerationStore(opts.pool);
  const reviewQueue: ReviewQueueStore = new PgReviewQueueStore(opts.pool);

  // doc 69 §5 — when a LIVE run completes, record a serving intent (verified
  // items → held for the next authenticated request from that child) + spend.
  const onOutcome: NonNullable<ResolveWorksheetGenerationOpts['onOutcome']> = (job, outcome) => {
    opts.onOutcome?.(job, outcome);
    if (!outcome.ran) return;
    // the durable job knows its own mode; the in-memory queue passes it too.
    void recordLiveOutcome(opts.pool, env, job, outcome).catch(() => undefined);
  };

  // `WORKSHEET_QUEUE=durable` → persist jobs to Postgres (restart-safe,
  // multi-worker); a deployment then runs a `WorksheetJobWorker`
  // (`createWorksheetJobWorker`). Default: the in-process queue.
  const queue =
    opts.queue ??
    (env.WORKSHEET_QUEUE === 'durable'
      ? new PgWorksheetJobQueue(opts.pool)
      : new InMemoryWorksheetShadowQueue({ onOutcome }));
  const planFor = opts.planFor ?? (() => 'free' as Plan);
  const caps: WorksheetCostCaps = validation.costCaps;
  const costGuard = opts.costGuard ?? new DailyCostGuard(caps);

  return {
    mode: cfg.mode,
    queue,
    generators,
    referenceLibrary: loadReferenceLibrary(),
    ...(crosscheckAdapter ? { crosscheckAdapter } : {}),
    reviewQueue,
    store,
    costGuard,
    perWorksheetCostCeilingUsd: caps.perWorksheetUsd,
    ...(opts.usageSink ? { usageSink: opts.usageSink } : {}),
    resolveUsageContext: (childId, ctx) => ({
      userRef: pseudonymize(ctx.userId),
      childRef: pseudonymize(childId),
      plan: planFor(ctx.userId),
      learningContextSource: null,
    }),
    resolveChildRef: (childId) => pseudonymize(childId),
  };
}

export interface WorksheetJobWorkerDeps {
  readonly pool: Pool;
  readonly knowledgeBase: KnowledgeBase;
  readonly env?: Record<string, string | undefined>;
  readonly workerId?: string;
  readonly usageSink?: (event: AiUsageEvent) => void;
  readonly leaseMs?: number;
  readonly backoffMs?: number;
  readonly pollMs?: number;
}

/**
 * Build a `WorksheetJobWorker` bound to the SAME locked routing + gates as the
 * in-process path (`resolveWorksheetGeneration`). A deployment using
 * `WORKSHEET_QUEUE=durable` runs one (or a few) of these; `.start()` polls,
 * `.stop()` drains on shutdown, `.runToIdle()` is for a one-shot/cron worker.
 * Returns `null` for the same reasons `resolveWorksheetGeneration` does (OFF /
 * blocking config / no key).
 */
export function createWorksheetJobWorker(deps: WorksheetJobWorkerDeps): WorksheetJobWorker | null {
  const env = deps.env ?? process.env;
  const logger = createLogger({ level: 'warn' });
  const cfg = loadAiGenerationConfig(env);
  const validation = validateWorksheetStagingConfig(env);
  if (cfg.mode === 'OFF' || validation.blocking.length > 0 || !env.OPENAI_API_KEY) {
    for (const b of validation.blocking) logger.warn(`worksheet job worker config BLOCKING: ${b}`);
    return null;
  }

  const { generators, crosscheckAdapter } = buildGenerationDeps(env);
  const store = new PgWorksheetGenerationStore(deps.pool);
  const reviewQueue = new PgReviewQueueStore(deps.pool);
  const costGuard = new DailyCostGuard(validation.costCaps);

  const buildJobDeps = (): WorksheetJobDeps => ({
    generators,
    ...(crosscheckAdapter ? { crosscheckAdapter } : {}),
    reviewQueue,
    store,
    ...(deps.usageSink ? { usageSink: deps.usageSink } : {}),
    costGuard,
  });

  return new WorksheetJobWorker({
    pool: deps.pool,
    workerId: deps.workerId ?? `wjw_${pseudonymize(`${process.pid}:${Date.now()}`)}`,
    knowledgeBase: deps.knowledgeBase,
    referenceLibrary: loadReferenceLibrary(),
    buildDeps: buildJobDeps,
    // doc 69 §5 — record LIVE serving intent + operational spend when a run lands.
    onOutcome: (row, outcome) => {
      if (!outcome.ran) return;
      void recordLiveOutcome(deps.pool, env, { spec: row.spec, childRef: row.childRef }, outcome).catch(() => undefined);
    },
    ...(deps.leaseMs !== undefined ? { leaseMs: deps.leaseMs } : {}),
    ...(deps.backoffMs !== undefined ? { backoffMs: deps.backoffMs } : {}),
    ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}),
  });
}
