import type { ExerciseGenerationSpec } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary, type ReferenceExample } from '@copilot/reference-library';
import {
  aggregateItemQuality,
  evaluateItemQualityGates,
  orchestrateItemGeneration,
  type ItemBenchmarkRun,
  type ItemContentGenerator,
  type ItemOrchestratorConfig,
  type ItemQualityMetrics,
} from '@copilot/exercise-gen';
import { KB } from '../harness.js';
import { buildBenchmarkManifest } from './luna-benchmark-manifest.js';
import { buildHardCaseManifest } from './luna-hardcase-manifest.js';

/**
 * Item-generation benchmark (doc 56 §8/§9). Runs the SAME set of
 * `ExerciseGenerationSpec`s through the item-level pipeline for every
 * model × mode, and reports per-model/per-mode metrics whose PRIMARY figure is
 * `costPerAcceptedItemVnd` subject to the quality thresholds.
 *
 * The harness never makes a network call itself — the caller injects one
 * `ItemContentGenerator` per model (a `createLunaItemContentGenerator(adapter)`
 * for a real model, `createMockItemContentGenerator()` for the offline path).
 * A spend guardrail stops the run before it exceeds the configured call / cost
 * ceiling (doc 56 §12).
 */

export const ITEM_BENCHMARK_VERSION = 'item-generation-benchmark.v1';

export interface ItemBenchmarkSpec {
  readonly id: string;
  readonly label: string;
  readonly grade: number;
  readonly axis: string;
  readonly spec: ExerciseGenerationSpec;
}

/** ≥20 representative specs spanning the required axes (doc 56 §8). */
export function buildItemBenchmarkSpecs(kb: KnowledgeBase = KB): ItemBenchmarkSpec[] {
  const out: ItemBenchmarkSpec[] = [];

  // hard cases HC01–HC10 — the differentiators (frontier / T4-T5 / gap repair / estimated)
  for (const hc of buildHardCaseManifest()) {
    const d = hc.spec.generationPlan.distribution;
    const axis =
      d.advanced > 0
        ? 'frontier_advanced'
        : d.thinkingChallenge > 0
          ? 'thinking'
          : d.prerequisiteRepair > 0
            ? 'gap_repair'
            : 'application';
    out.push({ id: hc.hardCaseId, label: hc.label, grade: hc.grade, axis, spec: hc.spec });
  }

  // golden LT profiles — realistic G4 + G7 "basic / current curriculum" specs
  for (const bc of buildBenchmarkManifest(kb)) {
    const d = bc.spec.generationPlan.distribution;
    const axis =
      d.advanced > 0 ? 'frontier_advanced' : d.prerequisiteRepair > 0 ? 'gap_repair' : 'basic_current';
    out.push({ id: bc.benchmarkCaseId, label: bc.label, grade: bc.grade, axis, spec: bc.spec });
  }

  return out;
}

export type ItemBenchmarkMode = ItemBenchmarkRun['mode'];
export const ITEM_BENCHMARK_MODES: readonly ItemBenchmarkMode[] = ['A_1_PER_CALL', 'B_2_PER_CALL'];

function itemsPerCall(mode: ItemBenchmarkMode): 1 | 2 {
  return mode === 'A_1_PER_CALL' ? 1 : 2;
}

export interface RunItemBenchmarkInput {
  /** model label → its content generator (Luna-backed or mock). */
  readonly generators: Readonly<Record<string, ItemContentGenerator>>;
  /** Optional stronger fallback per model label (doc 56 §11). */
  readonly fallbackGenerators?: Readonly<Record<string, ItemContentGenerator>>;
  readonly specs: readonly ItemBenchmarkSpec[];
  readonly modes?: readonly ItemBenchmarkMode[];
  readonly knowledgeBase?: KnowledgeBase;
  readonly referenceLibrary?: readonly ReferenceExample[];
  readonly orchestratorConfig?: Partial<ItemOrchestratorConfig>;
  /** Spend guardrail (doc 56 §12) — the run stops BEFORE exceeding either. */
  readonly maxModelCalls: number;
  readonly maxCostUsd: number;
  readonly now?: () => Date;
}

