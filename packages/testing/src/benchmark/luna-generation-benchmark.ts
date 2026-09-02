import { loadReferenceLibrary, type ReferenceExample } from '@copilot/reference-library';
import type { KnowledgeBase } from '@copilot/math-data';
import type { AIProviderAdapter, StructuredOutputMode } from '@copilot/ai';
import {
  aggregateShadowMetrics,
  createLunaExerciseGenerator,
  EXERCISE_GENERATOR_PROMPT_VERSION,
  orchestrateGeneration,
  summarizeAnswerVerification,
  type ShadowMetricRecord,
  type ShadowMetrics,
} from '@copilot/exercise-gen';
import { GENERATED_BATCH_JSON_SCHEMA_VERSION } from '@copilot/schemas';
import { KB } from '../harness.js';
import {
  BENCHMARK_MANIFEST_VERSION,
  buildBenchmarkManifest,
  manifestCoverage,
  type BenchmarkCase,
} from './luna-benchmark-manifest.js';
import { algebraicFrontierTrace, buildHardCaseManifest, HARDCASE_MANIFEST_VERSION, type HardCase } from './luna-hardcase-manifest.js';
import {
  assessBenchmarkReadiness,
  computeCoverageMatrix,
  probeAnswerCoverage,
  type BenchmarkReadiness,
  type CoverageCase,
  type CoverageMatrix,
} from './luna-benchmark-coverage.js';

export {
  buildBenchmarkManifest,
  buildHardCaseManifest,
  manifestCoverage,
  computeCoverageMatrix,
  assessBenchmarkReadiness,
  BENCHMARK_MANIFEST_VERSION,
  HARDCASE_MANIFEST_VERSION,
  type BenchmarkCase,
  type HardCase,
  type CoverageMatrix,
  type BenchmarkReadiness,
};

/**
 * The 5 representative smoke cases (doc 14 C5 §A2) — filtering ONLY, the cases
 * themselves are the existing frozen manifest entries:
 *   1. Grade-4 standard/current curriculum
 *   2. Grade-7 standard/current curriculum
 *   3. grade-level T5 thinking
 *   4. above-grade FRONTIER incl. K5
 *   5. Parallel Gap Repair / frontier safety
 */
export const SMOKE_CASE_IDS = ['BENCH-LT-G4-01', 'BENCH-LT-G7-01', 'HC03', 'HC10', 'HC05'] as const;

export function selectSmokeCases(kb = KB): { cases: BenchmarkCase[]; hardCases: HardCase[] } {
  const wanted = new Set<string>(SMOKE_CASE_IDS);
  return {
    cases: buildBenchmarkManifest(kb).filter((c) => wanted.has(c.benchmarkCaseId)),
    hardCases: buildHardCaseManifest().filter((h) => wanted.has(h.hardCaseId)),
  };
}

/**
 * Luna generation benchmark (doc 14 C5 §19 / C5.1 §6-§9). Runs the FROZEN
 * manifest through the FULL production-like pipeline — spec → grounding →
 * provider adapter → structured output → schema → validator → deterministic
 * answer verifier → telemetry. NEVER makes a network call on its own; the
 * caller injects the `AIProviderAdapter`. A spend guardrail (§8) stops before
 * exceeding the configured batch / cost ceiling.
 */

export const BENCHMARK_VERSION = 'luna-generation-benchmark.v1';

export interface RunBenchmarkInput {
  readonly adapter: AIProviderAdapter;
  readonly cases: readonly BenchmarkCase[];
  readonly hardCases?: readonly HardCase[];
  readonly structuredOutputMode: StructuredOutputMode;
  readonly knowledgeBase?: KnowledgeBase;
  readonly referenceLibrary?: readonly ReferenceExample[];
  /** Spend guardrail (doc 14 C5.1 §8). The run stops BEFORE exceeding either. */
  readonly maxBatches: number;
  readonly maxCostUsd: number;
  readonly pricingConfigVersion?: string;
  /** Whether every local build/golden/lint/typecheck/web-build gate is green (doc 14 C5.2 §G). */
  readonly buildGatesGreen?: boolean;
  /** Whether the adversarial validator suite passed (doc 14 C5.2 §C/§G). */
  readonly adversarialTestsPassed?: boolean;
}

