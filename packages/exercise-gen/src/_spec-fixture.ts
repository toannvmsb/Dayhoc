import { asChildId, asSkillId, type ExerciseGenerationSpec, type TargetSkill } from '@copilot/domain';

/**
 * A hand-built `ExerciseGenerationSpec` for C4/C4.1 tests. Mirrors what
 * `buildExerciseGenerationSpec` + `selectLearningTargets` would emit for a
 * Grade-7 child on "dãy tỉ số bằng nhau" with a mild prerequisite weakness.
 * Not shipped — only referenced from `*.test.ts`.
 */
export const SKILL = 'M7.RATIO.EQUAL_CHAIN';
export const PREREQ = 'M7.RATIO.PROPORTION';
export const FRONTIER_SKILL = 'M7.ALG.SYMMETRIC'; // curriculumOrigin 9

const current: TargetSkill = {
  skillId: asSkillId(SKILL),
  role: 'CURRENT',
  domain: 'algebraic_thinking',
  curriculumOrigin: 7,
  buckets: ['currentSkill', 'variation', 'application'],
  knowledgeCeiling: 'K3',
  selectionReason: 'CURRENT_CURRICULUM',
  selectedCurriculumOrigin: 7,
  selectionConfidence: 0.58,
};
const repair: TargetSkill = {
  skillId: asSkillId(PREREQ),
  role: 'PREREQUISITE_REPAIR',
  domain: 'algebraic_thinking',
  curriculumOrigin: 7,
  buckets: ['prerequisiteRepair'],
  knowledgeCeiling: 'K2',
  selectionReason: 'GAP_REPAIR',
  selectedCurriculumOrigin: 7,
  selectionConfidence: 0.9,
};
const thinking: TargetSkill = {
  skillId: asSkillId(SKILL),
  role: 'THINKING',
  domain: 'algebraic_thinking',
  curriculumOrigin: 7,
  buckets: ['thinkingChallenge'],
  knowledgeCeiling: 'K3',
  selectionReason: 'THINKING_STRETCH',
  selectedCurriculumOrigin: 7,
  selectionConfidence: 0.8,
};

export const FRONTIER_TARGET: TargetSkill = {
  skillId: asSkillId(FRONTIER_SKILL),
  role: 'FRONTIER',
  domain: 'algebraic_thinking',
  curriculumOrigin: 9,
  buckets: ['advanced'],
  knowledgeCeiling: 'K5',
  selectionReason: 'MASTERED_FRONTIER_STRETCH',
  selectedCurriculumOrigin: 9,
  frontierEvidenceOrigin: 9,
  selectionConfidence: 0.6,
};

export function makeSpec(over: Partial<ExerciseGenerationSpec> = {}): ExerciseGenerationSpec {
  const skills = over.targets?.skills ?? [current, repair, thinking];
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
    targets: {
      skills,
      problemTypeIds: [],
      skillIds: [...new Set(skills.map((s) => s.skillId))],
    },
    childState: {
      relevantMastery: { [SKILL]: 58, [PREREQ]: 45 },
      prerequisiteGaps: [{ skillId: asSkillId(PREREQ), severity: 0.4, blocking: false }],
      readiness: 'parallel_repair',
      thinkingProfile: { algebraic_thinking: 'T3' },
      actualLearningFrontier: {
        algebraic_thinking: {
          reachedCurriculumOrigin: 7,
          aboveGrade: false,
          confidence: 0.5,
          evidenceCount: 6,
          masteredSkillIds: [asSkillId(SKILL), asSkillId(PREREQ)],
          readyNextSkillIds: [],
          exposureSkillIds: [],
        },
      },
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
      targetSelectorVersion: 'target-selector.v2',
      curriculumRevision: 'math-dev-core-1.0',
      curriculumContentHash: 'deadbeefcafe0001',
      twinVersion: '2027-01-25T09:00:00.000Z',
      gapSnapshotVersion: '2027-01-25T09:00:00.000Z',
    },
    ...over,
  };
}
