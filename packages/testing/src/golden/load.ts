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

/* ------------------------------------------------------------------ *
 * Golden Learning Twin & Planner Dataset v1.0                         *
 * ------------------------------------------------------------------ */

export interface TwinPlannerProfile {
  readonly profile_id: string;
  readonly grade_context: 4 | 7;
  readonly archetype: string;
  readonly label: string;
  readonly history_weeks: number;
  readonly daily_time_budget_min: number;
  readonly school_context: { readonly school_grade: number; readonly exam_upcoming: boolean };
  readonly parent_goal: 'steady_school_progress' | 'advanced_and_thinking' | string;
  readonly event_ids: readonly string[];
}

export interface LearningEvidenceEvent {
  readonly event_id: string;
  readonly profile_id: string;
  readonly week: number;
  readonly type: 'attempt' | 'parent_observation';
  readonly source: string;
  readonly verified: boolean;
  readonly question_case_id: string | null;
  readonly skill_id: string;
  readonly problem_type: string | null;
  readonly knowledge_level: string;
  readonly thinking_level: string;
  readonly correct: boolean;
  readonly hint_level: number;
  readonly self_corrected: boolean;
  readonly response_time_sec: number | null;
  readonly error_signature: string | null;
  readonly gap_type: string | null;
  readonly confidence: 'verified' | 'strong' | 'supporting' | 'estimated';
}

export interface ExpectedSkillMasteryState {
  readonly skill_id: string;
  readonly mastery_score: 0 | 50 | 100;
  readonly confidence: number;
  readonly evidence_count: number;
  readonly verified_evidence_count: number;
  readonly hinted_success_count: number;
  readonly dominant_error_types: readonly (readonly [string, number])[];
}

export interface ExpectedTwinPlannerState {
  readonly profile_id: string;
  readonly expected_learning_twin: {
    readonly skill_mastery_states: readonly ExpectedSkillMasteryState[];
    readonly actual_learning_frontier_by_domain: Readonly<Record<string, string>>;
    readonly gap_state: string;
    readonly readiness: 'Ready' | 'Ready with parallel repair' | string;
    readonly evidence_confidence_rule: string;
    readonly mastery_projection_rule: string;
  };
  readonly expected_planner: {
    readonly learning_mix_percent: Readonly<Record<string, number>>;
    readonly next_best_learning_action: string;
    readonly daily_time_budget_min: number;
    readonly daily_plan: readonly { readonly order: number; readonly type: string; readonly minutes: number }[];
  };
  readonly required_invariants: readonly string[];
}

export interface CuratedPlannerScenario {
  readonly scenario_id: string;
  readonly name: string;
  readonly input: string;
  readonly expected: readonly string[];
}

const TP = join(DATA, 'twin-planner');

export const loadTwinPlannerProfiles = (): TwinPlannerProfile[] =>
  jsonl<TwinPlannerProfile>(join(TP, 'learning_twin_profiles.jsonl'));

export const loadLearningEvidenceEvents = (): LearningEvidenceEvent[] =>
  jsonl<LearningEvidenceEvent>(join(TP, 'learning_evidence_events.jsonl'));

export const loadExpectedTwinPlannerStates = (): ExpectedTwinPlannerState[] =>
  jsonl<ExpectedTwinPlannerState>(join(TP, 'expected_twin_planner_states.jsonl'));

export const loadCuratedPlannerScenarios = (): CuratedPlannerScenario[] => {
  const doc = YAML.parse(readFileSync(join(TP, 'curated_planner_scenarios.yaml'), 'utf8')) as {
    scenarios: CuratedPlannerScenario[];
  };
  return doc.scenarios;
};

/* ------------------------------------------------------------------ *
 * Golden End-to-End Family Journey Dataset v1.0                       *
 * ------------------------------------------------------------------ */

export interface E2EFamily {
  readonly family_id: string;
  readonly journey_id: string;
  readonly parent_role: string;
  readonly child_role: string;
  readonly child_profile: { readonly grade_context: 4 | 7; readonly source_twin_profile_id: string };
  readonly consent_scope: readonly string[];
  readonly child_projection_policy: string;
}

export interface E2EJourneyStep {
  readonly step_id: string;
  readonly time_unit: string;
  readonly time_value: number;
  readonly actor: 'parent' | 'system' | 'child';
  readonly surface: string;
  readonly action: string;
  readonly expected_outputs: readonly string[];
}

export interface E2EJourney {
  readonly journey_id: string;
  readonly family_id: string;
  readonly source_twin_profile_id: string;
  readonly grade_context: 4 | 7;
  readonly archetype: string;
  readonly duration_days: number;
  readonly steps: readonly E2EJourneyStep[];
}

export interface E2ECheckpoint {
  readonly journey_id: string;
  readonly checkpoints: readonly {
    readonly at: string;
    readonly expected?: readonly string[];
    readonly expected_twin?: unknown;
    readonly expected_planner?: unknown;
  }[];
}

export interface E2EFailureScenario {
  readonly failure_id: string;
  readonly trigger: string;
  readonly expected_recovery: readonly string[];
}

export interface E2EInvariants {
  readonly invariants: readonly string[];
  readonly acceptance_gates: Readonly<Record<string, string>>;
}

const E2 = join(DATA, 'e2e');

export const loadE2EFamilies = (): E2EFamily[] => jsonl<E2EFamily>(join(E2, 'families.jsonl'));

export const loadE2EJourneys = (): E2EJourney[] => jsonl<E2EJourney>(join(E2, 'family_journeys.jsonl'));

export const loadE2ECheckpoints = (): E2ECheckpoint[] =>
  jsonl<E2ECheckpoint>(join(E2, 'expected_checkpoints.jsonl'));

export const loadE2EFailureScenarios = (): E2EFailureScenario[] => {
  const doc = YAML.parse(readFileSync(join(E2, 'failure_recovery_scenarios.yaml'), 'utf8')) as {
    failures: E2EFailureScenario[];
  };
  return doc.failures;
};

export const loadE2EInvariants = (): E2EInvariants =>
  YAML.parse(readFileSync(join(E2, 'E2E_INVARIANTS.yaml'), 'utf8')) as E2EInvariants;