export interface BenchmarkReport {
  readonly benchmarkVersion: string;
  readonly manifestVersion: string;
  readonly timestamp: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string | null;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly structuredOutputModeRequested: StructuredOutputMode;
  readonly structuredOutputModeUsed: string | null;
  readonly pricingConfigVersion: string | null;
  readonly caseCount: number;
  readonly questionCount: number;
  readonly stoppedEarly: boolean;
  readonly stopReason: string | null;
  readonly hardCaseCount: number;
  readonly baseCaseCount: number;
  readonly quality: {
    readonly schemaSuccessRate: number;
    readonly firstPassValidatorRate: number;
    readonly finalDeliverableRate: number;
    readonly quarantineRate: number;
    readonly regenerationRate: number;
    /** @deprecated see exact/near */
    readonly referenceCopyRate: number;
    readonly exactReferenceCopyRate: number;
    readonly nearReferenceCopyRate: number;
    readonly skillAdherenceRate: number;
    readonly roleAdherenceRate: number;
    readonly kAdherenceRate: number;
    readonly tAdherenceRate: number;
  };
  readonly answers: {
    readonly formatValidRate: number;
    readonly deterministicCorrectnessVerifiedRate: number;
    readonly crosscheckRequiredRate: number;
    readonly unverifiedRate: number;
  };
  readonly performance: { readonly avgLatencyMs: number; readonly p50LatencyMs: number; readonly p95LatencyMs: number };
  readonly usage: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number };
  readonly cost: {
    readonly actualCostUsd: number;
    readonly actualCostVnd: number;
    readonly costPerBatchVnd: number;
    readonly costPerQuestionVnd: number;
  };
  readonly failures: Readonly<Record<string, number>>;
  readonly perCase: readonly { benchmarkCaseId: string; label: string; status: string; reason?: string }[];
  readonly coverage: CoverageMatrix;
  readonly readiness: BenchmarkReadiness;
  readonly gates: readonly { name: string; label: string; pass: boolean; value: number }[];
}

