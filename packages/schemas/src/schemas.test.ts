import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { evidenceInputSchema } from './evidence.schema.js';
import { classificationSchemaV1 } from './ai-classification.schema.js';
import { exerciseGenerationSpecSchema } from './exercise-generation.schema.js';

describe('evidence boundary validation', () => {
  const base = {
    childId: 'child_1',
    source: 'app_practice',
    occurredAt: '2026-08-30T10:00:00Z',
    result: { correct: true },
    confidenceTier: 'B',
    provenance: 'manual',
  };

  it('accepts a well-formed evidence input', () => {
    const r = validate(evidenceInputSchema, base);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown evidence source', () => {
    const r = validate(evidenceInputSchema, { ...base, source: 'telepathy' });
    expect(r.ok).toBe(false);
  });

  it('rejects a hint dependency outside 0..1', () => {
    const r = validate(evidenceInputSchema, { ...base, hintDependency: 5 });
    expect(r.ok).toBe(false);
  });
});

describe('AI classification contract', () => {
  it('rejects output missing the version tag (never trust unvalidated AI output)', () => {
    const r = validate(classificationSchemaV1, {
      candidate_skill_ids: ['M4.FRAC.EQUIVALENT'],
      knowledge_level: 'K2',
      thinking_level: 'T2',
      confidence: 0.7,
      explanation: 'x',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid classify.v1 payload and defaults safety_flags', () => {
    const r = validate(classificationSchemaV1, {
      schema_version: 'classify.v1',
      candidate_skill_ids: ['M4.FRAC.EQUIVALENT'],
      knowledge_level: 'K2',
      thinking_level: 'T5',
      confidence: 0.72,
      explanation: 'standard knowledge, high thinking demand',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.safety_flags).toEqual([]);
  });
});

describe('ExerciseGenerationSpec schema (doc 14 §3)', () => {
  const base = {
    generationSpecId: 'egs_1',
    childId: 'c1',
    createdAt: '2027-01-25T09:00:00.000Z',
    learningContext: {
      curriculum: 'KET_NOI_TRI_THUC',
      expectedLessonId: 'C.G7.6.21',
      resolvedLessonId: 'C.G7.6.21',
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      isEstimated: false,
    },
    goal: { parentGoal: 'kha_gioi', sessionGoal: 'lesson_practice' },
    targets: { skillIds: ['M7.RATIO.EQUAL_CHAIN'], problemTypeIds: [] },
    childState: {
      relevantMastery: { 'M7.RATIO.EQUAL_CHAIN': 60 },
      prerequisiteGaps: [],
      readiness: 'ready',
      thinkingProfile: { algebraic_thinking: 'T3' },
      actualLearningFrontier: { algebraic_thinking: 'grade_7_standard' },
    },
    generationPlan: {
      totalQuestions: 10,
      distribution: { prerequisiteRepair: 0, currentSkill: 5, variation: 2, application: 2, advanced: 1, thinkingChallenge: 0 },
    },
    difficulty: { kMin: 'K2', kMax: 'K3', tMin: 'T2', tMax: 'T4', stretchRatio: 0.25 },
    constraints: {
      noUnlearnedRequiredKnowledge: true,
      allowAboveGradeReasoning: true,
      requireUniqueVariants: true,
      language: 'vi',
      ageAppropriate: true,
      maxSolutionComplexity: 'standard',
    },
    provenance: { plannerVersion: 'exercise-spec.v1', curriculumVersion: 'dev-core.v1', twinVersion: 't', gapSnapshotVersion: 'g' },
  };

  it('accepts a well-formed spec', () => {
    expect(validate(exerciseGenerationSpecSchema, base).ok).toBe(true);
  });

  it('rejects a distribution that does not sum to totalQuestions', () => {
    const bad = { ...base, generationPlan: { ...base.generationPlan, totalQuestions: 12 } };
    expect(validate(exerciseGenerationSpecSchema, bad).ok).toBe(false);
  });

  it('rejects kMin above kMax', () => {
    const bad = { ...base, difficulty: { ...base.difficulty, kMin: 'K4', kMax: 'K2' } };
    expect(validate(exerciseGenerationSpecSchema, bad).ok).toBe(false);
  });

  it('rejects an empty target skill list', () => {
    const bad = { ...base, targets: { skillIds: [], problemTypeIds: [] } };
    expect(validate(exerciseGenerationSpecSchema, bad).ok).toBe(false);
  });
});
