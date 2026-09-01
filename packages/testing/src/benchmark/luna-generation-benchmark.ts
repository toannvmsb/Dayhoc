import type { ExerciseGenerationSpec, ParentGoal } from '@copilot/domain';
import { buildExerciseGenerationSpec } from '@copilot/planning';
import { loadReferenceLibrary, type ReferenceExample } from '@copilot/reference-library';
import type { KnowledgeBase } from '@copilot/math-data';
import type { AIProviderAdapter } from '@copilot/ai';
import {
  aggregateShadowMetrics,
  createLunaExerciseGenerator,
  orchestrateGeneration,
  summarizeAnswerVerification,
  type ShadowMetricRecord,
  type ShadowMetrics,
} from '@copilot/exercise-gen';
import { KB } from '../harness.js';
import { loadLearningEvidenceEvents, loadTwinPlannerProfiles } from '../golden/load.js';
import { runTwinPlanner, TP_AS_OF } from '../golden/twin-planner-pipeline.js';

/**
 * Luna generation benchmark (doc 14 C5 §19/§25 B). Builds real
 * `ExerciseGenerationSpec`s from the 48 SYNTHETIC golden twin/planner profiles
 * (no real child data — profile ids like `LT-G4-01`) and runs them through the
 * live pipeline. NEVER makes a network call on its own — the caller injects the
 * `AIProviderAdapter`; the guarded test only builds a live one when
 * `RUN_LIVE_AI_BENCHMARK=1` and a key is present.
 */

export interface BenchmarkCase {
  readonly id: string;
  readonly label: string;
  readonly spec: ExerciseGenerationSpec;
}

/** A spread across grades / goals / difficulty that covers doc 14 C5 §19's case mix. */
export function buildBenchmarkSpecs(kb: KnowledgeBase = KB, limit = 12): BenchmarkCase[] {
  const profiles = loadTwinPlannerProfiles();
  const events = loadLearningEvidenceEvents();
  const cases: BenchmarkCase[] = [];
  for (const p of profiles) {
    if (cases.length >= limit) break;
    const run = runTwinPlanner(p, events);
    let i = 0;
    const spec = buildExerciseGenerationSpec({
      childId: run.childId,
      gradeContext: run.profile.grade_context,
      twin: run.twin,
      gaps: run.gaps,
      context: run.context,
      knowledgeBase: kb,
      parentGoal: run.parentGoal as ParentGoal,
      availableMinutes: run.profile.daily_time_budget_min,
      asOf: TP_AS_OF,
      newId: () => `${p.profile_id}_${i++}`,
    });
    cases.push({ id: p.profile_id, label: `G${run.profile.grade_context} ${run.parentGoal}`, spec });
  }
  return cases;
}

export interface BenchmarkResult {
  readonly cases: number;
  readonly records: readonly ShadowMetricRecord[];
  readonly metrics: ShadowMetrics;
  readonly perCase: readonly { id: string; label: string; status: string; reason?: string }[];
}

export async function runLunaBenchmark(input: {
  adapter: AIProviderAdapter;
  specs: readonly BenchmarkCase[];
  knowledgeBase?: KnowledgeBase;
  referenceLibrary?: readonly ReferenceExample[];
}): Promise<BenchmarkResult> {
  const kb = input.knowledgeBase ?? KB;
  const lib = input.referenceLibrary ?? loadReferenceLibrary();
  const generator = createLunaExerciseGenerator({ adapter: input.adapter });
  const records: ShadowMetricRecord[] = [];
  const perCase: { id: string; label: string; status: string; reason?: string }[] = [];

  for (const c of input.specs) {
    const result = await orchestrateGeneration({ spec: c.spec, generator, referenceLibrary: lib, knowledgeBase: kb });
    records.push({
      spec: c.spec,
      result,
      answerVerification: result.status === 'delivered' ? summarizeAnswerVerification(result.batch) : null,
    });
    perCase.push({
      id: c.id,
      label: c.label,
      status: result.status,
      ...(result.status === 'failed' ? { reason: result.reason } : {}),
    });
  }

  return { cases: input.specs.length, records, metrics: aggregateShadowMetrics(records), perCase };
}

/** Provisional benchmark review gates (doc 14 C5 §18). NOT auto-flips — a human reads these. */
export const C5_SHADOW_GATES = {
  firstPassSchemaRate: { min: 0.99, label: 'schema success' },
  noInventedSkillIdRate: { min: 1.0, label: 'no invented production skill ids' },
  noForbiddenKnowledgeRate: { min: 1.0, label: 'no forbidden required knowledge delivered' },
  referenceCopyRateMax: { max: 0.01, label: 'no reference example copy' },
  finalDeliverableRate: { min: 0.95, label: 'final deliverable rate (after bounded repair)' },
  answerDeterministicVerificationRate: { min: 1.0, label: 'deterministic answer verification (numeric/fraction/choice)' },
  quarantineRateMax: { max: 0.02, label: 'quarantine rate' },
  averageGenerationAttemptsMax: { max: 1.25, label: 'average generation attempts' },
  kAdherenceRate: { min: 0.98, label: 'K adherence' },
  tAdherenceRate: { min: 0.98, label: 'T adherence' },
  bucketAdherenceRate: { min: 1.0, label: 'bucket / target-role adherence' },
  skillAdherenceRate: { min: 1.0, label: 'skill adherence' },
} as const;