export async function runLunaBenchmark(input: RunBenchmarkInput): Promise<{ report: BenchmarkReport; records: ShadowMetricRecord[] }> {
  const kb = input.knowledgeBase ?? KB;
  const lib = input.referenceLibrary ?? loadReferenceLibrary();
  const generator = createLunaExerciseGenerator({ adapter: input.adapter, structuredOutputMode: input.structuredOutputMode });
  const records: ShadowMetricRecord[] = [];
  const perCase: BenchmarkReport['perCase'][number][] = [];

  const hardCases = input.hardCases ?? [];
  const allCases: { benchmarkCaseId: string; label: string; spec: BenchmarkCase['spec'] }[] = [
    ...input.cases,
    ...hardCases.map((h) => ({ benchmarkCaseId: h.hardCaseId, label: h.label, spec: h.spec })),
  ];

  let cumulativeUsd = 0;
  let stoppedEarly = false;
  let stopReason: string | null = null;
  let structuredOutputModeUsed: string | null = null;

  for (const c of allCases) {
    if (records.length >= input.maxBatches) {
      stoppedEarly = true;
      stopReason = `reached maxBatches=${input.maxBatches}`;
      break;
    }
    if (cumulativeUsd >= input.maxCostUsd) {
      stoppedEarly = true;
      stopReason = `reached maxCostUsd=${input.maxCostUsd} (spent ${cumulativeUsd.toFixed(4)})`;
      break;
    }

    const result = await orchestrateGeneration({ spec: c.spec, generator, referenceLibrary: lib, knowledgeBase: kb });
    for (const opRow of result.trace.operations) {
      cumulativeUsd += opRow.actualCostUsd ?? 0;
      if (opRow.structuredOutputMode) structuredOutputModeUsed = opRow.structuredOutputMode;
    }
    records.push({
      spec: c.spec,
      result,
      answerVerification: result.status === 'delivered' ? summarizeAnswerVerification(result.batch) : null,
    });
    perCase.push({
      benchmarkCaseId: c.benchmarkCaseId,
      label: c.label,
      status: result.status,
      ...(result.status === 'failed' ? { reason: result.reason } : {}),
    });
  }

  const m = aggregateShadowMetrics(records);

  // coverage matrix over ALL cases (base + hard), probed for answer coverage on
  // whatever batches were actually produced (mock or live).
  const coverageCases: CoverageCase[] = [
    ...input.cases.map((c) => ({ id: c.benchmarkCaseId, kind: 'base' as const, spec: c.spec })),
    ...hardCases.map((h) => ({ id: h.hardCaseId, kind: 'hardcase' as const, spec: h.spec })),
  ];
  const producedBatches = records.filter((r) => r.result.status === 'delivered').map((r) => (r.result.status === 'delivered' ? r.result.batch : null)).filter((b): b is NonNullable<typeof b> => b !== null);
  const coverage = probeAnswerCoverage(computeCoverageMatrix(coverageCases), producedBatches);

  // HC05→HC06: the SAME Grade-9 candidate (SYMMETRIC) is rejected on the bridge, then
  // (after the bridge is mastered) is a selected FRONTIER target (doc 14 C5.2 §1).
  const G9 = 'M7.ALG.SYMMETRIC';
  const hc05 = hardCases.find((h) => h.hardCaseId === 'HC05')?.pipeline;
  const hc06 = hardCases.find((h) => h.hardCaseId === 'HC06')?.pipeline;
  const frontierProgressionProven =
    !!hc05 &&
    !!hc06 &&
    algebraicFrontierTrace(hc05).rejected.some((r) => r.skillId === G9 && /IDENTITY/.test(r.reason)) &&
    !algebraicFrontierTrace(hc06).rejected.some((r) => r.skillId === G9) &&
    algebraicFrontierTrace(hc06).selected.includes(G9);

  const readiness = assessBenchmarkReadiness({
    matrix: coverage,
    adversarialTestsPassed: input.adversarialTestsPassed ?? false,
    buildGatesGreen: input.buildGatesGreen ?? false,
    frontierProgressionProven,
  });

  const questionCount = records
    .filter((r) => r.result.status === 'delivered')
    .reduce((s, r) => s + r.spec.generationPlan.totalQuestions, 0);
  const totalUsd = records
    .flatMap((r) => r.result.trace.operations)
    .reduce((s, opRow) => s + (opRow.actualCostUsd ?? 0), 0);
  const totalVnd = records
    .flatMap((r) => r.result.trace.operations)
    .reduce((s, opRow) => s + (opRow.actualCostVnd ?? 0), 0);
  const cachedTokens = records
    .flatMap((r) => r.result.trace.operations)
    .reduce((s, opRow) => s + (opRow.cachedInputTokens ?? 0), 0);

  const report: BenchmarkReport = {
    benchmarkVersion: BENCHMARK_VERSION,
    manifestVersion: BENCHMARK_MANIFEST_VERSION,
    timestamp: new Date().toISOString(),
    provider: input.adapter.provider,
    model: input.adapter.model,
    modelVersion: generator.modelVersion,
    promptVersion: EXERCISE_GENERATOR_PROMPT_VERSION,
    outputSchemaVersion: GENERATED_BATCH_JSON_SCHEMA_VERSION,
    structuredOutputModeRequested: input.structuredOutputMode,
    structuredOutputModeUsed,
    pricingConfigVersion: input.pricingConfigVersion ?? null,
    caseCount: records.length,
    hardCaseCount: hardCases.length,
    baseCaseCount: input.cases.length,
    questionCount,
    stoppedEarly,
    stopReason,
    quality: {
      schemaSuccessRate: m.firstPassSchemaRate,
      firstPassValidatorRate: m.firstPassValidatorPassRate,
      finalDeliverableRate: m.finalDeliverableRate,
      quarantineRate: m.quarantineRate,
      regenerationRate: m.regenerationRate,
      referenceCopyRate: m.referenceCopyRate,
      exactReferenceCopyRate: m.exactReferenceCopyRate,
      nearReferenceCopyRate: m.nearReferenceCopyRate,
      skillAdherenceRate: m.skillAdherenceRate,
      roleAdherenceRate: m.bucketAdherenceRate,
      kAdherenceRate: m.kAdherenceRate,
      tAdherenceRate: m.tAdherenceRate,
    },
    answers: {
      formatValidRate: m.answerFormatValidRate,
      deterministicCorrectnessVerifiedRate: m.answerDeterministicCorrectnessVerifiedRate,
      crosscheckRequiredRate: m.answerCrosscheckRequiredRate,
      unverifiedRate: m.answerUnverifiedRate,
    },
    performance: { avgLatencyMs: m.averageLatencyMs, p50LatencyMs: m.p50LatencyMs, p95LatencyMs: m.p95LatencyMs },
    usage: {
      inputTokens: Math.round(m.averageInputTokens * Math.max(records.length, 1)),
      cachedInputTokens: cachedTokens,
      outputTokens: Math.round(m.averageOutputTokens * Math.max(records.length, 1)),
    },
    cost: {
      actualCostUsd: totalUsd,
      actualCostVnd: totalVnd,
      costPerBatchVnd: records.length > 0 ? totalVnd / records.length : 0,
      costPerQuestionVnd: questionCount > 0 ? totalVnd / questionCount : 0,
    },
    failures: m.failuresByReasonCode,
    perCase,
    coverage,
    readiness,
    gates: evaluateGates(m),
  };
  return { report, records };
}

