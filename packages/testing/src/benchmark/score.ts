import { validate } from '@copilot/schemas';
import { pipelineOutputSchema, type BenchmarkRunRow } from './output-schema.js';
import type { ScoringConfig } from './load.js';

/**
 * Weighted scoring + hard gates (scoring_and_gates.yaml).
 *
 * BENCHMARK_PROTOCOL Phase D: do NOT pick the absolute-best model — pick the
 * CHEAPEST pipeline that passes all hard gates and reaches ≥ 95/100 weighted
 * quality on standard cases. This module computes those numbers; it does not
 * make the decision (that needs real images + human ground truth).
 */

export interface PerCriterionScores {
  /** Each 0..1 — graded against human ground truth by the benchmark operator. */
  readonly transcription_accuracy: number;
  readonly math_expression_accuracy: number;
  readonly question_student_work_separation: number;
  readonly skill_problem_type_mapping: number;
  readonly answer_error_localization: number;
  readonly latency: number;
  readonly cost_per_page: number;
  readonly privacy_data_minimization: number;
}

export interface GateInputs {
  readonly schemaPass: boolean;
  readonly inventedProductionSkillId: boolean;
  readonly piiMinimizationPass: boolean;
  readonly mathCriticalErrorRate: number; // 0..1, standard cases
  readonly silentCommitBelowThreshold: boolean;
}

export interface CaseScore {
  readonly caseId: string;
  readonly pipelineId: string;
  readonly weightedScore: number; // 0..100
  readonly gatesPassed: boolean;
  readonly gateFailures: readonly string[];
}

const WEIGHT_KEYS = [
  'transcription_accuracy',
  'math_expression_accuracy',
  'question_student_work_separation',
  'skill_problem_type_mapping',
  'answer_error_localization',
  'structured_schema_pass',
  'latency',
  'cost_per_page',
  'privacy_data_minimization',
] as const;

/** Weighted quality score in 0..100. `structured_schema_pass` is scored 1/0. */
export function weightedScore(
  weights: ScoringConfig['weights_percent'],
  scores: PerCriterionScores,
  schemaPass: boolean,
): number {
  const totalW = WEIGHT_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (totalW <= 0) return 0;
  let acc = 0;
  for (const k of WEIGHT_KEYS) {
    const w = weights[k] ?? 0;
    const v = k === 'structured_schema_pass' ? (schemaPass ? 1 : 0) : (scores[k as keyof PerCriterionScores] ?? 0);
    acc += w * v;
  }
  return (acc / totalW) * 100;
}

/** Evaluate the 5 hard gates. Any failure disqualifies the pipeline for that scope. */
export function checkHardGates(g: GateInputs): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!g.schemaPass) failures.push('schema_pass_rate >= 99%');
  if (g.inventedProductionSkillId) failures.push('no invented production skill_id');
  if (!g.piiMinimizationPass) failures.push('PII minimization policy pass = 100%');
  if (g.mathCriticalErrorRate > 0.02) failures.push('math expression critical error rate <= 2% on standard cases');
  if (g.silentCommitBelowThreshold) failures.push('no silent commit when extraction confidence is below threshold');
  return { passed: failures.length === 0, failures };
}

/** Score one pipeline×case: validate the output shape, then grade + gate. */
export function scoreCase(params: {
  row: BenchmarkRunRow;
  weights: ScoringConfig['weights_percent'];
  criteria: PerCriterionScores;
  gates: Omit<GateInputs, 'schemaPass'>;
}): CaseScore {
  const parsed = validate(pipelineOutputSchema, params.row.output);
  const schemaPass = parsed.ok;
  // an output whose mapping asserts a non-candidate id is an automatic gate fail
  const invented =
    params.gates.inventedProductionSkillId ||
    (parsed.ok && 'production_skill_id' in (params.row.output as Record<string, unknown>));

  const gate = checkHardGates({ ...params.gates, schemaPass, inventedProductionSkillId: invented });
  return {
    caseId: params.row.case_id,
    pipelineId: params.row.pipeline_id,
    weightedScore: weightedScore(params.weights, params.criteria, schemaPass),
    gatesPassed: gate.passed,
    gateFailures: gate.failures,
  };
}

export interface PipelineVerdict {
  readonly pipelineId: string;
  readonly cases: number;
  readonly meanWeightedScore: number;
  readonly schemaPassRate: number;
  readonly allGatesPass: boolean;
  readonly meetsQualityBar: boolean; // mean >= 95 on standard cases
}

const STANDARD_QUALITY_BAR = 95;

export function summarisePipeline(pipelineId: string, scores: readonly CaseScore[]): PipelineVerdict {
  const mine = scores.filter((s) => s.pipelineId === pipelineId);
  const n = mine.length;
  const mean = n > 0 ? mine.reduce((s, c) => s + c.weightedScore, 0) / n : 0;
  const schemaPassRate = n > 0 ? mine.filter((c) => !c.gateFailures.includes('schema_pass_rate >= 99%')).length / n : 0;
  const allGatesPass = mine.every((c) => c.gatesPassed);
  return {
    pipelineId,
    cases: n,
    meanWeightedScore: mean,
    schemaPassRate,
    allGatesPass,
    meetsQualityBar: allGatesPass && mean >= STANDARD_QUALITY_BAR,
  };
}

/**
 * Phase D selection: cheapest pipeline that clears gates + the quality bar.
 * `costRank` is ascending (0 = cheapest). Returns null when none qualifies —
 * meaning the benchmark has not yet produced a routable default.
 */
export function selectDefaultPipeline(
  verdicts: readonly PipelineVerdict[],
  costRank: Readonly<Record<string, number>>,
): string | null {
  const eligible = verdicts.filter((v) => v.meetsQualityBar);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => (costRank[a.pipelineId] ?? 99) - (costRank[b.pipelineId] ?? 99))[0]!.pipelineId;
}
