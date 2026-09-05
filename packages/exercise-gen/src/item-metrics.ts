import type { ItemAcceptanceGate } from '@copilot/domain';
import type { ItemOrchestratorResult } from './item-orchestrator.js';

/**
 * Item-generation benchmark metrics (doc 56 §9). Reported PER MODEL and PER MODE
 * (1 item/call vs 2 items/call). The primary production metric is
 * `costPerAcceptedItemVnd`, subject to the minimum quality thresholds — never
 * the cheapest token price alone.
 */

export interface ItemBenchmarkRun {
  readonly model: string;
  readonly mode: 'A_1_PER_CALL' | 'B_2_PER_CALL';
  readonly benchmarkSpecId: string;
  readonly result: ItemOrchestratorResult;
}

export interface ItemQualityMetrics {
  readonly model: string;
  readonly mode: ItemBenchmarkRun['mode'];
  readonly specs: number;
  readonly requestedItems: number;
  readonly acceptedItems: number;
  readonly rawGenerations: number;

  readonly schemaPassRate: number;
  readonly skillAlignmentPassRate: number;
  readonly referenceLeakagePassRate: number;
  readonly withinWorksheetUniquenessPassRate: number;
  readonly kLevelPassRate: number;
  readonly tLevelPassRate: number;
  readonly curriculumSafePassRate: number;
  readonly prerequisiteSafePassRate: number;

  // --- answer verification, two-tier (doc 56 §ANSWER VERIFICATION POLICY) ---
  /** Of non-reasoning content-accepted items, fraction the verifier RULED on. */
  readonly deterministicVerifierCoverageRate: number;
  /** Of ruled items, fraction CORRECT. */
  readonly deterministicCorrectRate: number;
  /** Of ALL generated attempts, fraction the verifier proved WRONG. */
  readonly deterministicWrongRate: number;
  /** Of content-accepted items, fraction still PENDING_CROSSCHECK. */
  readonly crosscheckRequiredRate: number;

  // --- acceptance, two-tier ---
  /** content-accepted / requested — every gate passed. */
  readonly contentAcceptanceRate: number;
  /** production-ready / requested — content-accepted AND answer verified correct. */
  readonly productionAcceptanceRate: number;
  /** @deprecated == contentAcceptanceRate. */
  readonly finalAcceptanceRate: number;

  readonly averageRetriesPerAcceptedItem: number;
  readonly latencyMsPerAcceptedItem: number;

  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalCostUsd: number;
  readonly totalCostVnd: number;
  /** cost / CONTENT-accepted item. */
  readonly costPerAcceptedItemVnd: number;
  readonly costPerAcceptedItemUsd: number;
  /** cost / PRODUCTION-ready item (doc 56 §9 primary). */
  readonly costPerProductionItemVnd: number;
  readonly costPerProductionItemUsd: number;
}

const gatePassRate = (
  runs: readonly ItemBenchmarkRun[],
  gate: ItemAcceptanceGate,
): number => {
  let total = 0;
  let pass = 0;
  for (const r of runs) {
    for (const it of r.result.perItem) {
      total += 1;
      if (it.accepted || !it.failedGates.includes(gate)) pass += 1;
    }
  }
  return total > 0 ? pass / total : 0;
};

