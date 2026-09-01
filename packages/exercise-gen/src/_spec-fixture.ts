import { asChildId, asSkillId, type ExerciseGenerationSpec } from '@copilot/domain';

/**
 * A hand-built `ExerciseGenerationSpec` for C4 tests (grounding / mock /
 * orchestrator). Mirrors what `buildExerciseGenerationSpec` would emit for a
 * Grade-7 child on "dãy tỉ số bằng nhau" with a weak prerequisite. Not shipped —
 * only referenced from `*.test.ts`.
 */
export const SKILL = 'M7.RATIO.EQUAL_CHAIN';
export const PREREQ = 'M7.RATIO.PROPORTION';

export function makeSpec(over: Partial<ExerciseGenerationSpec> = {}): ExerciseGenerationSpec {
  return {
    generationSpecId: 'egs_c4_test',
    childId: asChildId('c4_child'),
    createdAt: '2027-01-25T09:00:00.000Z',
    schoolGrade: 7,
    learningContext: {
      curriculum: 'KET_NOI_TRI_THUC',
      expectedLessonId: 'C.G7.6.21',
      resolvedLessonId: 'C.G7.6.21',
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      isEstimated: false,
    },
    goal: { parentGoal: 'kha_gioi', sessionGoal: 'lesson_practice' },
    targets: { skillIds: [asSkillId(SKILL), asSkillId(PREREQ)], problemTypeIds: [] },
    childState: {
      relevantMastery: { [SKILL]: 58, [PREREQ]: 45 },
      prerequisiteGaps: [{ skillId: asSkillId(PREREQ), severity: 0.4, blocking: false }],
      readiness: 'parallel_repair',
      thinkingProfile: { algebraic_thinking: 'T3' },
      actualLearningFrontier: { algebraic_thinking: 'grade_7_standard' },
    },
    generationPlan: {
      totalQuestions: 8,
      distribution: { prerequisiteRepair: 2, currentSkill: 3, variation: 1, application: 1, advanced: 0, thinkingChallenge: 1 },
    },
    difficulty: { kMin: 'K1', kMax: 'K3', tMin: 'T1', tMax: 'T4', stretchRatio: 0.25 },
    constraints: {
      noUnlearnedRequiredKnowledge: true,
      allowAboveGradeReasoning: true,
      requireUniqueVariants: true,
      language: 'vi',
      ageAppropriate: true,
      maxSolutionComplexity: 'standard',
    },
    provenance: {
      plannerVersion: 'exercise-spec.v1',
      curriculumRevision: 'math-dev-core-1.0',
      curriculumContentHash: 'deadbeefcafe0001',
      twinVersion: '2027-01-25T09:00:00.000Z',
      gapSnapshotVersion: '2027-01-25T09:00:00.000Z',
    },
    ...over,
  };
}
