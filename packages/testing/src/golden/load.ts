import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'golden-data');

function jsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export interface GoldenQuestion {
  readonly case_id: string;
  readonly grade_context: 4 | 7;
  readonly curriculum_origin: string;
  readonly skill_id: string;
  readonly problem_type: string;
  readonly knowledge_level: string;
  readonly thinking_level: string;
  readonly prompt: string;
  readonly expected_answer: string;
  readonly expected_error_diagnosis: readonly string[];
}

export interface GoldenErrorCase {
  readonly error_case_id: string;
  readonly question_case_id: string;
  readonly grade_context: 4 | 7;
  readonly skill_id: string;
  readonly problem_type: string;
  readonly knowledge_level: string;
  readonly thinking_level: string;
  readonly student_wrong_response_pattern: string;
  readonly error_signature: string;
  readonly expected_gap_type: string;
  readonly root_cause_class: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly mastery_update_expectation: string;
}

export interface CuratedScenario {
  readonly scenario_id: string;
  readonly name: string;
  readonly input: string;
  readonly expected: readonly string[];
}

export const loadGoldenQuestions = (): GoldenQuestion[] =>
  jsonl<GoldenQuestion>(join(DATA, 'test', 'golden_questions.jsonl'));

export const loadGoldenErrors = (): GoldenErrorCase[] =>
  jsonl<GoldenErrorCase>(join(DATA, 'error', 'golden_errors.jsonl'));

export const loadCuratedScenarios = (): CuratedScenario[] => {
  const doc = YAML.parse(readFileSync(join(DATA, 'error', 'curated_error_scenarios.yaml'), 'utf8')) as {
    scenarios: CuratedScenario[];
  };
  return doc.scenarios;
};

export interface GoldenProfile {
  readonly profile_id: string;
  readonly grade_context: 4 | 7;
  readonly name: string;
  readonly evidence: readonly string[];
  readonly expected: readonly string[];
}

export const loadGoldenProfiles = (): GoldenProfile[] => {
  const doc = YAML.parse(readFileSync(join(DATA, 'test', 'golden_student_profiles.yaml'), 'utf8')) as {
    profiles: GoldenProfile[];
  };
  return doc.profiles;
};
