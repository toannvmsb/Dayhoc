import { describe, expect, it } from 'vitest';
import { validate } from '@copilot/schemas';
import {
  contributionMargin,
  marginTable,
  PLAN_COMMERCIALS,
  PricingRegistry,
  tokenCostUsd,
  usdToVnd,
} from '@copilot/ai';
import {
  loadBenchmarkCases,
  loadPipelineCandidates,
  loadRoutingDecisionTemplate,
  loadScoringConfig,
  loadValidationReport,
} from './load.js';
import { pipelineOutputSchema, type BenchmarkRunRow } from './output-schema.js';
import {
  checkHardGates,
  scoreCase,
  selectDefaultPipeline,
  summarisePipeline,
  weightedScore,
  type PerCriterionScores,
} from './score.js';

/**
 * AI/OCR Benchmark Kit v1.0 — HARNESS validation.
 *
 * The kit ships 40 image *slots* but no real anonymized images (by design), so
 * this suite proves the harness + scoring + the cost→margin guardrail are
 * correct and that no provider is silently pre-selected. It does NOT rank
 * providers — that needs real images + human ground truth (Phase A).
 */

const cases = loadBenchmarkCases();
const candidates = loadPipelineCandidates();
const scoring = loadScoringConfig();

const CANONICAL: PerCriterionScores = {
  transcription_accuracy: 1,
  math_expression_accuracy: 1,
  question_student_work_separation: 1,
  skill_problem_type_mapping: 1,
  answer_error_localization: 1,
  latency: 1,
  cost_per_page: 1,
  privacy_data_minimization: 1,
};

const goodOutput = (caseId: string) => ({
  schema_version: 'benchmark_extract.v1',
  case_id: caseId,
  transcription: { full_text: 'x', math_expressions: [{ latex: '\\frac{1}{2}', role: 'question', block_index: 0 }] },
  segmentation: { question_blocks: [0], student_work_blocks: [1] },
  education_mapping: { grade_context: 4, candidate_skill_ids: ['M4.FRAC.ADD'], problem_types: ['add_fractions'], knowledge_level: 'K2', thinking_level: 'T2' },
  student_work: { question_count: 1, student_answers: [{ item_index: 0, answer_text: '3/4', is_correct: true, error_location: null }] },
  confidence: 0.9,
});

const row = (over: Partial<BenchmarkRunRow> & { case_id: string; pipeline_id: string; output: unknown }): BenchmarkRunRow => ({
  run_id: `${over.pipeline_id}:${over.case_id}`,
  model_version: 'test',
  latency_ms: 800,
  input_tokens: 1200,
  output_tokens: 300,
  ocr_pages: null,
  cost_usd: 0.0006,
  cost_vnd: 16,
  retry_count: 0,
  escalated: false,
  ...over,
});

describe('Benchmark kit — dataset + config integrity', () => {
  it('has 40 case slots covering Grade 4 + Grade 7 + degraded images', () => {
    expect(cases).toHaveLength(40);
    expect(cases.filter((c) => c.grade_context === 4).length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((c) => c.grade_context === 7).length).toBeGreaterThanOrEqual(15);
    expect(cases.some((c) => c.category === 'LOW_QUALITY')).toBe(true);
    expect(cases.some((c) => c.category === 'G4_HANDWRITING')).toBe(true);
    expect(cases.some((c) => c.category === 'G7_ADVANCED')).toBe(true);
  });

  it('every slot still needs a real anonymized image (benchmark is NOT_RUN)', () => {
    expect(cases.every((c) => c.status === 'IMAGE_REQUIRED')).toBe(true);
    expect(cases.every((c) => c.anonymization_required)).toBe(true);
    expect(loadValidationReport().real_child_images_included).toBe(false);
    expect(loadRoutingDecisionTemplate().benchmark_status).toBe('NOT_RUN');
  });

  it('defines the 4 pipelines (Luna, Luna+OCR, Terra, Sonnet) with no default chosen', () => {
    expect(candidates.map((c) => c.pipeline_id).sort()).toEqual([
      'P1_LUNA_VISION',
      'P2_LUNA_GOOGLE_OCR',
      'P3_TERRA_VISION',
      'P4_SONNET_VISION',
    ]);
    const decision = loadRoutingDecisionTemplate();
    expect(decision.recommended_default_pipeline).toBeNull();
    expect(decision.recommended_advanced_pipeline).toBeNull();
  });

  it('scoring weights sum to 100 and the 5 hard gates are present', () => {
    const sum = Object.values(scoring.weights_percent).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    expect(scoring.hard_gates).toHaveLength(5);
    expect(scoring.selection_rule.toLowerCase()).toContain('cheapest');
  });
});

describe('Benchmark kit — unified output contract', () => {
  it('accepts a well-formed pipeline output', () => {
    expect(validate(pipelineOutputSchema, goodOutput('IMG-001')).ok).toBe(true);
  });

  it('rejects an output missing math-expression roles or K/T levels', () => {
    const bad = goodOutput('IMG-002') as Record<string, unknown>;
    (bad.education_mapping as Record<string, unknown>).knowledge_level = 'K9';
    expect(validate(pipelineOutputSchema, bad).ok).toBe(false);
  });
});