/** Provisional benchmark review gates (doc 14 C5 §18 / C5.1 §1). NOT an auto-flip. */
export function evaluateGates(m: ShadowMetrics): { name: string; label: string; pass: boolean; value: number }[] {
  const g = (name: string, value: number, pass: boolean, label: string) => ({ name, label, pass, value });
  return [
    g('schemaSuccessRate', m.firstPassSchemaRate, m.firstPassSchemaRate >= 0.99, 'schema success >= 99%'),
    g('noInventedSkillIdRate', m.noInventedSkillIdRate, m.noInventedSkillIdRate >= 1, 'no invented production skill ids = 100%'),
    g('noForbiddenKnowledgeRate', m.noForbiddenKnowledgeRate, m.noForbiddenKnowledgeRate >= 1, 'no forbidden required knowledge = 100%'),
    g('exactReferenceCopyRate', m.exactReferenceCopyRate, m.exactReferenceCopyRate === 0, 'exact reference-example copy = 0 (HARD GATE)'),
    g('nearReferenceCopyRate', m.nearReferenceCopyRate, m.nearReferenceCopyRate <= 0.01, 'near (number/casing-only) reference copy <= 1%'),
    g('finalDeliverableRate', m.finalDeliverableRate, m.finalDeliverableRate >= 0.95, 'final deliverable >= 95%'),
    // C5.1 §1: this gate is now CORRECTNESS, not format. A well-formed key is not enough.
    g('answerFormatValidRate', m.answerFormatValidRate, m.answerFormatValidRate >= 0.99, 'answer key well-formed >= 99%'),
    g('answerNoProvenWrong', 1 - m.answerUnverifiedRate, m.answerUnverifiedRate <= 0.0, 'no answer proven WRONG by the deterministic checker'),
    g('quarantineRate', m.quarantineRate, m.quarantineRate <= 0.02, 'quarantine rate <= 2%'),
    g('averageGenerationAttempts', m.averageGenerationAttempts, m.averageGenerationAttempts <= 1.25, 'avg generation attempts <= 1.25'),
    g('kAdherenceRate', m.kAdherenceRate, m.kAdherenceRate >= 0.98, 'K adherence >= 98%'),
    g('tAdherenceRate', m.tAdherenceRate, m.tAdherenceRate >= 0.98, 'T adherence >= 98%'),
    g('roleAdherenceRate', m.bucketAdherenceRate, m.bucketAdherenceRate >= 1, 'bucket / target-role adherence = 100%'),
    g('skillAdherenceRate', m.skillAdherenceRate, m.skillAdherenceRate >= 1, 'skill adherence = 100%'),
  ];
}

