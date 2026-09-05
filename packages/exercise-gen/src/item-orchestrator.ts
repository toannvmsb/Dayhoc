import type {
  AnswerVerificationLevel,
  ExerciseGenerationSpec,
  GeneratedExercise,
  GeneratedExerciseBatch,
  GeneratedItemContent,
  ItemAcceptanceGate,
  ItemAnswerStatus,
  ItemGenerationSpec,
  MathKernel,
  ProblemDNA,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { PricingRegistry } from '@copilot/ai';
import type { ReferenceExample } from '@copilot/reference-library';
import { buildItemGenerationSpecs, ITEM_SPEC_BUILDER_VERSION } from './item-spec.js';
import { buildProblemDNA, PROBLEM_DNA_BUILDER_VERSION } from './problem-dna.js';
import { generateMathKernel, MATH_KERNEL_BUILDER_VERSION } from './math-kernel.js';
import { composeExercise } from './compose.js';
import { acceptItem, ITEM_VALIDATOR_VERSION } from './item-validator.js';
import type { SimilarityComparand } from './similarity-gate.js';
import type { ItemContentGenerator } from './item-generator.js';
import { selectGeneratorForAttempt, type CostGuardrailState } from './item-routing.js';
import type { GenerationOperation } from './telemetry.js';
import { computeActualCost } from './cost.js';

export interface ItemOrchestratorConfig {
  /** How many items to ask for in ONE model call — 1 or 2 only (doc 56 §4). */
  readonly itemsPerCall: 1 | 2;
  /** Bounded parallelism across item-generation calls. */
  readonly maxConcurrency: number;
  /** Extra attempts per item after the first (doc 56 §4/§11). */
  readonly maxRetriesPerItem: number;
  /** After this many attempts on an item, route to the stronger fallback. */
  readonly escalateAfterAttempts: number;
  readonly guardrail: CostGuardrailState;
}

export const DEFAULT_ITEM_ORCHESTRATOR_CONFIG: ItemOrchestratorConfig = {
  itemsPerCall: 1,
  maxConcurrency: 3,
  maxRetriesPerItem: 2,
  escalateAfterAttempts: 2,
  guardrail: 'GREEN',
};

export interface ItemOrchestratorInput {
  readonly spec: ExerciseGenerationSpec;
  readonly generator: ItemContentGenerator;
  /** Stronger fallback for the escalation step (doc 56 §11). Optional. */
  readonly fallbackGenerator?: ItemContentGenerator;
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly knowledgeBase: KnowledgeBase;
  readonly config?: Partial<ItemOrchestratorConfig>;
  /** Recently generated prompts for this child, for the leakage gate (optional). */
  readonly recentItems?: readonly SimilarityComparand[];
  readonly now?: () => Date;
  readonly newRequestId?: () => string;
  readonly pricingRegistry?: PricingRegistry;
  readonly fxVndPerUsd?: number;
}

export interface ItemRunRecord {
  readonly itemId: string;
  readonly index: number;
  readonly skillId: string;
  readonly bucket: string;
  readonly targetRole: string;
  readonly knowledgeLevel: string;
  readonly thinkingLevel: string;
  readonly answerKind: string;
  /** CONTENT acceptance — every gate passed. */
  readonly accepted: boolean;
  /** PRODUCTION-READY — content-accepted AND answer independently verified correct. */
  readonly productionReady: boolean;
  readonly answerStatus: ItemAnswerStatus | null;
  /** The MathKernel family that covered this item, or null (open / reasoning). */
  readonly kernelFamily: string | null;
  readonly attempts: number;
  readonly failedGates: readonly ItemAcceptanceGate[];
  /** Concatenated `detail` of the failed gates on the last attempt (for the failure taxonomy). */
  readonly failureDetail: string | null;
  readonly composeFailure: string | null;
  readonly answerVerificationLevel: AnswerVerificationLevel | null;
  readonly finalPrompt: string | null;
}

export interface ItemGenerationTrace {
  readonly generationSpecId: string;
  readonly generatorName: string;
  readonly fallbackGeneratorName: string | null;
  readonly itemSpecBuilderVersion: string;
  readonly problemDnaBuilderVersion: string;
  readonly mathKernelBuilderVersion: string;
  readonly itemValidatorVersion: string;
  readonly config: ItemOrchestratorConfig;
  readonly totalModelCalls: number;
  /** Fraction of items a deterministic MathKernel covered (doc 58 §5/§10). */
  readonly kernelCoverageRate: number;
  readonly createdAt: string;
}

export type ItemOrchestratorResult = {
  readonly status: 'delivered' | 'partial' | 'failed';
  readonly batch: GeneratedExerciseBatch;
  readonly requestedCount: number;
  readonly acceptedCount: number;
  readonly perItem: readonly ItemRunRecord[];
  readonly operations: readonly GenerationOperation[];
  readonly trace: ItemGenerationTrace;
};

/** Run up to `concurrency` tasks at a time; preserves result order. */
async function pool<T, R>(items: readonly T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function asComparand(x: { id: string; prompt: string }): SimilarityComparand {
  return { id: x.id, prompt: x.prompt };
}

/**
 * orchestrateItemGeneration (doc 56 §4/§10/§11).
 *
 *   spec → deterministic ItemGenerationSpec[] → ProblemDNA[] → generate 1–2
 *   items per call (bounded parallelism) → compose → HARD acceptance gate per
 *   item → regenerate ONLY the items that failed (bounded, with one stronger
 *   fallback) → assemble the accepted items in worksheet order.
 *
 * A failed item never discards a good one. Fully deterministic except for the
 * injected generator's own output.
 */
export async function orchestrateItemGeneration(
  input: ItemOrchestratorInput,
): Promise<ItemOrchestratorResult> {
  const cfg = { ...DEFAULT_ITEM_ORCHESTRATOR_CONFIG, ...input.config };
  const now = input.now ?? (() => new Date());
  const pricing = input.pricingRegistry ?? new PricingRegistry();
  let reqSeq = 0;
  const newRequestId = input.newRequestId ?? (() => `item_req_${(reqSeq += 1)}`);

  const itemSpecs = buildItemGenerationSpecs(input.spec, input.knowledgeBase);
  const dnaFor = new Map<string, ProblemDNA>();
  const kernelFor = new Map<string, MathKernel | null>();
  const refComparands = new Map<string, SimilarityComparand[]>(); // skillId → refs
  const usedTuples: number[][] = [];
  for (const is of itemSpecs) {
    const refs = input.referenceLibrary.filter((r) => r.skillId === is.skillId);
    if (!refComparands.has(is.skillId)) {
      refComparands.set(
        is.skillId,
        refs.map((r) => ({ id: r.id, prompt: r.prompt })),
      );
    }
    const refTuples = refs
      .map((r) => [...r.prompt.matchAll(/\d+/g)].map((m) => Number(m[0])))
      .filter((t) => t.length > 0);
    const kres = generateMathKernel(is, input.knowledgeBase, {
      forbiddenNumberTuples: refTuples,
      recentNumberTuples: usedTuples,
    });
    const kernel = kres.ok ? kres.kernel : null;
    if (kernel) usedTuples.push([...kernel.requiredNumbersInPrompt]);
    kernelFor.set(is.itemId, kernel);
    dnaFor.set(is.itemId, buildProblemDNA(is, input.knowledgeBase, refs, { mathKernel: kernel }));
  }

  const accepted = new Map<string, GeneratedExercise>();
  const attempts = new Map<string, number>();
  const lastInstructions = new Map<string, string[]>();
  const lastFailedGates = new Map<string, readonly ItemAcceptanceGate[]>();
  const lastFailureDetail = new Map<string, string>();
  const composeFailure = new Map<string, string | null>();
  const answerLevel = new Map<string, AnswerVerificationLevel | null>();
  const answerStatusById = new Map<string, ItemAnswerStatus>();
  const productionReadyById = new Map<string, boolean>();
  const operations: GenerationOperation[] = [];

  let unaccepted = [...itemSpecs];
  let round = 0;
  let totalModelCalls = 0;

  while (unaccepted.length > 0 && round <= cfg.maxRetriesPerItem) {
    const groups = chunk(unaccepted, cfg.itemsPerCall);

    const groupOutcomes = await pool(groups, cfg.maxConcurrency, async (group) => {
      const dnas = group.map((is) => dnaFor.get(is.itemId)!);
      const retryInstructions: Record<string, readonly string[]> = {};
      for (const is of group) {
        const inst = lastInstructions.get(is.itemId);
        if (inst && inst.length > 0) retryInstructions[is.itemId] = inst;
      }
      // routing: attempt number is the max attempts among this group's items
      const attempt = Math.max(...group.map((is) => attempts.get(is.itemId) ?? 0));
      const route = selectGeneratorForAttempt({
        attempt,
        itemSpec: group[0]!,
        defaultGenerator: input.generator,
        fallbackGenerator: input.fallbackGenerator ?? null,
        escalateAfterAttempts: cfg.escalateAfterAttempts,
        guardrail: cfg.guardrail,
      });
      const started = now().getTime();
      const outcome = await route.generator.generate({
        problemDNAs: dnas,
        ...(Object.keys(retryInstructions).length > 0 ? { retryInstructions } : {}),
      });
      const latencyMs = now().getTime() - started;
      return { group, route, outcome, latencyMs };
    });

    // record operations + collect contents
    const contentByItem = new Map<string, GeneratedItemContent>();
    for (const go of groupOutcomes) {
      totalModelCalls += 1;
      const usage = go.outcome.usage;
      const at = now();
      const cost =
        go.route.generator.provider === 'mock'
          ? { actualCostUsd: 0, actualCostVnd: 0, priceConfigVersion: null }
          : computeActualCost(usage, go.route.generator.model, at, pricing, input.fxVndPerUsd);
      operations.push({
        operationType: 'worksheet_batch_generation',
        provider: go.route.generator.provider,
        model: go.route.generator.model,
        modelVersion: go.route.generator.modelVersion,
        promptVersion: go.route.generator.promptVersion,
        structuredOutputMode: go.outcome.providerMeta?.structuredOutputMode ?? null,
        outputSchemaName: go.outcome.providerMeta?.outputSchemaName ?? null,
        outputSchemaVersion: go.outcome.providerMeta?.outputSchemaVersion ?? null,
        generationSpecId: input.spec.generationSpecId,
        kTarget: `${go.group[0]!.knowledgeLevel}`,
        tTarget: `${go.group[0]!.thinkingLevel}`,
        retryCount: round,
        schemaValid: go.outcome.ok,
        estimatedCostUsd: 0,
        actualCostUsd: cost.actualCostUsd,
        actualCostVnd: cost.actualCostVnd,
        priceConfigVersion: cost.priceConfigVersion,
        inputTokens: usage?.inputTokens ?? null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        escalatedFrom: go.route.step === 'fallback_stronger' ? input.generator.model : null,
        latencyMs: go.latencyMs,
        requestId: newRequestId(),
        createdAt: at.toISOString(),
      });
      if (go.outcome.ok) {
        for (const c of go.outcome.contents) contentByItem.set(c.itemId, c);
      }
    }

    // SEQUENTIAL acceptance pass in worksheet order — acceptedSiblings grows
    // incrementally, so within-worksheet uniqueness / similarity is deterministic.
    const stillUnaccepted: ItemGenerationSpec[] = [];
    for (const is of unaccepted) {
      attempts.set(is.itemId, (attempts.get(is.itemId) ?? 0) + 1);
      const content = contentByItem.get(is.itemId);
      if (!content) {
        composeFailure.set(is.itemId, 'no content returned by the generator');
        lastInstructions.set(is.itemId, ['Sinh nội dung cho câu hỏi này.']);
        stillUnaccepted.push(is);
        continue;
      }
      const kernel = kernelFor.get(is.itemId) ?? null;
      const composed = composeExercise(is, content, kernel);
      if (!composed.ok) {
        composeFailure.set(is.itemId, composed.reason);
        lastInstructions.set(is.itemId, [composed.regenerationInstruction]);
        lastFailedGates.set(is.itemId, ['SCHEMA_VALID']);
        stillUnaccepted.push(is);
        continue;
      }
      composeFailure.set(is.itemId, null);
      const siblings: SimilarityComparand[] = [...accepted.values()].map((e) => asComparand({ id: e.id, prompt: e.prompt }));
      const dna = dnaFor.get(is.itemId)!;
      const result = acceptItem(composed.exercise, is, input.spec, input.knowledgeBase, {
        references: refComparands.get(is.skillId) ?? [],
        acceptedSiblings: siblings,
        ...(input.recentItems ? { recentItems: input.recentItems } : {}),
        forbiddenNumberTuples: dna.forbiddenSimilarities.numberTuples,
        mathKernel: kernel,
      });
      answerLevel.set(is.itemId, result.answerVerificationLevel);
      answerStatusById.set(is.itemId, result.answerStatus);
      productionReadyById.set(is.itemId, result.productionReady);
      if (result.accepted) {
        accepted.set(is.itemId, composed.exercise);
        lastFailedGates.set(is.itemId, []);
        lastInstructions.set(is.itemId, []);
      } else {
        lastFailedGates.set(is.itemId, result.failedGates);
        lastFailureDetail.set(
          is.itemId,
          result.gates.filter((g) => !g.pass).map((g) => `${g.gate}: ${g.detail}`).join(' | '),
        );
        lastInstructions.set(
          is.itemId,
          result.gates.filter((g) => !g.pass && g.regenerationInstruction).map((g) => g.regenerationInstruction!),
        );
        stillUnaccepted.push(is);
      }
    }

    unaccepted = stillUnaccepted;
    round += 1;
  }

  const orderedAccepted = itemSpecs
    .map((is) => accepted.get(is.itemId))
    .filter((e): e is GeneratedExercise => e !== undefined);

  const perItem: ItemRunRecord[] = itemSpecs.map((is) => ({
    itemId: is.itemId,
    index: is.index,
    skillId: is.skillId,
    bucket: is.bucket,
    targetRole: is.targetRole,
    knowledgeLevel: is.knowledgeLevel,
    thinkingLevel: is.thinkingLevel,
    answerKind: is.answerKind,
    accepted: accepted.has(is.itemId),
    productionReady: productionReadyById.get(is.itemId) ?? false,
    answerStatus: answerStatusById.get(is.itemId) ?? null,
    kernelFamily: kernelFor.get(is.itemId)?.family ?? null,
    attempts: attempts.get(is.itemId) ?? 0,
    failedGates: lastFailedGates.get(is.itemId) ?? [],
    failureDetail: composeFailure.get(is.itemId) ?? lastFailureDetail.get(is.itemId) ?? null,
    composeFailure: composeFailure.get(is.itemId) ?? null,
    answerVerificationLevel: answerLevel.get(is.itemId) ?? null,
    finalPrompt: accepted.get(is.itemId)?.prompt ?? null,
  }));

  const batch: GeneratedExerciseBatch = {
    generationSpecId: input.spec.generationSpecId,
    generatedAt: now().toISOString(),
    generatorModel: input.generator.model,
    items: orderedAccepted,
  };

  const trace: ItemGenerationTrace = {
    generationSpecId: input.spec.generationSpecId,
    generatorName: input.generator.name,
    fallbackGeneratorName: input.fallbackGenerator?.name ?? null,
    itemSpecBuilderVersion: ITEM_SPEC_BUILDER_VERSION,
    problemDnaBuilderVersion: PROBLEM_DNA_BUILDER_VERSION,
    mathKernelBuilderVersion: MATH_KERNEL_BUILDER_VERSION,
    itemValidatorVersion: ITEM_VALIDATOR_VERSION,
    config: cfg,
    totalModelCalls,
    kernelCoverageRate:
      itemSpecs.length > 0
        ? [...kernelFor.values()].filter((k) => k !== null).length / itemSpecs.length
        : 0,
    createdAt: now().toISOString(),
  };

  const acceptedCount = orderedAccepted.length;
  const status: ItemOrchestratorResult['status'] =
    acceptedCount === itemSpecs.length ? 'delivered' : acceptedCount === 0 ? 'failed' : 'partial';

  return {
    status,
    batch,
    requestedCount: itemSpecs.length,
    acceptedCount,
    perItem,
    operations,
    trace,
  };
}