export interface ItemBenchmarkReport {
  readonly benchmarkVersion: string;
  readonly timestamp: string;
  readonly specCount: number;
  readonly modes: readonly ItemBenchmarkMode[];
  readonly models: readonly string[];
  readonly stoppedEarly: boolean;
  readonly stopReason: string | null;
  readonly totalModelCalls: number;
  readonly totalCostUsd: number;
  /** One metrics block per (model, mode). */
  readonly byModelMode: readonly (ItemQualityMetrics & {
    readonly meetsThresholds: boolean;
    readonly failedThresholds: readonly string[];
  })[];
  readonly perSpec: readonly {
    readonly specId: string;
    readonly model: string;
    readonly mode: ItemBenchmarkMode;
    readonly status: string;
    readonly acceptedCount: number;
    readonly requestedCount: number;
  }[];
}

/** Deterministic call-count / cost estimate for the checkpoint report (doc 56 §13.I/J). */
export function estimateItemBenchmarkCalls(
  specs: readonly ItemBenchmarkSpec[],
  models: readonly string[],
  modes: readonly ItemBenchmarkMode[],
  cfg: Partial<ItemOrchestratorConfig> = {},
): { minCalls: number; maxCalls: number; requestedItems: number } {
  const maxRetries = cfg.maxRetriesPerItem ?? 2;
  let minCalls = 0;
  let maxCalls = 0;
  let items = 0;
  for (const s of specs) {
    const q = s.spec.generationPlan.totalQuestions;
    items += q * models.length * modes.length;
    for (const mode of modes) {
      const per = itemsPerCall(mode);
      const firstPass = Math.ceil(q / per);
      minCalls += firstPass * models.length;
      // worst case: every item needs `maxRetries` extra 1-item retries
      maxCalls += (firstPass + q * maxRetries) * models.length;
    }
  }
  return { minCalls, maxCalls, requestedItems: items };
}

export async function runItemBenchmark(input: RunItemBenchmarkInput): Promise<ItemBenchmarkReport> {
  const kb = input.knowledgeBase ?? KB;
  const lib = input.referenceLibrary ?? loadReferenceLibrary();
  const modes = input.modes ?? ITEM_BENCHMARK_MODES;
  const models = Object.keys(input.generators);
  const now = input.now ?? (() => new Date());

  const runsByKey = new Map<string, ItemBenchmarkRun[]>();
  const perSpec: ItemBenchmarkReport['perSpec'][number][] = [];
  let totalModelCalls = 0;
  let totalCostUsd = 0;
  let stoppedEarly = false;
  let stopReason: string | null = null;

  outer: for (const model of models) {
    for (const mode of modes) {
      for (const s of input.specs) {
        if (totalModelCalls >= input.maxModelCalls) {
          stoppedEarly = true;
          stopReason = `reached maxModelCalls=${input.maxModelCalls}`;
          break outer;
        }
        if (totalCostUsd >= input.maxCostUsd) {
          stoppedEarly = true;
          stopReason = `reached maxCostUsd=${input.maxCostUsd} (spent ${totalCostUsd.toFixed(4)})`;
          break outer;
        }
        const result = await orchestrateItemGeneration({
          spec: s.spec,
          generator: input.generators[model]!,
          ...(input.fallbackGenerators?.[model] ? { fallbackGenerator: input.fallbackGenerators[model] } : {}),
          referenceLibrary: lib,
          knowledgeBase: kb,
          config: { ...input.orchestratorConfig, itemsPerCall: itemsPerCall(mode) },
          ...(input.now ? { now: input.now } : {}),
        });
        totalModelCalls += result.trace.totalModelCalls;
        totalCostUsd += result.operations.reduce((x, op) => x + (op.actualCostUsd ?? 0), 0);

        const key = `${model}::${mode}`;
        if (!runsByKey.has(key)) runsByKey.set(key, []);
        runsByKey.get(key)!.push({ model, mode, benchmarkSpecId: s.id, result });
        perSpec.push({
          specId: s.id,
          model,
          mode,
          status: result.status,
          acceptedCount: result.acceptedCount,
          requestedCount: result.requestedCount,
        });
      }
    }
  }

  const byModelMode = [...runsByKey.values()].map((runs) => {
    const m = aggregateItemQuality(runs);
    const gates = evaluateItemQualityGates(m);
    return {
      ...m,
      meetsThresholds: gates.meetsThresholds,
      failedThresholds: gates.gates.filter((g) => !g.pass).map((g) => g.metric),
    };
  });

  return {
    benchmarkVersion: ITEM_BENCHMARK_VERSION,
    timestamp: now().toISOString(),
    specCount: input.specs.length,
    modes,
    models,
    stoppedEarly,
    stopReason,
    totalModelCalls,
    totalCostUsd,
    byModelMode,
    perSpec,
  };
}

