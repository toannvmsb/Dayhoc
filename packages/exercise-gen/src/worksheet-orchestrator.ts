import type {
  ExerciseGenerationSpec,
  GeneratedExercise,
  GeneratedItemContent,
  ItemAnswerStatus,
  MathKernel,
  ProblemStructure,
  SlotCriticality,
} from '@copilot/domain';
import { MATH_KERNEL_GROUP } from '@copilot/domain';
import { buildSafeSubstitute, SUBSTITUTE_BUILDER_VERSION } from './substitute.js';
import type { KnowledgeBase } from '@copilot/math-data';
import { PricingRegistry } from '@copilot/ai';
import type { ReferenceExample } from '@copilot/reference-library';
import { buildItemGenerationSpecs, ITEM_SPEC_BUILDER_VERSION } from './item-spec.js';
import { buildProblemDNA, PROBLEM_DNA_BUILDER_VERSION } from './problem-dna.js';
import { MATH_KERNEL_BUILDER_VERSION } from './math-kernel.js';
import { reconstructKernels } from './item-orchestrator.js';
import { composeExercise } from './compose.js';
import { acceptItem, ITEM_VALIDATOR_VERSION } from './item-validator.js';
import type { ItemContentGenerator } from './item-generator.js';
import { HIGH_COMPLEXITY_STRUCTURES, MODEL_ROUTER_VERSION, routeItemModel, type ModelRole } from './model-router.js';
import { buildRetryContext, RETRY_CONTEXT_VERSION, type RetryReason } from './retry-context.js';
import { deterministicLastResort, LAST_RESORT_VERSION } from './last-resort.js';
import { computeActualCost } from './cost.js';
import { checkContentQuality, CONTENT_QUALITY_VERSION, type ContentQualityFinding } from './content-quality.js';
import { runGroupCCrosscheck, type AnswerCrosscheckAdapter } from './answer-crosscheck.js';
import type { CrosscheckVerdict } from '@copilot/domain';
import type { ReviewQueueStore } from './review-queue.js';

// ---------------------------------------------------------------------------
// state machine (doc 63 §6)
// ---------------------------------------------------------------------------

export const SLOT_STATES = [
  'PENDING',
  'GENERATING',
  'VALIDATING',
  'RETRYING',
  'ESCALATING',
  'LAST_RESORT',
  'SUBSTITUTING',
  'PENDING_CROSSCHECK',
  'READY',
  'OMITTED',
  'FAILED',
] as const;
export type SlotState = (typeof SLOT_STATES)[number];

/**
 * SAFE DEGRADED WORKSHEET COMPLETION (doc 68 §7). A child-facing worksheet is
 * delivered iff every REQUIRED_CORE slot is READY:
 *   READY                          — all core ready, no substitution, no omission
 *   READY_WITH_SAFE_SUBSTITUTION   — all core ready, ≥1 core via a safe substitute
 *   READY_WITH_OPTIONAL_OMISSIONS  — all core ready, ≥1 optional slot omitted
 *   FAILED                         — a REQUIRED_CORE slot never reached READY
 * `READY_WITH_PENDING_CROSSCHECK` is GONE — a pending/review item is operational
 * state only and is never a child-serving worksheet state.
 */
export const WORKSHEET_STATES = [
  'READY',
  'READY_WITH_SAFE_SUBSTITUTION',
  'READY_WITH_OPTIONAL_OMISSIONS',
  'FAILED',
] as const;
export type WorksheetState = (typeof WORKSHEET_STATES)[number];

export const WORKSHEET_ORCHESTRATOR_VERSION = 'worksheet-orchestrator.v2';

export interface WorksheetOrchestratorConfig {
  /** retries on the SAME model before escalating (doc 63 §2). */
  readonly maxRetriesPerModel: number;
  /** bounded concurrency, configured PER model (doc 63 §8). */
  readonly concurrency: { readonly default: number; readonly highComplexity: number };
  /** hard USD ceiling for the whole worksheet — null = no ceiling (doc 63 §7). */
  readonly costCeilingUsd: number | null;
  /** deterministic last-resort for the final unresolved Group A slot (doc 63 §4). */
  readonly enableLastResort: boolean;
  /** SAFE SUBSTITUTE for an unresolved REQUIRED_CORE slot (doc 68 §5). Default ON. */
  readonly enableSafeSubstitute?: boolean;
  readonly highComplexityStructures?: ReadonlySet<ProblemStructure>;
  /** capture each slot's last-attempt raw text into `result.rawSlots` (audit). */
  readonly captureRaw?: boolean;
  /** deterministic content-quality gate (doc 65 §9). Default ON. */
  readonly contentQuality?: boolean;
}

export const DEFAULT_WORKSHEET_ORCHESTRATOR_CONFIG: WorksheetOrchestratorConfig = {
  maxRetriesPerModel: 1,
  concurrency: { default: 4, highComplexity: 2 },
  costCeilingUsd: null,
  enableLastResort: true,
  enableSafeSubstitute: true,
};

