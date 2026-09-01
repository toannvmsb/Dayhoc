import type {
  BatchDisposition,
  BatchValidationResult,
  ExerciseGenerationSpec,
  GeneratedExercise,
  GeneratedExerciseBatch,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { PricingRegistry } from '@copilot/ai';
import type { ReferenceExample } from '@copilot/reference-library';
import { buildGenerationGrounding, type GenerationGrounding } from './grounding.js';
import type { ExerciseGenerator, GenerationInability, GenerationProviderMeta, GenerationUsage } from './generator.js';
import { slotRequestsFor } from './repair.js';
import { validateGeneratedBatch } from './validator.js';
import type { GenerationOperation } from './telemetry.js';
import { computeActualCost } from './cost.js';

export interface OrchestratorConfig {
  /** Fresh full-batch generations after a QUARANTINE / inability. */
  readonly maxGenerationAttempts: number;
  /** Slot repair/regeneration rounds within one generation. */
  readonly maxRepairAttempts: number;
}
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxGenerationAttempts: 2,
  maxRepairAttempts: 2,
};

export interface OrchestratorInput {
  readonly spec: ExerciseGenerationSpec;
  readonly generator: ExerciseGenerator;
  readonly referenceLibrary: readonly ReferenceExample[];
  readonly knowledgeBase: KnowledgeBase;
  readonly config?: Partial<OrchestratorConfig>;
  readonly now?: () => Date;
  readonly newRequestId?: () => string;
  /** Price registry for actual-cost lookup (doc 14 C5 §15). Defaults to the documented table. */
  readonly pricingRegistry?: PricingRegistry;
  readonly fxVndPerUsd?: number;
}

export interface GenerationTrace {
  readonly generationSpecId: string;
  readonly groundingHash: string;
  readonly generatorName: string;
  readonly provider: string;
  readonly model: string;
  readonly generationAttempts: number;
  readonly repairAttempts: number;
  readonly validatorVersion: string;
  readonly finalDisposition: BatchDisposition | 'GENERATOR_INABILITY';
  readonly operations: readonly GenerationOperation[];
  readonly createdAt: string;
}

export type OrchestratorResult =
  | {
      readonly status: 'delivered';
      readonly batch: GeneratedExerciseBatch;
      readonly validation: BatchValidationResult;
      readonly trace: GenerationTrace;
    }
  | {
      readonly status: 'failed';
      readonly reason: string;
      readonly lastValidation: BatchValidationResult | null;
      readonly lastInability: GenerationInability | null;
      readonly trace: GenerationTrace;
    };

const STATE_MACHINE = ['build_grounding', 'generate', 'validate', 'repair_or_regenerate', 'done'] as const;
export type OrchestratorState = (typeof STATE_MACHINE)[number];

/**
 * ExerciseGenerationOrchestrator (doc 14 C4 §J).
 *
 *   spec → build grounding → generate → validate → repair/regenerate (bounded)
 *        → FinalValidatedBatch OR structured failure.
 *
 * Bounded: never an infinite retry loop. Provider-agnostic — it only speaks the
 * `ExerciseGenerator` interface. The Mock generator does NOT bypass the validator.
 */