export function formatItemBenchmarkReport(r: ItemBenchmarkReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [
    `Item-generation benchmark ${r.benchmarkVersion} — ${r.specCount} specs × ${r.models.length} models × ${r.modes.length} modes`,
    `  model calls: ${r.totalModelCalls}   spend USD: ${r.totalCostUsd.toFixed(4)}`,
    r.stoppedEarly ? `  STOPPED EARLY: ${r.stopReason}` : '  (ran to completion)',
    '',
  ];
  for (const m of [...r.byModelMode].sort((a, b) => b.productionAcceptanceRate - a.productionAcceptanceRate)) {
    lines.push(
      `${m.model}  [${m.mode}]  ${m.meetsThresholds ? 'MEETS THRESHOLDS' : 'FAILS: ' + m.failedThresholds.join(', ')}`,
      `  CONTENT acceptance:       ${pct(m.contentAcceptanceRate)}   (${m.acceptedItems}/${m.requestedItems})`,
      `  PRODUCTION-ready:         ${pct(m.productionAcceptanceRate)}   (pending crosscheck: ${pct(m.crosscheckRequiredRate)} of accepted)`,
      `  schema / skill / K / T:   ${pct(m.schemaPassRate)} / ${pct(m.skillAlignmentPassRate)} / ${pct(m.kLevelPassRate)} / ${pct(m.tLevelPassRate)}`,
      `  leakage / uniqueness:     ${pct(m.referenceLeakagePassRate)} / ${pct(m.withinWorksheetUniquenessPassRate)}`,
      `  curriculum / prereq:      ${pct(m.curriculumSafePassRate)} / ${pct(m.prerequisiteSafePassRate)}`,
      `  verifier coverage / correct / wrong: ${pct(m.deterministicVerifierCoverageRate)} / ${pct(m.deterministicCorrectRate)} / ${pct(m.deterministicWrongRate)}`,
      `  retries/accepted item:    ${m.averageRetriesPerAcceptedItem.toFixed(2)}   latency/item ms: ${m.latencyMsPerAcceptedItem.toFixed(0)}`,
      `  tokens in/out:            ${m.inputTokens} / ${m.outputTokens}   cost USD/VND: ${m.totalCostUsd.toFixed(4)} / ${m.totalCostVnd.toFixed(0)}`,
      `  cost / CONTENT item:      ${m.costPerAcceptedItemVnd.toFixed(1)} VND`,
      `  >>> cost / PRODUCTION item: ${m.costPerProductionItemVnd.toFixed(1)} VND (${m.costPerProductionItemUsd.toFixed(5)} USD)`,
      '',
    );
  }
  return lines.join('\n');
}