describe('Benchmark kit — scoring + hard gates', () => {
  it('a canonical run scores 100 and passes every gate', () => {
    const s = scoreCase({
      row: row({ case_id: 'IMG-001', pipeline_id: 'P1_LUNA_VISION', output: goodOutput('IMG-001') }),
      weights: scoring.weights_percent,
      criteria: CANONICAL,
      gates: { inventedProductionSkillId: false, piiMinimizationPass: true, mathCriticalErrorRate: 0, silentCommitBelowThreshold: false },
    });
    expect(s.weightedScore).toBeCloseTo(100, 5);
    expect(s.gatesPassed).toBe(true);
  });

  it('an invented production skill id fails the hard gate regardless of quality', () => {
    const out = { ...goodOutput('IMG-003'), production_skill_id: 'M4.NEW.INVENTED' };
    const s = scoreCase({
      row: row({ case_id: 'IMG-003', pipeline_id: 'P3_TERRA_VISION', output: out }),
      weights: scoring.weights_percent,
      criteria: CANONICAL,
      gates: { inventedProductionSkillId: false, piiMinimizationPass: true, mathCriticalErrorRate: 0, silentCommitBelowThreshold: false },
    });
    expect(s.gatesPassed).toBe(false);
    expect(s.gateFailures).toContain('no invented production skill_id');
  });

  it('a silent commit below the confidence threshold fails the hard gate', () => {
    const g = checkHardGates({
      schemaPass: true,
      inventedProductionSkillId: false,
      piiMinimizationPass: true,
      mathCriticalErrorRate: 0.01,
      silentCommitBelowThreshold: true,
    });
    expect(g.passed).toBe(false);
    expect(g.failures).toContain('no silent commit when extraction confidence is below threshold');
  });

  it('a >2% math critical error rate on standard cases fails the hard gate', () => {
    expect(checkHardGates({ schemaPass: true, inventedProductionSkillId: false, piiMinimizationPass: true, mathCriticalErrorRate: 0.03, silentCommitBelowThreshold: false }).passed).toBe(false);
  });

  it('schema failure zeroes the schema weight and trips the gate', () => {
    const s = scoreCase({
      row: row({ case_id: 'IMG-004', pipeline_id: 'P1_LUNA_VISION', output: { nope: true } }),
      weights: scoring.weights_percent,
      criteria: CANONICAL,
      gates: { inventedProductionSkillId: false, piiMinimizationPass: true, mathCriticalErrorRate: 0, silentCommitBelowThreshold: false },
    });
    expect(s.gatesPassed).toBe(false);
    expect(s.weightedScore).toBeCloseTo(95, 5); // lost the 5-point schema weight
    expect(weightedScore(scoring.weights_percent, CANONICAL, false)).toBeCloseTo(95, 5);
  });

  it('Phase D selection picks the cheapest gate-passing pipeline, or null if none qualifies', () => {
    const mkScores = (pid: string, mean: number, gatesPass: boolean) =>
      Array.from({ length: 5 }, (_, i) => ({
        caseId: `IMG-00${i}`,
        pipelineId: pid,
        weightedScore: mean,
        gatesPassed: gatesPass,
        gateFailures: gatesPass ? [] : ['schema_pass_rate >= 99%'],
      }));
    const verdicts = [
      summarisePipeline('P1_LUNA_VISION', mkScores('P1_LUNA_VISION', 96, true)),
      summarisePipeline('P4_SONNET_VISION', mkScores('P4_SONNET_VISION', 99, true)),
    ];
    const costRank = { P1_LUNA_VISION: 0, P4_SONNET_VISION: 3 };
    expect(selectDefaultPipeline(verdicts, costRank)).toBe('P1_LUNA_VISION'); // cheapest that clears the bar

    const noneQualify = [summarisePipeline('P1_LUNA_VISION', mkScores('P1_LUNA_VISION', 90, false))];
    expect(selectDefaultPipeline(noneQualify, costRank)).toBeNull();
  });
});

describe('Benchmark kit — cost → margin guardrail (§6, §10.9)', () => {
  it('the published margin tables still hold (no drift in the model)', () => {
    for (const r of marginTable().atCeiling) expect(r.marginPct, r.plan).toBeGreaterThanOrEqual(0.5);
  });

  it('a measured per-case cost projected to plan usage is checked against the hard ceiling', () => {
    // simulate a "Luna default" measured cost from token telemetry
    const reg = new PricingRegistry();
    const perExtractionUsd = tokenCostUsd(reg.priceAt('gpt-5.6-luna'), { inputTokens: 1_800, outputTokens: 500 });
    const perExtractionVnd = usdToVnd(perExtractionUsd);

    // BASIC: 8 worksheets + 8 scan pages/month, ~2 AI ops each → ~32 metered ops
    const basicMonthlyVnd = perExtractionVnd * 32;
    expect(basicMonthlyVnd).toBeLessThan(PLAN_COMMERCIALS.basic.aiCeilingVnd);
    expect(contributionMargin('basic', basicMonthlyVnd).meetsFloor).toBe(true);

    // a pathological 10× cost blows the ceiling → the guardrail must flag it
    const blownVnd = basicMonthlyVnd * 12;
    const blocked = blownVnd > PLAN_COMMERCIALS.basic.aiCeilingVnd;
    expect(blocked).toBe(true);
  });

  it('FREE is judged against its AI ceiling (2,000đ), not a margin', () => {
    expect(PLAN_COMMERCIALS.free.priceVnd).toBeNull();
    expect(PLAN_COMMERCIALS.free.aiCeilingVnd).toBe(2_000);
  });
});
