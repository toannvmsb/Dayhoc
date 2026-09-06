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
  InMemoryWorksheetShadowQueue,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  resolveCrosscheckAdapter,
  type AnswerCrosscheckAdapter,
  type ItemContentGenerator,
  type ReviewQueueStore,
  type WorksheetGenerationStore,
  type WorksheetShadowJob,
  type WorksheetShadowOutcome,
  type WorksheetShadowQueue,
  type WorksheetUsageContext,
} from '@copilot/exercise-gen';
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
}

/** sha256(id) → 16-hex — the same opaque, non-reversible ref shape the analytics
 *  layer uses. NEVER store the raw id anywhere generation telemetry can see it. */
export const pseudonymize = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);

export function resolveWorksheetGeneration(
  opts: ResolveWorksheetGenerationOpts,
): ProductionWorksheetGeneration | null {
  const env = opts.env ?? process.env;
  const logger = opts.logger ?? createLogger({ level: 'warn' });
  const cfg = loadAiGenerationConfig(env);

  if (cfg.mode === 'OFF') return null;
  if (!env.OPENAI_API_KEY) {
    logger.warn('worksheet generation: AI_GENERATION_MODE set but OPENAI_API_KEY missing — staying OFF');
    return null;
  }

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

  // Paid crosscheck stays disabled until AI_CROSSCHECK_MODE=LIVE + key + factory.
  // When it is NOT enabled we pass NO adapter, so Group C items sit
  // PENDING_CROSSCHECK (honest) rather than flooding the review queue with the
  // stub's always-UNCERTAIN verdict.
  const { adapter: paidAdapter, paidEnabled } = resolveCrosscheckAdapter(env);
  const crosscheckAdapter = paidEnabled ? paidAdapter : undefined;

  const store = new PgWorksheetGenerationStore(opts.pool);
  const reviewQueue: ReviewQueueStore = new PgReviewQueueStore(opts.pool);
  const queue = opts.queue ?? new InMemoryWorksheetShadowQueue(opts.onOutcome ? { onOutcome: opts.onOutcome } : undefined);
  const planFor = opts.planFor ?? (() => 'free' as Plan);

  return {
    mode: cfg.mode,
    queue,
    generators,
    referenceLibrary: loadReferenceLibrary(),
    ...(crosscheckAdapter ? { crosscheckAdapter } : {}),
    reviewQueue,
    store,
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
