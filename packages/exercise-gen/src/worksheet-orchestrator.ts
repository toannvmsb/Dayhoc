import type {
  ExerciseGenerationSpec,
  GeneratedExercise,
  GeneratedItemContent,
  ItemAnswerStatus,
  MathKernel,
  ProblemStructure,
} from '@copilot/domain';
import { MATH_KERNEL_GROUP } from '@copilot/domain';
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
  'PENDING_CROSSCHECK',
  'READY',
  'FAILED',
] as const;
export type SlotState = (typeof SLOT_STATES)[number];

export const WORKSHEET_STATES = ['READY', 'READY_WITH_PENDING_CROSSCHECK', 'FAILED'] as const;
export type WorksheetState = (typeof WORKSHEET_STATES)[number];

export const WORKSHEET_ORCHESTRATOR_VERSION = 'worksheet-orchestrator.v1';

export interface WorksheetOrchestratorConfig {
  /** retries on the SAME model before escalating (doc 63 §2). */
  readonly maxRetriesPerModel: number;
  /** bounded concurrency, configured PER model (doc 63 §8). */
  readonly concurrency: { readonly default: number; readonly highComplexity: number };
  /** hard USD ceiling for the whole worksheet — null = no ceiling (doc 63 §7). */
  readonly costCeilingUsd: number | null;
  /** deterministic last-resort for the final unresolved Group A slot (doc 63 §4). */
  readonly enableLastResort: boolean;
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
  readonly step: 'default' | 'retry_same' | 'escalate' | 'last_resort';
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
  readonly finalState: SlotState;
  readonly attempts: readonly SlotAttemptTrace[];
  readonly lastResortUsed: boolean;
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

export interface WorksheetResult {
  readonly worksheetState: WorksheetState;
  /** accepted exercises in worksheet order (production-ready + pending-crosscheck). */
  readonly items: readonly GeneratedExercise[];
  readonly readySlots: number;
  readonly pendingCrosscheckSlots: number;
  readonly failedSlots: number;
  readonly trace: WorksheetTrace;
  /** only when `config.captureRaw` — never logged as telemetry. */
  readonly rawSlots?: readonly RawSlotContent[];
}

// ---------------------------------------------------------------------------

interface SlotWork {
  itemId: string;
  index: number;
  itemSpec: ReturnType<typeof buildItemGenerationSpecs>[number];
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
      slotLatencyMs: 0,
      lastContent: null,
      crosscheckVerdict: null,
      contentQualityFindings: [],
      reviewQueueId: null,
    };
  });

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

  const MAX_ROUNDS = 2 + 2 * (cfg.maxRetriesPerModel + 1); // default + retries + escalate + retries + last-resort + slack
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const active = slots.filter(
      (s) => !['READY', 'PENDING_CROSSCHECK', 'FAILED'].includes(s.state),
    );
    if (active.length === 0) break;

    // ---- generation phase: per-model bounded concurrency ----
    const byRole: Record<ModelRole, SlotWork[]> = { DEFAULT: [], HIGH_COMPLEXITY: [] };
    for (const s of active) {
      if (s.state === 'LAST_RESORT') continue; // handled in the acceptance phase, no model call
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
      if (accepted) {
        if (!s.crosscheckRequired) {
          s.state = 'READY';
          continue;
        }
        // Group C — crosscheck ran in the acceptance phase; PASS keeps `accepted`.
        // AI-crosschecked ≠ deterministically verified: productionReady stays false.
        if (s.crosscheckVerdict === 'PASS') {
          s.state = 'READY';
          continue;
        }
        // UNCERTAIN (or no adapter) → PENDING_CROSSCHECK, never silently verified.
        s.state = 'PENDING_CROSSCHECK';
        if (s.crosscheckVerdict === 'UNCERTAIN' && input.reviewQueue && s.accepted) {
          const rq = await input.reviewQueue.create({
            generationSpecId: input.spec.generationSpecId,
            itemId: s.itemId,
            childRef: input.childRef ?? null,
            reason: 'CROSSCHECK_UNCERTAIN',
            promptSnapshot: s.accepted.prompt,
            workedSolutionSnapshot: s.accepted.workedSolution,
            detail: 'answer crosscheck UNCERTAIN',
          });
          s.reviewQueueId = rq.id;
        }
        continue;
      }
      if (usedLastResort) {
        s.state = 'FAILED';
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
        s.state = 'FAILED';
      }
    }
  }

  // any slot still mid-flight after MAX_ROUNDS
  for (const s of slots) {
    if (!['READY', 'PENDING_CROSSCHECK', 'FAILED'].includes(s.state)) s.state = 'FAILED';
  }

  // review queue for every genuinely FAILED slot (doc 65 §8)
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
        detail: `final state FAILED after ${s.totalAttempts} attempts; last category ${s.attemptsTrace.at(-1)?.failureCategory ?? 'OTHER'}`,
      });
      s.reviewQueueId = rq.id;
    }
  }

  const readySlots = slots.filter((s) => s.state === 'READY').length;
  const pendingCrosscheckSlots = slots.filter((s) => s.state === 'PENDING_CROSSCHECK').length;
  const failedSlots = slots.filter((s) => s.state === 'FAILED').length;

  const worksheetState: WorksheetState =
    failedSlots > 0 ? 'FAILED' : pendingCrosscheckSlots > 0 ? 'READY_WITH_PENDING_CROSSCHECK' : 'READY';

  const items = slots
    .slice()
    .sort((a, b) => a.index - b.index)
    .filter((s) => s.accepted)
    .map((s) => s.accepted!);

  const trace: WorksheetTrace = {
    generationSpecId: input.spec.generationSpecId,
    orchestratorVersion: WORKSHEET_ORCHESTRATOR_VERSION,
    routerVersion: MODEL_ROUTER_VERSION,
    retryContextVersion: RETRY_CONTEXT_VERSION,
    lastResortVersion: LAST_RESORT_VERSION,
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
        finalState: s.state,
        attempts: s.attemptsTrace,
        lastResortUsed: s.lastResortUsed,
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

  return { worksheetState, items, readySlots, pendingCrosscheckSlots, failedSlots, trace, ...(rawSlots ? { rawSlots } : {}) };

  function stepOf(s: SlotWork): SlotAttemptTrace['step'] {
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