export interface WorksheetOrchestratorInput {
  readonly spec: ExerciseGenerationSpec;
  readonly knowledgeBase: KnowledgeBase;
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly generators: {
    readonly default: ItemContentGenerator;
    readonly highComplexity: ItemContentGenerator;
  };
  readonly recentItems?: readonly { readonly id: string; readonly prompt: string }[];
  readonly config?: Partial<WorksheetOrchestratorConfig>;
  readonly now?: () => Date;
  readonly newRequestId?: () => string;
  readonly pricingRegistry?: PricingRegistry;
  readonly fxVndPerUsd?: number;
  /** Group C answer crosscheck (doc 65 §6). When absent, Group C slots stay
   *  PENDING_CROSSCHECK unverified (never marked production-ready). */
  readonly crosscheckAdapter?: AnswerCrosscheckAdapter;
  /** human-review queue for crosscheck-UNCERTAIN + non-recoverable failures (doc 65 §8). */
  readonly reviewQueue?: ReviewQueueStore;
  /** pseudonymous child ref for review-queue rows — never a name/school. */
  readonly childRef?: string | null;
}

// ---------------------------------------------------------------------------
// privacy-safe observability (doc 63 §9) — NO prompt / answer / solution text
// ---------------------------------------------------------------------------

export type SlotFailureCategory =
  | 'KERNEL_DRIFT'
  | 'SEMANTIC_UNKNOWN'
  | 'SIMILARITY_OR_DUPLICATE'
  | 'LEAKAGE'
  | 'SCHEMA'
  | 'CONTENT_QUALITY'
  | 'CROSSCHECK_FAIL'
  | 'CURRICULUM_OR_LEVEL'
  | 'COMPOSE'
  | 'NO_CONTENT'
  | 'OTHER';

export interface SlotAttemptTrace {
  readonly attempt: number;
  readonly model: string;
  readonly role: ModelRole;
  readonly step: 'default' | 'retry_same' | 'escalate' | 'last_resort' | 'substitute';
  readonly accepted: boolean;
  readonly failureCategory: SlotFailureCategory | null;
  readonly retryReason: RetryReason | null;
  readonly latencyMs: number;
}

export interface SlotTrace {
  readonly itemId: string;
  readonly index: number;
  readonly kernelFamily: string | null;
  readonly initialRole: ModelRole;
  readonly routeReason: string;
  /** Deterministic slot criticality (doc 68 §1). */
  readonly criticality: SlotCriticality;
  readonly finalState: SlotState;
  readonly attempts: readonly SlotAttemptTrace[];
  readonly lastResortUsed: boolean;
  /** a safe substitute was generated AND delivered for this slot (doc 68 §5). */
  readonly substituted: boolean;
  /** the slot was omitted from the child worksheet (optional, unresolved) (doc 68 §3). */
  readonly omitted: boolean;
  /** why the slot was omitted / substituted — for operational reporting. */
  readonly degradeReason: string | null;
  readonly crosscheckRequired: boolean;
  /** result of the Group C answer crosscheck, if it ran (doc 65 §6). */
  readonly crosscheckVerdict: CrosscheckVerdict | null;
  /** content-quality findings (WARN kept; BLOCK caused a regenerate) (doc 65 §9). */
  readonly contentQualityFindings: readonly ContentQualityFinding[];
  /** id of the review-queue row this slot raised, if any (doc 65 §8). */
  readonly reviewQueueId: string | null;
  readonly answerStatus: ItemAnswerStatus | null;
  readonly productionReady: boolean;
  readonly slotLatencyMs: number;
}

export interface WorksheetModelUsage {
  readonly model: string;
  readonly provider: string;
  readonly modelVersion: string | null;
  /** 'worksheet_batch_generation' (default) or 'advanced_verification' (crosscheck). */
  readonly operationType?: 'worksheet_batch_generation' | 'advanced_verification';
  readonly calls: number;
  readonly retries: number;
  readonly fallbackCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly actualCostUsd: number;
  readonly priceConfigEffectiveDate: string | null;
  readonly latencyMs: number;
  readonly schemaValidCalls: number;
}

export interface WorksheetTotals {
  readonly modelCalls: number;
  readonly retries: number;
  readonly fallbackCalls: number;
  readonly lastResortCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number;
  readonly costCeilingHit: boolean;
  /** per-model breakdown for accurate cost telemetry (doc 65 §4). */
  readonly byModel: readonly WorksheetModelUsage[];
}

export interface WorksheetTrace {
  readonly generationSpecId: string;
  readonly orchestratorVersion: string;
  readonly routerVersion: string;
  readonly retryContextVersion: string;
  readonly lastResortVersion: string;
  readonly substituteBuilderVersion: string;
  readonly contentQualityVersion: string;
  readonly crosscheckAdapterName: string | null;
  readonly itemValidatorVersion: string;
  readonly itemSpecBuilderVersion: string;
  readonly problemDnaBuilderVersion: string;
  readonly mathKernelBuilderVersion: string;
  readonly config: WorksheetOrchestratorConfig;
  readonly perSlot: readonly SlotTrace[];
  readonly totals: WorksheetTotals;
  readonly worksheetLatencyMs: number;
  readonly createdAt: string;
}

/** raw last-attempt content per slot — populated only when `config.captureRaw`
 *  is set (audit / offline re-score). Kept OUT of `trace` (doc 63 §9). */
