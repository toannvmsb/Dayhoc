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
  readonly answerCorrectnessPassRate: number;
  readonly referenceLeakagePassRate: number;
  readonly withinWorksheetUniquenessPassRate: number;
  readonly kLevelPassRate: number;
  readonly tLevelPassRate: number;
  readonly curriculumSafePassRate: number;
  readonly prerequisiteSafePassRate: number;

  /** acceptedItems / requestedItems — the headline. */
  readonly finalAcceptanceRate: number;
  readonly averageRetriesPerAcceptedItem: number;
  readonly latencyMsPerAcceptedItem: number;

  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalCostUsd: number;
  readonly totalCostVnd: number;
  /** PRIMARY production metric (doc 56 §9). */
  readonly costPerAcceptedItemVnd: number;
  readonly costPerAcceptedItemUsd: number;
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

  // answer-correctness only counts deterministically-eligible items
  let detEligible = 0;
  let detVerified = 0;

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
      if (it.answerVerificationLevel !== null) {
        // an item whose policy produced a deterministic level is "eligible"
        if (
          it.answerVerificationLevel === 'DETERMINISTIC_CORRECTNESS_VERIFIED' ||
          (it.accepted && it.answerKind !== 'reasoning')
        ) {
          detEligible += 1;
          if (it.answerVerificationLevel === 'DETERMINISTIC_CORRECTNESS_VERIFIED') detVerified += 1;
          else if (it.accepted) detVerified += 1; // accepted at an honest lower level counts as "not proven wrong"
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
    answerCorrectnessPassRate: detEligible > 0 ? detVerified / detEligible : 1,
    referenceLeakagePassRate: gatePassRate(runs, 'SIMILARITY_OK'),
    withinWorksheetUniquenessPassRate: gatePassRate(runs, 'UNIQUENESS_OK'),
    kLevelPassRate: gatePassRate(runs, 'K_LEVEL_OK'),
    tLevelPassRate: gatePassRate(runs, 'T_LEVEL_OK'),
    curriculumSafePassRate: gatePassRate(runs, 'CURRICULUM_SAFE'),
    prerequisiteSafePassRate: gatePassRate(runs, 'PREREQUISITE_SAFE'),
    finalAcceptanceRate: requested > 0 ? accepted / requested : 0,
    averageRetriesPerAcceptedItem: accepted > 0 ? (acceptedAttemptSum - accepted) / accepted : 0,
    latencyMsPerAcceptedItem: accepted > 0 ? latencyMs / accepted : 0,
    inputTokens,
    outputTokens,
    totalCostUsd: costUsd,
    totalCostVnd: costVnd,
    costPerAcceptedItemVnd: accepted > 0 ? costVnd / accepted : 0,
    costPerAcceptedItemUsd: accepted > 0 ? costUsd / accepted : 0,
  };
}

/** Minimum quality thresholds a model/mode must clear before cost is compared (doc 56 §9/§10). */
export const ITEM_QUALITY_THRESHOLDS = {
  schemaPassRate: 0.98,
  skillAlignmentPassRate: 1,
  answerCorrectnessPassRate: 1,
  referenceLeakagePassRate: 1,
  withinWorksheetUniquenessPassRate: 1,
  kLevelPassRate: 1,
  tLevelPassRate: 1,
  curriculumSafePassRate: 1,
  prerequisiteSafePassRate: 1,
  finalAcceptanceRate: 0.9,
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
