import { describe, expect, it } from 'vitest';
import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type ExerciseGenerationSpec,
  type GeneratedExercise,
} from '@copilot/domain';
import { validateGeneratedBatch } from '@copilot/exercise-gen';
import { loadReferenceLibrary, type ReferenceExample } from '@copilot/reference-library';
import { KB } from '../harness.js';
import { loadGoldenQuestions } from './load.js';

/**
 * C3 golden regression — well-formed authored content must never be rejected by
 * the validator (no false positives). We adapt every reference-library item to a
 * `GeneratedExercise` and validate it against a spec that targets exactly that
 * skill with a permissive range. No expected dataset output is edited.
 */

function asGenerated(q: ReferenceExample, i: number): GeneratedExercise {
  // A real generator sources problemTypeId from the spec's target problem types;
  // some AI-drafted library items carry made-up ones (pending educator review,
  // decision Q5), which the validator would flag REPAIRABLE. Drop it here — we
  // are regression-testing the *content*, not the draft metadata.
  return {
    id: `gx_ref_${i}`,
    generationSpecId: 'egs_ref',
    skillId: q.skillId,
    requiredSkillIds: [q.skillId],
    bucket: 'currentSkill',
    knowledgeLevel: q.knowledgeLevel,
    thinkingLevel: q.thinkingLevel,
    prompt: q.prompt,
    answerSpec: q.answerSpec,
    hints: q.hints,
    workedSolution: q.workedSolution,
    ...(q.answerSpec.kind === 'reasoning' ? { rubric: 'Chấm theo chất lượng lập luận (Math Core §17).' } : {}),
    origin: 'ai_generated',
  };
}

function permissiveSpec(skillId: string): ExerciseGenerationSpec {
  return {
    generationSpecId: 'egs_ref',
    childId: asChildId('c_ref'),
    createdAt: '2027-01-25T09:00:00.000Z',
    schoolGrade: (KB.skills.get(asSkillId(skillId))?.gradeContext ?? 7) as ExerciseGenerationSpec['schoolGrade'],
    learningContext: {
      curriculum: 'KET_NOI_TRI_THUC',
      expectedLessonId: null,
      resolvedLessonId: KB.skills.get(asSkillId(skillId))?.curriculumNodeId ?? null,
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      isEstimated: false,
    },
    goal: { parentGoal: 'kha_gioi', sessionGoal: 'lesson_practice' },
    targets: {
      skills: [
        {
          skillId: asSkillId(skillId),
          role: KB.getSkill(skillId).curriculumOrigin > (KB.skills.get(asSkillId(skillId))?.gradeContext ?? 7) ? 'FRONTIER' : 'CURRENT',
          domain: KB.getSkill(skillId).domain,
          curriculumOrigin: KB.getSkill(skillId).curriculumOrigin,
          buckets: ['currentSkill', 'variation', 'application', 'advanced', 'thinkingChallenge', 'prerequisiteRepair'],
          knowledgeCeiling: KNOWLEDGE_LEVELS[KNOWLEDGE_LEVELS.length - 1]!,
          selectionReason:
            KB.getSkill(skillId).curriculumOrigin > (KB.skills.get(asSkillId(skillId))?.gradeContext ?? 7)
              ? 'MASTERED_FRONTIER_STRETCH'
              : 'CURRENT_CURRICULUM',
          selectedCurriculumOrigin: KB.getSkill(skillId).curriculumOrigin,
          selectionConfidence: 1,
        },
      ],
      problemTypeIds: [],
      skillIds: [asSkillId(skillId)],
    },
    childState: {
      relevantMastery: { [skillId]: 70 },
      prerequisiteGaps: [],
      readiness: 'ready',
      thinkingProfile: {},
      actualLearningFrontier: {
        [KB.getSkill(skillId).domain]: {
          reachedCurriculumOrigin: 9,
          aboveGrade: true,
          confidence: 1,
          evidenceCount: 5,
          masteredSkillIds: [asSkillId(skillId)],
          readyNextSkillIds: [],
          exposureSkillIds: [],
        },
      },
    },
    generationPlan: { totalQuestions: 1, distribution: { prerequisiteRepair: 0, currentSkill: 1, variation: 0, application: 0, advanced: 0, thinkingChallenge: 0 } },
    difficulty: { kMin: KNOWLEDGE_LEVELS[0]!, kMax: KNOWLEDGE_LEVELS[KNOWLEDGE_LEVELS.length - 1]!, tMin: THINKING_LEVELS[0]!, tMax: THINKING_LEVELS[THINKING_LEVELS.length - 1]!, stretchRatio: 0.25 },
    constraints: {
      noUnlearnedRequiredKnowledge: true,
      allowAboveGradeReasoning: true,
      requireUniqueVariants: true,
      language: 'vi',
      ageAppropriate: true,
      maxSolutionComplexity: 'high',
    },
    provenance: { plannerVersion: 'exercise-spec.v1', targetSelectorVersion: 'target-selector.v1', curriculumRevision: 'math-dev-core-1.0', curriculumContentHash: 'testhash01234567', twinVersion: 't', gapSnapshotVersion: 'g' },
  };
}

describe('C3 golden — validator has no false positives on authored content', () => {
  const lib = loadReferenceLibrary();

  it('every reference-library item is accepted by the validator', () => {
    const bad: string[] = [];
    lib.forEach((q, i) => {
      const gx = asGenerated(q, i);
      const r = validateGeneratedBatch(
        { generationSpecId: 'egs_ref', generatedAt: '2027-01-25T09:05:00.000Z', items: [gx] },
        permissiveSpec(q.skillId),
        KB,
      );
      if (r.acceptedItems.length !== 1) bad.push(`${q.id}: ${r.reasonCodes.join(', ')}`);
    });
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('every golden-question skill id resolves in the KB (a generator targeting them is not blocked on identity)', () => {
    for (const q of loadGoldenQuestions()) {
      expect(KB.skills.has(asSkillId(q.skill_id)), `unknown skill ${q.skill_id}`).toBe(true);
    }
  });

  it('an invented skill id is always BLOCKed (identity is non-negotiable)', () => {
    const gx: GeneratedExercise = { ...asGenerated(lib[0]!, 0), skillId: asSkillId('M9.NOT.A_REAL_SKILL'), problemTypeId: asProblemTypeId('M9.PT.NOPE') };
    const r = validateGeneratedBatch(
      { generationSpecId: 'egs_ref', generatedAt: '2027-01-25T09:05:00.000Z', items: [gx] },
      permissiveSpec(lib[0]!.skillId),
      KB,
    );
    expect(r.outcome).toBe('BLOCK');
    expect(r.reasonCodes).toContain('UNKNOWN_SKILL_ID');
    expect(r.acceptedItems).toEqual([]);
  });
});