export function formatBenchmarkReport(r: BenchmarkReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const rec = (o: Readonly<Record<string, number>>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(' ');
  return [
    `Luna generation benchmark ${r.benchmarkVersion} — ${r.caseCount} batches (${r.baseCaseCount} base + ${r.hardCaseCount} hard) / ${r.questionCount} questions`,
    `  manifest:      ${r.manifestVersion}`,
    `  model:         ${r.provider}/${r.model} (${r.modelVersion ?? 'no version'})`,
    `  prompt:        ${r.promptVersion}`,
    `  schema:        ${r.outputSchemaVersion}`,
    `  structured:    requested ${r.structuredOutputModeRequested} / used ${r.structuredOutputModeUsed ?? 'n/a'}`,
    `  pricing:       ${r.pricingConfigVersion ?? 'n/a'}`,
    r.stoppedEarly ? `  STOPPED EARLY: ${r.stopReason}` : '  (ran the full manifest)',
    '',
    'quality:',
    `  schema first-pass:        ${pct(r.quality.schemaSuccessRate)}`,
    `  validator first-pass:     ${pct(r.quality.firstPassValidatorRate)}`,
    `  final deliverable:        ${pct(r.quality.finalDeliverableRate)}`,
    `  quarantine / regen:       ${pct(r.quality.quarantineRate)} / ${pct(r.quality.regenerationRate)}`,
    `  reference-copy exact/near:${pct(r.quality.exactReferenceCopyRate)} / ${pct(r.quality.nearReferenceCopyRate)}`,
    `  skill / role adherence:   ${pct(r.quality.skillAdherenceRate)} / ${pct(r.quality.roleAdherenceRate)}`,
    `  K / T adherence:          ${pct(r.quality.kAdherenceRate)} / ${pct(r.quality.tAdherenceRate)}`,
    '',
    'answers (FORMAT != CORRECTNESS):',
    `  format valid:             ${pct(r.answers.formatValidRate)}`,
    `  deterministic CORRECTNESS: ${pct(r.answers.deterministicCorrectnessVerifiedRate)}`,
    `  needs crosscheck:         ${pct(r.answers.crosscheckRequiredRate)}`,
    `  unverified / proven wrong: ${pct(r.answers.unverifiedRate)}`,
    '',
    'performance / cost:',
    `  latency avg/p50/p95 ms:   ${r.performance.avgLatencyMs.toFixed(0)} / ${r.performance.p50LatencyMs} / ${r.performance.p95LatencyMs}`,
    `  tokens in/cached/out:     ${r.usage.inputTokens} / ${r.usage.cachedInputTokens} / ${r.usage.outputTokens}`,
    `  actual cost USD / VND:    ${r.cost.actualCostUsd.toFixed(4)} / ${r.cost.actualCostVnd.toFixed(0)}`,
    `  cost VND per batch / q:   ${r.cost.costPerBatchVnd.toFixed(0)} / ${r.cost.costPerQuestionVnd.toFixed(1)}`,
    `  failures:                 ${JSON.stringify(r.failures)}`,
    '',
    'coverage matrix (base + hard cases):',
    `  grade:           ${rec(r.coverage.grade)}`,
    `  target role:     ${rec(r.coverage.targetRole)}`,
    `  knowledge:       ${rec(r.coverage.knowledgeLevel)}`,
    `  thinking:        ${rec(r.coverage.thinkingLevel)}`,
    `  context conf:    ${rec(r.coverage.contextConfidence)}`,
    `  parent goal:     ${rec(r.coverage.parentGoal)}`,
    `  parallel gap repair: ${r.coverage.parallelGapRepair}   above-grade frontier: ${r.coverage.aboveGradeFrontier}   grade-level T4/T5: ${r.coverage.gradeLevelT4T5}`,
    `  answer format:   ${rec(r.coverage.answerFormatType)}`,
    `  answer verification: ${rec(r.coverage.answerVerificationLevel)}`,
    r.coverage.uncovered.length > 0 ? `  UNCOVERED: ${r.coverage.uncovered.join(' | ')}` : '  UNCOVERED: none',
    '',
    `benchmarkReady: ${r.readiness.benchmarkReady}`,
    `  base / hard / total cases: ${r.readiness.baseCaseCount} / ${r.readiness.hardCaseCount} / ${r.readiness.totalCaseCount}`,
    r.readiness.blockingCoverageGaps.length > 0 ? `  blocking gaps: ${r.readiness.blockingCoverageGaps.join(' | ')}` : '  blocking gaps: none',
    r.readiness.nonBlockingCoverageGaps.length > 0 ? `  non-blocking gaps: ${r.readiness.nonBlockingCoverageGaps.join(' | ')}` : '  non-blocking gaps: none',
    '',
    'gates (provisional — human review, never an auto-flip):',
    ...r.gates.map((x) => `  [${x.pass ? 'PASS' : 'FAIL'}] ${x.label} = ${x.value.toFixed(3)}`),
  ].join('\n');
}
