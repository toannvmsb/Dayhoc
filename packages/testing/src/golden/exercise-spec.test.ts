import { describe, expect, it } from 'vitest';
import { distributionTotal, KNOWLEDGE_LEVELS, THINKING_LEVELS, type ParentGoal } from '@copilot/domain';
import { buildExerciseGenerationSpec } from '@copilot/planning';
import { exerciseGenerationSpecSchema } from '@copilot/schemas';
import { KB } from '../harness.js';
import { loadLearningEvidenceEvents, loadTwinPlannerProfiles } from './load.js';
import { runTwinPlanner, TP_AS_OF, type TwinPlannerRun } from './twin-planner-pipeline.js';

/**
 * C1 golden coverage — `buildExerciseGenerationSpec` over all 48 Twin/Planner
 * profiles. Invariant-driven (Decision P-02); no expected dataset output is
 * edited or consulted for pass/fail here.
 */
const profiles = loadTwinPlannerProfiles();
const events = loadLearningEvidenceEvents();
const runs: TwinPlannerRun[] = profiles.map((p) => runTwinPlanner(p, events));

function specFor(run: TwinPlannerRun) {
  return buildExerciseGenerationSpec({
    childId: run.childId,
    twin: run.twin,
    gaps: run.gaps,
    context: run.context,
    knowledgeBase: KB,
    parentGoal: run.parentGoal as ParentGoal,
    availableMinutes: run.profile.daily_time_budget_min,
    asOf: TP_AS_OF,
    newId: (() => {
      let i = 0;
      return () => `${run.profile.profile_id}_${i++}`;
    })(),
  });
}

describe('C1 golden — ExerciseGenerationSpec over 48 profiles', () => {
  const specs = runs.map((r) => ({ run: r, spec: specFor(r) }));

  it('every spec validates against the schema', () => {
    for (const { run, spec } of specs) {
      const parsed = exerciseGenerationSpecSchema.safeParse(spec);
      expect(parsed.success, `${run.profile.profile_id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(
        true,
      );
    }
  });

  it('distribution reconciles to totalQuestions for every profile', () => {
    for (const { spec } of specs) {
      expect(distributionTotal(spec.generationPlan.distribution)).toBe(spec.generationPlan.totalQuestions);
    }
  });

  it('never invents a skill id — all targets resolve in the production KB', () => {
    for (const { run, spec } of specs) {
      for (const id of spec.targets.skillIds) {
        expect(KB.skills.has(id), `${run.profile.profile_id} unknown skill ${id}`).toBe(true);
      }
    }
  });

  it('K/T ranges are ordered and problem types belong to a target skill', () => {
    for (const { spec } of specs) {
      expect(KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMin)).toBeLessThanOrEqual(
        KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax),
      );
      expect(THINKING_LEVELS.indexOf(spec.difficulty.tMin)).toBeLessThanOrEqual(
        THINKING_LEVELS.indexOf(spec.difficulty.tMax),
      );
      const targetSet = new Set(spec.targets.skillIds);
      for (const pt of spec.targets.problemTypeIds) {
        const owner = KB.problemTypes.find((p) => p.id === pt);
        expect(owner && targetSet.has(owner.skillId as never)).toBeTruthy();
      }
    }
  });

  it('parallel gap repair — a profile that needs repair AND is above grade keeps advanced > 0', () => {
    const parallel = specs.filter(
      ({ spec }) =>
        spec.generationPlan.distribution.prerequisiteRepair >= 1 &&
        Object.values(spec.childState.actualLearningFrontier).some((l) => /above_grade/.test(l)) &&
        spec.childState.readiness !== 'repair_first',
    );
    for (const { run, spec } of parallel) {
      expect(
        spec.generationPlan.distribution.advanced,
        `${run.profile.profile_id} collapsed advanced to 0 despite above-grade frontier`,
      ).toBeGreaterThanOrEqual(1);
      // not globally downgraded: ceiling still at least K3
      expect(KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax)).toBeGreaterThanOrEqual(KNOWLEDGE_LEVELS.indexOf('K3'));
    }
  });

  it('TEST 4 — two profiles at the same resolved lesson but different state → different specs', () => {
    const byLesson = new Map<string, { id: string; spec: ReturnType<typeof specFor> }[]>();
    for (const { run, spec } of specs) {
      const key = spec.learningContext.resolvedLessonId ?? 'none';
      const arr = byLesson.get(key) ?? [];
      arr.push({ id: run.profile.profile_id, spec });
      byLesson.set(key, arr);
    }
    const shared = [...byLesson.values()].find((arr) => arr.length >= 2 && !arr.every((x) => sameShape(x.spec, arr[0]!.spec)));
    expect(shared, 'expected at least one lesson shared by profiles with differing specs').toBeTruthy();
  });
});

function sameShape(a: ReturnType<typeof specFor>, b: ReturnType<typeof specFor>): boolean {
  return (
    JSON.stringify(a.generationPlan.distribution) === JSON.stringify(b.generationPlan.distribution) &&
    JSON.stringify(a.difficulty) === JSON.stringify(b.difficulty)
  );
}