export function evaluateGates(m: ShadowMetrics): { name: string; label: string; pass: boolean; value: number }[] {
  return [
    gate('firstPassSchemaRate', m.firstPassSchemaRate, m.firstPassSchemaRate >= C5_SHADOW_GATES.firstPassSchemaRate.min, C5_SHADOW_GATES.firstPassSchemaRate.label),
    gate('noInventedSkillIdRate', m.noInventedSkillIdRate, m.noInventedSkillIdRate >= 1, C5_SHADOW_GATES.noInventedSkillIdRate.label),
    gate('noForbiddenKnowledgeRate', m.noForbiddenKnowledgeRate, m.noForbiddenKnowledgeRate >= 1, C5_SHADOW_GATES.noForbiddenKnowledgeRate.label),
    gate('referenceCopyRate', m.referenceCopyRate, m.referenceCopyRate <= C5_SHADOW_GATES.referenceCopyRateMax.max, C5_SHADOW_GATES.referenceCopyRateMax.label),
    gate('finalDeliverableRate', m.finalDeliverableRate, m.finalDeliverableRate >= C5_SHADOW_GATES.finalDeliverableRate.min, C5_SHADOW_GATES.finalDeliverableRate.label),
    gate('answerDeterministicVerificationRate', m.answerDeterministicVerificationRate, m.answerDeterministicVerificationRate >= 1, C5_SHADOW_GATES.answerDeterministicVerificationRate.label),
    gate('quarantineRate', m.quarantineRate, m.quarantineRate <= C5_SHADOW_GATES.quarantineRateMax.max, C5_SHADOW_GATES.quarantineRateMax.label),
    gate('averageGenerationAttempts', m.averageGenerationAttempts, m.averageGenerationAttempts <= C5_SHADOW_GATES.averageGenerationAttemptsMax.max, C5_SHADOW_GATES.averageGenerationAttemptsMax.label),
    gate('kAdherenceRate', m.kAdherenceRate, m.kAdherenceRate >= C5_SHADOW_GATES.kAdherenceRate.min, C5_SHADOW_GATES.kAdherenceRate.label),
    gate('tAdherenceRate', m.tAdherenceRate, m.tAdherenceRate >= C5_SHADOW_GATES.tAdherenceRate.min, C5_SHADOW_GATES.tAdherenceRate.label),
    gate('bucketAdherenceRate', m.bucketAdherenceRate, m.bucketAdherenceRate >= 1, C5_SHADOW_GATES.bucketAdherenceRate.label),
    gate('skillAdherenceRate', m.skillAdherenceRate, m.skillAdherenceRate >= 1, C5_SHADOW_GATES.skillAdherenceRate.label),
  ];
}

function gate(name: string, value: number, pass: boolean, label: string) {
  return { name, label, pass, value };
}

export function formatBenchmarkReport(r: BenchmarkResult): string {
  const m = r.metrics;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `Luna generation benchmark — ${r.cases} cases`,
    `  schema first-pass:        ${pct(m.firstPassSchemaRate)}`,
    `  validator first-pass:     ${pct(m.firstPassValidatorPassRate)}`,
    `  final deliverable:        ${pct(m.finalDeliverableRate)}`,
    `  quarantine:               ${pct(m.quarantineRate)}`,
    `  avg generation attempts:  ${m.averageGenerationAttempts.toFixed(2)}`,
    `  avg repair attempts:      ${m.averageRepairAttempts.toFixed(2)}`,
    `  answer deterministic ver: ${pct(m.answerDeterministicVerificationRate)}`,
    `  answer unverified:        ${pct(m.answerUnverifiedRate)}`,
    `  skill / bucket adherence: ${pct(m.skillAdherenceRate)} / ${pct(m.bucketAdherenceRate)}`,
    `  K / T adherence:          ${pct(m.kAdherenceRate)} / ${pct(m.tAdherenceRate)}`,
    `  reference-copy rate:      ${pct(m.referenceCopyRate)}`,
    `  latency avg/p50/p95 ms:   ${m.averageLatencyMs.toFixed(0)} / ${m.p50LatencyMs} / ${m.p95LatencyMs}`,
    `  tokens avg in/out:        ${m.averageInputTokens.toFixed(0)} / ${m.averageOutputTokens.toFixed(0)}`,
    `  actual cost VND / batch:  ${m.averageActualCostVndPerBatch.toFixed(0)}`,
    `  actual cost VND / q:      ${m.averageActualCostVndPerQuestion.toFixed(1)}`,
    `  failures by reason:       ${JSON.stringify(m.failuresByReasonCode)}`,
    '',
    'Gates (provisional — human review, not an auto-flip):',
    ...evaluateGates(m).map((g) => `  [${g.pass ? 'PASS' : 'FAIL'}] ${g.label} = ${typeof g.value === 'number' ? g.value.toFixed(3) : g.value}`),
  ];
  return lines.join('\n');
}
