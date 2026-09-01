import type { ExerciseGenerationSpec, ParentGoal } from '@copilot/domain';
import { buildExerciseGenerationSpec } from '@copilot/planning';
import type { KnowledgeBase } from '@copilot/math-data';
import { KB } from '../harness.js';
import { loadLearningEvidenceEvents, loadTwinPlannerProfiles } from '../golden/load.js';
import { runTwinPlanner, TP_AS_OF } from '../golden/twin-planner-pipeline.js';

/**
 * FROZEN benchmark manifest (doc 14 C5.1 §7). A fixed, reproducible set of
 * SYNTHETIC cases — every spec is built from a golden twin/planner profile
 * (ids `LT-G4-*` / `LT-G7-*`, no real child data) through the REAL
 * `buildExerciseGenerationSpec` pipeline. Freeze it before any paid call so a
 * benchmark result is comparable run-to-run.
 */
export const BENCHMARK_MANIFEST_VERSION = 'luna-generation-benchmark.manifest.v1';

/** The profile ids in the manifest — first 8 grade-4 + first 8 grade-7, id order. */
export const BENCHMARK_PROFILE_IDS = [
  'LT-G4-01', 'LT-G4-02', 'LT-G4-03', 'LT-G4-04', 'LT-G4-05', 'LT-G4-06', 'LT-G4-07', 'LT-G4-08',
  'LT-G7-01', 'LT-G7-02', 'LT-G7-03', 'LT-G7-04', 'LT-G7-05', 'LT-G7-06', 'LT-G7-07', 'LT-G7-08',
] as const;

export interface BenchmarkCase {
  readonly benchmarkCaseId: string;
  readonly profileId: string;
  readonly grade: number;
  readonly parentGoal: ParentGoal;
  readonly label: string;
  readonly spec: ExerciseGenerationSpec;
}

export function buildBenchmarkManifest(kb: KnowledgeBase = KB): BenchmarkCase[] {
  const byId = new Map(loadTwinPlannerProfiles().map((p) => [p.profile_id, p]));
  const events = loadLearningEvidenceEvents();
  const cases: BenchmarkCase[] = [];
  for (const profileId of BENCHMARK_PROFILE_IDS) {
    const profile = byId.get(profileId);
    if (!profile) continue;
    const run = runTwinPlanner(profile, events);
    let i = 0;
    const spec = buildExerciseGenerationSpec({
      childId: run.childId,
      gradeContext: profile.grade_context,
      twin: run.twin,
      gaps: run.gaps,
      context: run.context,
      knowledgeBase: kb,
      parentGoal: run.parentGoal as ParentGoal,
      availableMinutes: profile.daily_time_budget_min,
      asOf: TP_AS_OF,
      newId: () => `${profileId}_${i++}`,
    });
    cases.push({
      benchmarkCaseId: `BENCH-${profileId}`,
      profileId,
      grade: profile.grade_context,
      parentGoal: run.parentGoal as ParentGoal,
      label: `G${profile.grade_context} ${run.parentGoal} ${spec.goal.sessionGoal}`,
      spec,
    });
  }
  return cases;
}

/** What the frozen manifest actually covers (doc 14 C5.1 §7) — surfaced in the report. */
export interface ManifestCoverage {
  readonly caseCount: number;
  readonly grades: readonly number[];
  readonly sessionGoals: readonly string[];
  readonly parentGoals: readonly string[];
  readonly withPrerequisiteRepair: number;
  readonly withFrontier: number;
  readonly withThinkingChallenge: number;
  readonly withReasoningPossible: number;
  readonly kRange: { min: string; max: string };
  readonly tRange: { min: string; max: string };
  readonly gaps: readonly string[];
}

export function manifestCoverage(cases: readonly BenchmarkCase[]): ManifestCoverage {
  const grades = new Set<number>();
  const sessionGoals = new Set<string>();
  const parentGoals = new Set<string>();
  let repair = 0;
  let frontier = 0;
  let thinking = 0;
  let reasoning = 0;
  let kMin = 'K5';
  let kMax = 'K0';
  let tMin = 'T5';
  let tMax = 'T1';
  for (const c of cases) {
    grades.add(c.grade);
    sessionGoals.add(c.spec.goal.sessionGoal);
    parentGoals.add(c.spec.goal.parentGoal);
    const d = c.spec.generationPlan.distribution;
    if (d.prerequisiteRepair > 0) repair += 1;
    if (d.advanced > 0) frontier += 1;
    if (d.thinkingChallenge > 0) thinking += 1;
    if (c.spec.difficulty.tMax === 'T4' || c.spec.difficulty.tMax === 'T5') reasoning += 1;
    if (c.spec.difficulty.kMin < kMin) kMin = c.spec.difficulty.kMin;
    if (c.spec.difficulty.kMax > kMax) kMax = c.spec.difficulty.kMax;
    if (c.spec.difficulty.tMin < tMin) tMin = c.spec.difficulty.tMin;
    if (c.spec.difficulty.tMax > tMax) tMax = c.spec.difficulty.tMax;
  }
  const gaps: string[] = [];
  if (frontier === 0) gaps.push('no real above-grade FRONTIER case (golden twin/planner dataset has no strong above-grade learner profiles)');
  if (tMax < 'T4') gaps.push('no T4/T5 case (golden profiles top out at grade-level T3)');
  if (thinking < 2) gaps.push('few Thinking-Challenge cases');
  return {
    caseCount: cases.length,
    grades: [...grades].sort((a, b) => a - b),
    sessionGoals: [...sessionGoals].sort(),
    parentGoals: [...parentGoals].sort(),
    withPrerequisiteRepair: repair,
    withFrontier: frontier,
    withThinkingChallenge: thinking,
    withReasoningPossible: reasoning,
    kRange: { min: kMin, max: kMax },
    tRange: { min: tMin, max: tMax },
    gaps,
  };
}