export interface RawSlotContent {
  readonly itemId: string;
  readonly finalState: SlotState;
  readonly prompt: string | null;
  readonly workedSolution: string | null;
  readonly answer: string | null;
}

export interface OmittedSlotReport {
  readonly itemId: string;
  readonly index: number;
  readonly criticality: SlotCriticality;
  readonly reason: string;
  readonly reviewQueueId: string | null;
}

export interface WorksheetResult {
  readonly worksheetState: WorksheetState;
  /** child-serving exercises in worksheet order — every one is READY and verified
   *  (deterministically correct or crosscheck-PASS). Never a pending/omitted item. */
  readonly items: readonly GeneratedExercise[];
  readonly readySlots: number;
  /**
   * @deprecated always 0 — a pending crosscheck is no longer a delivered state
   * (doc 68 §7). Kept so shadow/read-model consumers keep compiling.
   */
  readonly pendingCrosscheckSlots: number;
  readonly failedSlots: number;
  /** REQUIRED_CORE slots delivered via a safe substitute (doc 68 §5). */
  readonly substitutedSlots: number;
  /** optional slots omitted from the child worksheet (doc 68 §3). */
  readonly omittedSlots: number;
  /** exact reason for each omitted / substituted slot (doc 68 §14). */
  readonly omittedReports: readonly OmittedSlotReport[];
  readonly substitutedReports: readonly OmittedSlotReport[];
  readonly trace: WorksheetTrace;
  /** only when `config.captureRaw` — never logged as telemetry. */
  readonly rawSlots?: readonly RawSlotContent[];
}

// ---------------------------------------------------------------------------

interface SlotWork {
  itemId: string;
  index: number;
  itemSpec: ReturnType<typeof buildItemGenerationSpecs>[number];
  criticality: SlotCriticality;
  kernel: MathKernel | null;
  dna: ReturnType<typeof buildProblemDNA>;
  initialRole: ModelRole;
  routeReason: string;
  state: SlotState;
  role: ModelRole;
  perModelAttempts: number;
  totalAttempts: number;
  retryInstruction: string | null;
  attemptsTrace: SlotAttemptTrace[];
  accepted: GeneratedExercise | null;
  answerStatus: ItemAnswerStatus | null;
  productionReady: boolean;
  crosscheckRequired: boolean;
  lastResortUsed: boolean;
  /** a safe substitute has already been tried for this slot (at most once). */
  substituteApplied: boolean;
  degradeReason: string | null;
  slotLatencyMs: number;
  lastContent: GeneratedItemContent | null;
  crosscheckVerdict: CrosscheckVerdict | null;
  contentQualityFindings: ContentQualityFinding[];
  reviewQueueId: string | null;
}

