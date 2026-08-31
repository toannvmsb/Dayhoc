import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'benchmark-data');

export interface BenchmarkCase {
  readonly case_id: string;
  readonly category:
    | 'G4_PRINTED'
    | 'G4_HANDWRITING'
    | 'G4_FRACTION'
    | 'G4_GEOMETRY'
    | 'G7_RATIONAL'
    | 'G7_EQUATION'
    | 'G7_GEOMETRY'
    | 'G7_ADVANCED'
    | 'LOW_QUALITY';
  readonly description: string;
  readonly grade_context: 4 | 7;
  readonly content_type: string;
  readonly image_file: string;
  readonly status: 'IMAGE_REQUIRED' | 'READY';
  readonly contains_pii: boolean;
  readonly anonymization_required: boolean;
  readonly expected_ground_truth_file: string;
  readonly notes: string;
}

export interface PipelineCandidate {
  readonly pipeline_id: 'P1_LUNA_VISION' | 'P2_LUNA_GOOGLE_OCR' | 'P3_TERRA_VISION' | 'P4_SONNET_VISION';
  readonly vision: string;
  readonly ocr: string | null;
  readonly reasoning: string;
  readonly role: string;
}

export interface ScoringConfig {
  readonly weights_percent: Readonly<Record<string, number>>;
  readonly hard_gates: readonly string[];
  readonly selection_rule: string;
}

export interface RoutingDecisionDoc {
  readonly benchmark_status: string;
  readonly recommended_default_pipeline: string | null;
  readonly recommended_ocr_fallback: string | null;
  readonly recommended_advanced_pipeline: string | null;
  readonly routing_thresholds: {
    readonly vision_confidence_escalate_below: number | null;
    readonly ocr_fallback_categories: readonly string[];
    readonly advanced_categories: readonly string[];
  };
  readonly measured_costs: Readonly<Record<string, unknown>>;
  readonly financial_check: Readonly<Record<string, unknown>>;
}

function jsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export const loadBenchmarkCases = (): BenchmarkCase[] =>
  jsonl<BenchmarkCase>(join(DATA, 'dataset_manifest', 'benchmark_cases.jsonl'));

export const loadPipelineCandidates = (): PipelineCandidate[] => {
  const doc = YAML.parse(readFileSync(join(DATA, 'protocol', 'provider_candidates.yaml'), 'utf8')) as {
    benchmark_candidates: PipelineCandidate[];
  };
  return doc.benchmark_candidates;
};

export const loadScoringConfig = (): ScoringConfig =>
  YAML.parse(readFileSync(join(DATA, 'protocol', 'scoring_and_gates.yaml'), 'utf8')) as ScoringConfig;

export const loadRoutingDecisionTemplate = (): RoutingDecisionDoc =>
  JSON.parse(readFileSync(join(DATA, 'reports', 'FINAL_ROUTING_DECISION_TEMPLATE.json'), 'utf8')) as RoutingDecisionDoc;

export const loadValidationReport = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DATA, 'VALIDATION_REPORT.json'), 'utf8')) as Record<string, unknown>;