export async function orchestrateGeneration(input: OrchestratorInput): Promise<OrchestratorResult> {
  const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...input.config };
  const now = input.now ?? (() => new Date());
  let reqSeq = 0;
  const newRequestId = input.newRequestId ?? (() => `gen_req_${(reqSeq += 1)}`);

  const grounding = buildGenerationGrounding(input.spec, input.referenceLibrary, input.knowledgeBase);
  const operations: GenerationOperation[] = [];
  const pricingRegistry = input.pricingRegistry ?? new PricingRegistry();
  let generationAttempts = 0;
  let repairAttempts = 0;
  let lastValidation: BatchValidationResult | null = null;
  let lastInability: GenerationInability | null = null;

  const op = (
    provider: string,
    model: string,
    modelVersion: string | null,
    latencyMs: number,
    schemaValid: boolean,
    retryCount: number,
    usage?: GenerationUsage,
    providerMeta?: GenerationProviderMeta,
  ): void => {
    const at = now();
    // MOCK is free by contract; a live provider's cost comes only from real usage —
    // never a guess (doc 14 C5 §15: "do not pretend estimate is actual").
    const cost =
      provider === 'mock'
        ? { actualCostUsd: 0, actualCostVnd: 0, priceConfigVersion: null }
        : computeActualCost(usage, model, at, pricingRegistry, input.fxVndPerUsd);
    operations.push({
      operationType: 'worksheet_batch_generation',
      provider: provider as GenerationOperation['provider'],
      model,
      modelVersion,
      promptVersion: input.generator.promptVersion,
      structuredOutputMode: providerMeta?.structuredOutputMode ?? null,
      outputSchemaName: providerMeta?.outputSchemaName ?? null,
      outputSchemaVersion: providerMeta?.outputSchemaVersion ?? null,
      generationSpecId: input.spec.generationSpecId,
      kTarget: `${input.spec.difficulty.kMin}-${input.spec.difficulty.kMax}`,
      tTarget: `${input.spec.difficulty.tMin}-${input.spec.difficulty.tMax}`,
      retryCount,
      schemaValid,
      estimatedCostUsd: 0, // FORECAST — a live provider fills this from unit economics (@copilot/ai forecastByOperation)
      actualCostUsd: cost.actualCostUsd,
      actualCostVnd: cost.actualCostVnd,
      priceConfigVersion: cost.priceConfigVersion,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      escalatedFrom: null, // reserved — model routing/escalation is decided upstream (@copilot/ai routing.ts), not here
      latencyMs,
      requestId: newRequestId(),
      createdAt: at.toISOString(),
    });
  };

  const makeTrace = (final: GenerationTrace['finalDisposition']): GenerationTrace => ({
    generationSpecId: input.spec.generationSpecId,
    groundingHash: grounding.groundingHash,
    generatorName: input.generator.name,
    provider: input.generator.provider,
    model: input.generator.model,
    generationAttempts,
    repairAttempts,
    validatorVersion: lastValidation?.validatorVersion ?? 'n/a',
    finalDisposition: final,
    operations,
    createdAt: now().toISOString(),
  });

  while (generationAttempts < cfg.maxGenerationAttempts) {
    generationAttempts += 1;

    // --- generate a full batch ---
    const gen = await input.generator.generate({ grounding });
    if (!gen.ok) {
      lastInability = gen.inability;
      op(input.generator.provider, input.generator.model, input.generator.modelVersion, gen.latencyMs, false, generationAttempts - 1, gen.usage, gen.providerMeta);
      continue; // fresh attempt
    }
    let batch: GeneratedExerciseBatch = gen.batch;
    op(input.generator.provider, input.generator.model, input.generator.modelVersion, gen.latencyMs, true, generationAttempts - 1, gen.usage, gen.providerMeta);

    // --- validate → repair/regenerate loop ---
    repairAttempts = 0;
    while (true) {
      const validation = validateGeneratedBatch(batch, input.spec, input.knowledgeBase, grounding.referenceExamples);
      lastValidation = validation;

      if (validation.deliverable) {
        return { status: 'delivered', batch, validation, trace: makeTrace(validation.batchDisposition) };
      }
      if (validation.batchDisposition === 'QUARANTINE') break; // discard, fresh full attempt
      if (repairAttempts >= cfg.maxRepairAttempts) break; // give up on this batch

      // build deterministic slot requests from the findings
      repairAttempts += 1;
      const acceptedIds = new Set(validation.acceptedItems.map((i) => i.id));
      const slots = slotRequestsFor(
        validation.findings,
        acceptedIds,
        batch.items.map((i) => ({ id: i.id, bucket: i.bucket, skillId: i.skillId })),
        grounding,
        validation.shortfall,
      );
      if (slots.length === 0) break;

      const regen = await input.generator.generate({ grounding, regenerate: slots });
      op(
        input.generator.provider,
        input.generator.model,
        input.generator.modelVersion,
        regen.ok ? regen.latencyMs : 1,
        regen.ok,
        repairAttempts,
        regen.usage,
        regen.providerMeta,
      );
      if (!regen.ok) {
        lastInability = regen.inability;
        break;
      }
      // splice: keep accepted items, add the regenerated ones
      const replaced = new Set(slots.flatMap((s) => s.replaces));
      const kept = batch.items.filter((i) => acceptedIds.has(i.id) && !replaced.has(i.id));
      batch = { ...batch, items: dedupeById([...kept, ...regen.batch.items]) };
    }
  }

  return {
    status: 'failed',
    reason:
      lastValidation && lastValidation.batchDisposition === 'QUARANTINE'
        ? `batch quarantined after ${generationAttempts} generation attempt(s): ${lastValidation.reasonCodes.join(', ')}`
        : lastInability
          ? `generator could not satisfy the grounding: ${lastInability.reason} — ${lastInability.detail}`
          : `could not produce a deliverable batch within ${generationAttempts} generation × ${repairAttempts} repair attempts`,
    lastValidation,
    lastInability,
    trace: makeTrace('GENERATOR_INABILITY'),
  };
}

function dedupeById(items: readonly GeneratedExercise[]): GeneratedExercise[] {
  const seen = new Set<string>();
  const out: GeneratedExercise[] = [];
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

export { STATE_MACHINE, type GenerationGrounding };