async function pool<T, R>(items: readonly T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

function failureCategoryOf(failedGates: readonly string[], answerStatus: ItemAnswerStatus | null, detail: string): SlotFailureCategory {
  if (answerStatus === 'SEMANTIC_UNKNOWN') return 'SEMANTIC_UNKNOWN';
  if (answerStatus === 'DETERMINISTIC_WRONG') return 'KERNEL_DRIFT';
  if (failedGates.includes('SIMILARITY_OK') && /vs reference/i.test(detail)) return 'LEAKAGE';
  if (failedGates.includes('SIMILARITY_OK') || failedGates.includes('UNIQUENESS_OK')) return 'SIMILARITY_OR_DUPLICATE';
  if (failedGates.includes('SCHEMA_VALID')) return 'SCHEMA';
  if (['CURRICULUM_SAFE', 'PREREQUISITE_SAFE', 'K_LEVEL_OK', 'T_LEVEL_OK', 'SKILL_ALIGNED'].some((g) => failedGates.includes(g))) {
    return 'CURRICULUM_OR_LEVEL';
  }
  return 'OTHER';
}

/**
 * Production worksheet orchestrator (doc 63). Per-slot state machine with
 * deterministic model routing, failure-specific retries, cross-model escalation,
 * a deterministic Group-A last resort, cost guardrails and per-model bounded
 * concurrency. Accepted slots are never regenerated.
 */
export async function orchestrateWorksheet(input: WorksheetOrchestratorInput): Promise<WorksheetResult> {
  const cfg: WorksheetOrchestratorConfig = {
    ...DEFAULT_WORKSHEET_ORCHESTRATOR_CONFIG,
    ...input.config,
    concurrency: { ...DEFAULT_WORKSHEET_ORCHESTRATOR_CONFIG.concurrency, ...input.config?.concurrency },
  };
  const now = input.now ?? (() => new Date());
  const pricing = input.pricingRegistry ?? new PricingRegistry();
  const highStructures = cfg.highComplexityStructures ?? HIGH_COMPLEXITY_STRUCTURES;
  const runStart = now().getTime();

  const itemSpecs = buildItemGenerationSpecs(input.spec, input.knowledgeBase);
  const kernels = reconstructKernels(input.spec, input.knowledgeBase, input.referenceLibrary);

  const slots: SlotWork[] = itemSpecs.map((is) => {
    const kernel = kernels.get(is.itemId) ?? null;
    const refs = input.referenceLibrary.filter((r) => r.skillId === is.skillId);
    const route = routeItemModel(is);
    // the router already applies HIGH_COMPLEXITY_STRUCTURES; a caller override adds to it
    const role: ModelRole =
      route.role === 'HIGH_COMPLEXITY' || highStructures.has(is.problemStructure) ? 'HIGH_COMPLEXITY' : 'DEFAULT';
    const routeReasonText =
      role === 'HIGH_COMPLEXITY' && route.role !== 'HIGH_COMPLEXITY'
        ? `high-complexity: structure=${is.problemStructure} (caller set)`
        : route.reason;
    return {
      itemId: is.itemId,
      index: is.index,
      itemSpec: is,
      criticality: is.criticality,
      kernel,
      dna: buildProblemDNA(is, input.knowledgeBase, refs, { mathKernel: kernel }),
      initialRole: role,
      routeReason: routeReasonText,
      state: 'PENDING',
      role,
      perModelAttempts: 0,
      totalAttempts: 0,
      retryInstruction: null,
      attemptsTrace: [],
      accepted: null,
      answerStatus: null,
      productionReady: false,
      crosscheckRequired: false,
      lastResortUsed: false,
      substituteApplied: false,
      degradeReason: null,
      slotLatencyMs: 0,
      lastContent: null,
      crosscheckVerdict: null,
      contentQualityFindings: [],
      reviewQueueId: null,
    };
  });

  // number tuples already realised by a kernel — the safe substitute avoids them.
  const usedNumberTuples: number[][] = [];
  for (const s of slots) if (s.kernel) usedNumberTuples.push([...s.kernel.requiredNumbersInPrompt]);

  const totals: {
    modelCalls: number; retries: number; fallbackCalls: number; lastResortCalls: number;
    inputTokens: number; outputTokens: number; estimatedCostUsd: number; actualCostUsd: number; costCeilingHit: boolean;
  } = {
    modelCalls: 0, retries: 0, fallbackCalls: 0, lastResortCalls: 0,
    inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, costCeilingHit: false,
  };
  const byModel = new Map<string, {
    model: string; provider: string; modelVersion: string | null; calls: number; retries: number;
    fallbackCalls: number; inputTokens: number; outputTokens: number; actualCostUsd: number;
    priceConfigEffectiveDate: string | null; latencyMs: number; schemaValidCalls: number;
    operationType?: 'worksheet_batch_generation' | 'advanced_verification';
  }>();
  const bump = (gen: ItemContentGenerator) => {
    let m = byModel.get(gen.model);
    if (!m) {
      m = { model: gen.model, provider: gen.provider, modelVersion: gen.modelVersion, calls: 0, retries: 0, fallbackCalls: 0, inputTokens: 0, outputTokens: 0, actualCostUsd: 0, priceConfigEffectiveDate: null, latencyMs: 0, schemaValidCalls: 0 };
      byModel.set(gen.model, m);
    }
    return m;
  };

  const genFor = (role: ModelRole): ItemContentGenerator =>
    role === 'HIGH_COMPLEXITY' ? input.generators.highComplexity : input.generators.default;

  const EST_CALL_USD = 0.003; // conservative pre-call estimate for the ceiling guard
  const ceilingReached = () =>
    cfg.costCeilingUsd !== null && totals.actualCostUsd + EST_CALL_USD > cfg.costCeilingUsd;

  // full pipeline once for the preferred target, then once more for a safe
  // substitute: (default + retries + escalate + retries + last-resort) × 2 + slack.
  const perPassRounds = 2 + 2 * (cfg.maxRetriesPerModel + 1);
  const MAX_ROUNDS = perPassRounds * 2 + 2;
  const TERMINAL: readonly SlotState[] = ['READY', 'OMITTED', 'FAILED'];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const active = slots.filter((s) => !TERMINAL.includes(s.state));
    if (active.length === 0) break;

    // ---- rebuild any slot entering the SAFE SUBSTITUTE pass (doc 68 §5) ----
    for (const s of active) {
      if (s.state !== 'SUBSTITUTING') continue;
      const sub = buildSafeSubstitute(s.itemSpec, input.knowledgeBase, input.referenceLibrary, usedNumberTuples);
      s.substituteApplied = true;
      if (!sub) {
        s.state = 'FAILED';
        s.degradeReason = s.degradeReason ?? 'no safe substitute permitted';
        continue;
      }
      s.itemSpec = sub.itemSpec;
      s.kernel = sub.kernel;
      s.dna = sub.dna;
      if (sub.kernel) usedNumberTuples.push([...sub.kernel.requiredNumbersInPrompt]);
      s.role = 'DEFAULT';
      s.perModelAttempts = 0;
      s.retryInstruction = null;
      s.crosscheckRequired = false;
      s.crosscheckVerdict = null;
      s.answerStatus = null;
      s.productionReady = false;
      // a kernel-backed substitute goes STRAIGHT to the deterministic last-resort
      // — no model call, one attempt, guaranteed (keeps attempts/slot bounded).
      s.state = sub.kernelBacked && cfg.enableLastResort ? 'LAST_RESORT' : 'PENDING';
    }

    // ---- generation phase: per-model bounded concurrency ----
    const byRole: Record<ModelRole, SlotWork[]> = { DEFAULT: [], HIGH_COMPLEXITY: [] };
    for (const s of active) {
      if (s.state === 'LAST_RESORT' || TERMINAL.includes(s.state)) continue; // last-resort has no model call; skip newly-terminal
      byRole[s.role].push(s);
    }
    const contentBySlot = new Map<string, { content: GeneratedItemContent | null; latencyMs: number; step: SlotAttemptTrace['step'] }>();

    for (const role of ['DEFAULT', 'HIGH_COMPLEXITY'] as ModelRole[]) {
      const group = byRole[role];
      if (group.length === 0) continue;
      const gen = genFor(role);
      const conc = role === 'HIGH_COMPLEXITY' ? cfg.concurrency.highComplexity : cfg.concurrency.default;
      await pool(group, conc, async (s) => {
        if (ceilingReached()) {
          totals.costCeilingHit = true;
          contentBySlot.set(s.itemId, { content: null, latencyMs: 0, step: stepOf(s) });
          return;
        }
        const started = now().getTime();
        const req = s.retryInstruction
          ? { problemDNAs: [s.dna], retryInstructions: { [s.itemId]: [s.retryInstruction] } }
          : { problemDNAs: [s.dna] };
        let content: GeneratedItemContent | null = null;
        let outcome;
        try {
          outcome = await gen.generate(req);
        } catch {
          outcome = { ok: false as const, inability: 'generator threw', latencyMs: now().getTime() - started };
        }
        const latencyMs = now().getTime() - started;
        totals.modelCalls += 1;
        const stp = stepOf(s);
        if (stp === 'retry_same') totals.retries += 1;
        if (stp === 'escalate') totals.fallbackCalls += 1;
        const mu = bump(gen);
        mu.calls += 1;
        mu.latencyMs += latencyMs;
        if (stp === 'retry_same') mu.retries += 1;
        if (stp === 'escalate') mu.fallbackCalls += 1;
        if (outcome.ok) {
          mu.schemaValidCalls += 1;
          const at = now();
          const cost =
            gen.provider === 'mock'
              ? { actualCostUsd: 0, priceConfigVersion: null }
              : computeActualCost(outcome.usage, gen.model, at, pricing, input.fxVndPerUsd);
          totals.actualCostUsd += cost.actualCostUsd ?? 0;
          totals.inputTokens += outcome.usage?.inputTokens ?? 0;
          totals.outputTokens += outcome.usage?.outputTokens ?? 0;
          mu.actualCostUsd += cost.actualCostUsd ?? 0;
          mu.inputTokens += outcome.usage?.inputTokens ?? 0;
          mu.outputTokens += outcome.usage?.outputTokens ?? 0;
          if ('priceConfigVersion' in cost && cost.priceConfigVersion) mu.priceConfigEffectiveDate = cost.priceConfigVersion;
          content = outcome.contents.find((c) => c.itemId === s.itemId) ?? outcome.contents[0] ?? null;
        }
        contentBySlot.set(s.itemId, { content, latencyMs, step: stp });
      });
    }

    // ---- acceptance phase: SEQUENTIAL in worksheet order (siblings grow) ----
    for (const s of active) {
      if (TERMINAL.includes(s.state)) continue; // e.g. a slot with no permitted substitute
      s.totalAttempts += 1;
      s.perModelAttempts += 1;
      const attemptNo = s.totalAttempts;
      let content: GeneratedItemContent | null = null;
      let step: SlotAttemptTrace['step'] = stepOf(s);
      let usedLastResort = false;

      if (s.state === 'LAST_RESORT') {
        const siblingPrompts = slots.filter((o) => o.accepted).map((o) => o.accepted!.prompt);
        const refPrompts = input.referenceLibrary.filter((r) => r.skillId === s.itemSpec.skillId).map((r) => r.prompt);
        const lr = deterministicLastResort({
          itemSpec: s.itemSpec,
          kernel: s.kernel,
          dna: s.dna,
          siblingPrompts,
          referencePrompts: refPrompts,
        });
        totals.lastResortCalls += 1;
        usedLastResort = true;
        step = 'last_resort';
        content = lr.ok ? lr.content : null;
      } else {
        content = contentBySlot.get(s.itemId)?.content ?? null;
        step = contentBySlot.get(s.itemId)?.step ?? step;
      }

      const latencyMs = s.state === 'LAST_RESORT' ? 0 : contentBySlot.get(s.itemId)?.latencyMs ?? 0;
      s.slotLatencyMs += latencyMs;

      if (content) s.lastContent = content;

      // compose + accept
      let failureCategory: SlotFailureCategory | null = null;
      let retryReason: RetryReason | null = null;
      let accepted = false;

      if (!content) {
        failureCategory = usedLastResort ? 'OTHER' : 'NO_CONTENT';
      } else {
        const composed = composeExercise(s.itemSpec, content, s.kernel);
        if (!composed.ok) {
          failureCategory = 'COMPOSE';
          // a compose failure carries a deterministic corrective instruction
          // (wrong answer kind, no distractors, missing rubric, …). Feed it to
          // the retry — without it the retry re-runs with no correction and
          // drifts the same way (e.g. a `choice` parallel-lines item generated
          // as a "tìm x" numeric problem, over and over).
          retryReason = 'SCHEMA';
          s.retryInstruction = composed.regenerationInstruction;
        } else {
          const siblings = slots.filter((o) => o.accepted).map((o) => ({ id: o.accepted!.id, prompt: o.accepted!.prompt }));
          const res = acceptItem(composed.exercise, s.itemSpec, input.spec, input.knowledgeBase, {
            references: input.referenceLibrary
              .filter((r) => r.skillId === s.itemSpec.skillId)
              .map((r) => ({ id: r.id, prompt: r.prompt })),
            acceptedSiblings: siblings,
            ...(input.recentItems ? { recentItems: input.recentItems } : {}),
            forbiddenNumberTuples: s.dna.forbiddenSimilarities.numberTuples,
            mathKernel: s.kernel,
          });
          s.answerStatus = res.answerStatus;
          s.productionReady = res.productionReady;
          s.crosscheckRequired = res.answerStatus === 'CROSSCHECK_REQUIRED';
          if (res.accepted) {
            // deterministic content-quality gate (doc 65 §9)
            const cq = cfg.contentQuality === false
              ? { ok: true, findings: [] as ContentQualityFinding[] }
              : checkContentQuality(composed.exercise, s.kernel);
            s.contentQualityFindings = [...cq.findings];
            if (cq.ok) {
              accepted = true;
              s.accepted = composed.exercise;
              // Group C answer crosscheck (doc 65 §6) — generator ⊥ verifier.
              if (s.crosscheckRequired && input.crosscheckAdapter) {
                const cc = await runGroupCCrosscheck(composed.exercise, input.spec.schoolGrade, input.crosscheckAdapter);
                s.crosscheckVerdict = cc.verdict;
                for (const u of cc.usages) {
                  const mu = byModel.get(u.model) ?? {
                    model: u.model, provider: u.provider, modelVersion: null, calls: 0, retries: 0, fallbackCalls: 0,
                    inputTokens: 0, outputTokens: 0, actualCostUsd: 0, priceConfigEffectiveDate: null, latencyMs: 0, schemaValidCalls: 0,
                    operationType: 'advanced_verification' as const,
                  };
                  mu.calls += 1;
                  mu.inputTokens += u.inputTokens;
                  mu.outputTokens += u.outputTokens;
                  const c = computeActualCost({ inputTokens: u.inputTokens, outputTokens: u.outputTokens }, u.model, now(), pricing, input.fxVndPerUsd);
                  mu.actualCostUsd += c.actualCostUsd ?? 0;
                  totals.actualCostUsd += c.actualCostUsd ?? 0;
                  if ('priceConfigVersion' in c && c.priceConfigVersion) mu.priceConfigEffectiveDate = c.priceConfigVersion;
                  byModel.set(u.model, mu);
                }
                if (cc.state === 'REGENERATE') {
                  accepted = false;
                  s.accepted = null;
                  failureCategory = 'CROSSCHECK_FAIL';
                  retryReason = 'OTHER';
                  s.retryInstruction = 'Lời giải/đáp án bị đánh giá là SAI khi kiểm chéo. Viết lại bài với lập luận và kết quả đúng.';
                }
              }
            } else {
              failureCategory = 'CONTENT_QUALITY';
              s.retryInstruction = cq.findings.find((f) => f.severity === 'BLOCK')?.code === 'RAW_LATEX'
                ? 'KHÔNG dùng ký hiệu LaTeX (\\frac, \\times, $...$). Viết phân số dạng a/b, phép nhân ×, phép chia ÷, đơn vị cm² … theo SGK.'
                : 'Sửa lỗi định dạng: câu hỏi tiếng Việt rõ ràng, đủ 6 bậc gợi ý, rubric đầy đủ cho bài suy luận, đơn vị nhất quán.';
              retryReason = 'SCHEMA';
            }
          } else {
            const detail = res.gates.filter((g) => !g.pass).map((g) => g.detail).join(' ');
            failureCategory = failureCategoryOf(res.failedGates, res.answerStatus, detail);
            const rc = buildRetryContext(res, res.answerStatus, s.kernel);
            retryReason = rc.reason;
            s.retryInstruction = rc.instruction;
          }
        }
      }

      s.attemptsTrace.push({
        attempt: attemptNo,
        model: usedLastResort ? 'deterministic-last-resort' : genFor(s.role).model,
        role: s.role,
        step,
        accepted,
        failureCategory,
        retryReason,
        latencyMs,
      });
      if (usedLastResort) s.lastResortUsed = true;

      // ---- transition ----
      // Route an unresolved slot by CRITICALITY (doc 68 §2/§3): a REQUIRED_CORE
      // slot exhausts generate → retry → escalate → last-resort → SAFE SUBSTITUTE
      // → FAILED; an OPTIONAL / CHALLENGE slot is OMITTED (never blocks delivery,
      // never shown unverified).
      const degrade = async (reason: string, reviewReason: 'CROSSCHECK_UNCERTAIN' | 'NO_KERNEL_GENERATION_FAILED' | 'BOTH_MODELS_FAILED' | 'CONTENT_QUALITY_NONRECOVERABLE'): Promise<void> => {
        s.degradeReason = s.degradeReason ?? reason;
        if (
          s.criticality === 'REQUIRED_CORE' &&
          cfg.enableSafeSubstitute !== false &&
          s.itemSpec.fallback &&
          !s.substituteApplied
        ) {
          s.state = 'SUBSTITUTING';
          return;
        }
        if (s.criticality === 'REQUIRED_CORE') {
          s.state = 'FAILED';
          return;
        }
        // optional / challenge → omit from the child worksheet
        s.state = 'OMITTED';
        s.accepted = null;
        if (input.reviewQueue && !s.reviewQueueId) {
          const rq = await input.reviewQueue.create({
            generationSpecId: input.spec.generationSpecId,
            itemId: s.itemId,
            childRef: input.childRef ?? null,
            reason: reviewReason,
            promptSnapshot: s.lastContent?.prompt ?? null,
            workedSolutionSnapshot: s.lastContent?.workedSolution ?? null,
            detail: `optional slot OMITTED (${s.criticality}): ${reason}`,
          });
          s.reviewQueueId = rq.id;
        }
      };

      if (accepted) {
        if (!s.crosscheckRequired || s.crosscheckVerdict === 'PASS') {
          s.state = 'READY';
          continue;
        }
        // Group C answer NOT verified (UNCERTAIN, or no adapter). It is NEVER
        // delivered: a REQUIRED_CORE slot goes to a safe substitute, an optional
        // slot is omitted. Either way a review row is raised for UNCERTAIN.
        if (s.crosscheckVerdict === 'UNCERTAIN' && input.reviewQueue && s.accepted && s.criticality === 'REQUIRED_CORE') {
          const rq = await input.reviewQueue.create({
            generationSpecId: input.spec.generationSpecId,
            itemId: s.itemId,
            childRef: input.childRef ?? null,
            reason: 'CROSSCHECK_UNCERTAIN',
            promptSnapshot: s.accepted.prompt,
            workedSolutionSnapshot: s.accepted.workedSolution,
            detail: 'answer crosscheck UNCERTAIN — REQUIRED_CORE, routing to safe substitute',
          });
          s.reviewQueueId = rq.id;
        }
        await degrade(`crosscheck ${s.crosscheckVerdict ?? 'unavailable'}`, 'CROSSCHECK_UNCERTAIN');
        continue;
      }
      if (usedLastResort) {
        await degrade('deterministic last-resort could not finish the slot', 'BOTH_MODELS_FAILED');
        continue;
      }
      // the SAFE-SUBSTITUTE pass gets ONE model shot — no retry / escalate cycle
      // (keeps attempts/slot bounded; a kernel-backed substitute never gets here).
      if (s.substituteApplied) {
        await degrade(`safe substitute could not be generated (${failureCategory ?? 'OTHER'})`, 'BOTH_MODELS_FAILED');
        continue;
      }
      const canRetrySame = s.perModelAttempts <= cfg.maxRetriesPerModel && !ceilingReached();
      const canEscalate = s.role === 'DEFAULT' && !ceilingReached();
      const lastResortEligible =
        cfg.enableLastResort && s.kernel !== null && isGroupA(s.kernel);

      if (canRetrySame) {
        s.state = 'RETRYING';
      } else if (canEscalate) {
        s.state = 'ESCALATING';
        s.role = 'HIGH_COMPLEXITY';
        s.perModelAttempts = 0;
      } else if (lastResortEligible) {
        s.state = 'LAST_RESORT';
      } else {
        await degrade(
          `both models failed (last category ${failureCategory ?? 'OTHER'})`,
          s.kernel === null ? 'NO_KERNEL_GENERATION_FAILED' : 'BOTH_MODELS_FAILED',
        );
      }
    }
  }

  // any slot still mid-flight after MAX_ROUNDS — resolve by criticality
  for (const s of slots) {
    if (['READY', 'OMITTED', 'FAILED'].includes(s.state)) continue;
    s.degradeReason = s.degradeReason ?? 'unresolved after max rounds';
    s.state = s.criticality === 'REQUIRED_CORE' ? 'FAILED' : 'OMITTED';
  }

  // review queue for every genuinely FAILED (REQUIRED_CORE) slot (doc 65 §8)
  if (input.reviewQueue) {
    for (const s of slots) {
      if (s.state !== 'FAILED' || s.reviewQueueId) continue;
      const reason = s.kernel === null ? 'NO_KERNEL_GENERATION_FAILED' : 'BOTH_MODELS_FAILED';
      const rq = await input.reviewQueue.create({
        generationSpecId: input.spec.generationSpecId,
        itemId: s.itemId,
        childRef: input.childRef ?? null,
        reason,
        promptSnapshot: s.lastContent?.prompt ?? null,
        workedSolutionSnapshot: s.lastContent?.workedSolution ?? null,
        detail: `REQUIRED_CORE slot FAILED after ${s.totalAttempts} attempts; ${s.degradeReason ?? 'OTHER'}`,
      });
      s.reviewQueueId = rq.id;
    }
  }

  const readySlots = slots.filter((s) => s.state === 'READY').length;
  const pendingCrosscheckSlots = 0; // no longer a delivered state (doc 68 §7)
  const failedSlots = slots.filter((s) => s.state === 'FAILED').length;
  const substitutedSlotList = slots.filter((s) => s.substituteApplied && s.state === 'READY');
  const omittedSlotList = slots.filter((s) => s.state === 'OMITTED');

  // SAFE DEGRADED COMPLETION (doc 68 §6/§7): the worksheet is delivered iff every
  // REQUIRED_CORE slot reached READY. Optional omissions / safe substitutions do
  // not block delivery but ARE surfaced in the state.
  const coreSlots = slots.filter((s) => s.criticality === 'REQUIRED_CORE');
  const coreReady = coreSlots.filter((s) => s.state === 'READY').length;
  const readyItemSlots = slots.filter((s) => s.state === 'READY');
  const worksheetState: WorksheetState =
    coreReady < coreSlots.length || readyItemSlots.length === 0
      ? 'FAILED'
      : substitutedSlotList.length > 0
        ? 'READY_WITH_SAFE_SUBSTITUTION'
        : omittedSlotList.length > 0
          ? 'READY_WITH_OPTIONAL_OMISSIONS'
          : 'READY';

  // only READY slots reach the child (never OMITTED / FAILED / mid-flight).
  const items = readyItemSlots
    .slice()
    .sort((a, b) => a.index - b.index)
    .filter((s) => s.accepted)
    .map((s) => s.accepted!);

  const toReport = (s: SlotWork): OmittedSlotReport => ({
    itemId: s.itemId,
    index: s.index,
    criticality: s.criticality,
    reason: s.degradeReason ?? 'unknown',
    reviewQueueId: s.reviewQueueId,
  });

  const trace: WorksheetTrace = {
    generationSpecId: input.spec.generationSpecId,
    orchestratorVersion: WORKSHEET_ORCHESTRATOR_VERSION,
    routerVersion: MODEL_ROUTER_VERSION,
    retryContextVersion: RETRY_CONTEXT_VERSION,
    lastResortVersion: LAST_RESORT_VERSION,
    substituteBuilderVersion: SUBSTITUTE_BUILDER_VERSION,
    contentQualityVersion: CONTENT_QUALITY_VERSION,
    crosscheckAdapterName: input.crosscheckAdapter?.name ?? null,
    itemValidatorVersion: ITEM_VALIDATOR_VERSION,
    itemSpecBuilderVersion: ITEM_SPEC_BUILDER_VERSION,
    problemDnaBuilderVersion: PROBLEM_DNA_BUILDER_VERSION,
    mathKernelBuilderVersion: MATH_KERNEL_BUILDER_VERSION,
    config: cfg,
    perSlot: slots
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((s) => ({
        itemId: s.itemId,
        index: s.index,
        kernelFamily: s.kernel?.family ?? null,
        initialRole: s.initialRole,
        routeReason: s.routeReason,
        criticality: s.criticality,
        finalState: s.state,
        attempts: s.attemptsTrace,
        lastResortUsed: s.lastResortUsed,
        substituted: s.substituteApplied && s.state === 'READY',
        omitted: s.state === 'OMITTED',
        degradeReason: s.degradeReason,
        crosscheckRequired: s.crosscheckRequired,
        crosscheckVerdict: s.crosscheckVerdict,
        contentQualityFindings: s.contentQualityFindings,
        reviewQueueId: s.reviewQueueId,
        answerStatus: s.answerStatus,
        productionReady: s.productionReady,
        slotLatencyMs: s.slotLatencyMs,
      })),
    totals: { ...totals, byModel: [...byModel.values()] },
    worksheetLatencyMs: now().getTime() - runStart,
    createdAt: now().toISOString(),
  };

  const rawSlots: RawSlotContent[] | undefined = cfg.captureRaw
    ? slots
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((s) => ({
          itemId: s.itemId,
          finalState: s.state,
          prompt: s.accepted?.prompt ?? s.lastContent?.prompt ?? null,
          workedSolution: s.accepted?.workedSolution ?? s.lastContent?.workedSolution ?? null,
          answer: s.accepted ? JSON.stringify(s.accepted.answerSpec) : s.lastContent?.answer ?? null,
        }))
    : undefined;

  return {
    worksheetState,
    items,
    readySlots,
    pendingCrosscheckSlots,
    failedSlots,
    substitutedSlots: substitutedSlotList.length,
    omittedSlots: omittedSlotList.length,
    omittedReports: omittedSlotList.map(toReport),
    substitutedReports: substitutedSlotList.map(toReport),
    trace,
    ...(rawSlots ? { rawSlots } : {}),
  };

  function stepOf(s: SlotWork): SlotAttemptTrace['step'] {
    // the whole post-substitute pass is tagged 'substitute' so the trace shows
    // which items were delivered via a safe substitute (doc 68 §5/§14).
    if (s.substituteApplied && s.state !== 'LAST_RESORT') return 'substitute';
    if (s.state === 'PENDING') return 'default';
    if (s.state === 'RETRYING') return 'retry_same';
    if (s.state === 'ESCALATING') return 'escalate';
    if (s.state === 'GENERATING') return s.totalAttempts === 0 ? 'default' : s.role === 'HIGH_COMPLEXITY' && s.initialRole === 'DEFAULT' ? 'escalate' : 'retry_same';
    return 'default';
  }
}

function isGroupA(kernel: MathKernel): boolean {
  return MATH_KERNEL_GROUP[kernel.family] === 'A';
}