export function aggregateItemQuality(runs: readonly ItemBenchmarkRun[]): ItemQualityMetrics {
  const model = runs[0]?.model ?? 'n/a';
  const mode = runs[0]?.mode ?? 'A_1_PER_CALL';

  let requested = 0;
  let accepted = 0;
  let rawGenerations = 0;
  let schemaValidOps = 0;
  let totalOps = 0;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costVnd = 0;
  let acceptedAttemptSum = 0;

  let productionReady = 0;
  let nonReasoningContentAccepted = 0;
  let verifierRuled = 0; // CORRECT or WRONG among non-reasoning content-accepted
  let detCorrect = 0;
  let detWrongAllAttempts = 0;
  let crosscheckRequired = 0;

  for (const r of runs) {
    requested += r.result.requestedCount;
    accepted += r.result.acceptedCount;
    rawGenerations += r.result.trace.totalModelCalls;
    for (const op of r.result.operations) {
      totalOps += 1;
      if (op.schemaValid) schemaValidOps += 1;
      latencyMs += op.latencyMs;
      inputTokens += op.inputTokens ?? 0;
      outputTokens += op.outputTokens ?? 0;
      costUsd += op.actualCostUsd ?? 0;
      costVnd += op.actualCostVnd ?? 0;
    }
    for (const it of r.result.perItem) {
      if (it.accepted) acceptedAttemptSum += it.attempts;
      if (it.productionReady) productionReady += 1;
      if (it.answerStatus === 'DETERMINISTIC_WRONG') detWrongAllAttempts += 1;
      if (it.accepted) {
        if (it.answerStatus === 'CROSSCHECK_REQUIRED') crosscheckRequired += 1;
        if (it.answerKind !== 'reasoning') {
          nonReasoningContentAccepted += 1;
          if (it.answerStatus === 'DETERMINISTIC_CORRECT') {
            verifierRuled += 1;
            detCorrect += 1;
          }
          // a content-accepted item is never DETERMINISTIC_WRONG (hard-failed),
          // so among content-accepted, "ruled" == "correct"
        }
      }
    }
  }

  return {
    model,
    mode,
    specs: runs.length,
    requestedItems: requested,
    acceptedItems: accepted,
    rawGenerations,
    schemaPassRate: totalOps > 0 ? schemaValidOps / totalOps : 0,
    skillAlignmentPassRate: gatePassRate(runs, 'SKILL_ALIGNED'),
    referenceLeakagePassRate: gatePassRate(runs, 'SIMILARITY_OK'),
    withinWorksheetUniquenessPassRate: gatePassRate(runs, 'UNIQUENESS_OK'),
    kLevelPassRate: gatePassRate(runs, 'K_LEVEL_OK'),
    tLevelPassRate: gatePassRate(runs, 'T_LEVEL_OK'),
    curriculumSafePassRate: gatePassRate(runs, 'CURRICULUM_SAFE'),
    prerequisiteSafePassRate: gatePassRate(runs, 'PREREQUISITE_SAFE'),
    deterministicVerifierCoverageRate:
      nonReasoningContentAccepted > 0 ? verifierRuled / nonReasoningContentAccepted : 0,
    deterministicCorrectRate: verifierRuled > 0 ? detCorrect / verifierRuled : 1,
    deterministicWrongRate: rawGenerations > 0 ? detWrongAllAttempts / rawGenerations : 0,
    crosscheckRequiredRate: accepted > 0 ? crosscheckRequired / accepted : 0,
    contentAcceptanceRate: requested > 0 ? accepted / requested : 0,
    productionAcceptanceRate: requested > 0 ? productionReady / requested : 0,
    finalAcceptanceRate: requested > 0 ? accepted / requested : 0,
    averageRetriesPerAcceptedItem: accepted > 0 ? (acceptedAttemptSum - accepted) / accepted : 0,
    latencyMsPerAcceptedItem: accepted > 0 ? latencyMs / accepted : 0,
    inputTokens,
    outputTokens,
    totalCostUsd: costUsd,
    totalCostVnd: costVnd,
    costPerAcceptedItemVnd: accepted > 0 ? costVnd / accepted : 0,
    costPerAcceptedItemUsd: accepted > 0 ? costUsd / accepted : 0,
    costPerProductionItemVnd: productionReady > 0 ? costVnd / productionReady : 0,
    costPerProductionItemUsd: productionReady > 0 ? costUsd / productionReady : 0,
  };
}

/** Minimum quality thresholds a production-default candidate should clear (doc 56 §5/§10). */
export const ITEM_QUALITY_THRESHOLDS = {
  schemaPassRate: 1,
  skillAlignmentPassRate: 0.98,
  curriculumSafePassRate: 1,
  prerequisiteSafePassRate: 1,
  deterministicCorrectRate: 1, // when the verifier CAN rule, it must be right
  referenceLeakagePassRate: 0.99,
  withinWorksheetUniquenessPassRate: 0.99,
  kLevelPassRate: 0.95,
  tLevelPassRate: 0.95,
  contentAcceptanceRate: 0.9, // first-pass CONTENT target (doc 56 §5)
} as const;

export interface ItemQualityGateResult {
  readonly metric: keyof typeof ITEM_QUALITY_THRESHOLDS;
  readonly value: number;
  readonly threshold: number;
  readonly pass: boolean;
}

export function evaluateItemQualityGates(m: ItemQualityMetrics): {
  readonly gates: readonly ItemQualityGateResult[];
  readonly meetsThresholds: boolean;
} {
  const gates = (Object.keys(ITEM_QUALITY_THRESHOLDS) as (keyof typeof ITEM_QUALITY_THRESHOLDS)[]).map(
    (metric) => {
      const value = m[metric];
      const threshold = ITEM_QUALITY_THRESHOLDS[metric];
      return { metric, value, threshold, pass: value >= threshold };
    },
  );
  return { gates, meetsThresholds: gates.every((g) => g.pass) };
}
