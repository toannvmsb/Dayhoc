import { z } from 'zod';
import {
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  LEARNING_CONTEXT_CONFIDENCE,
  LEARNING_CONTEXT_SOURCES,
  PARENT_GOALS,
  SESSION_GOALS,
  TARGET_ROLES,
  TARGET_SELECTION_REASONS,
  THINKING_DIMENSIONS,
  THINKING_LEVELS,
} from '@copilot/domain';

/**
 * Schema for `ExerciseGenerationSpec` (doc 14 §3). The deterministic planner
 * emits this; it is logged in telemetry and handed to the generator, so it
 * crosses a boundary and must validate. The `distribution` must reconcile
 * exactly to `totalQuestions`.
 */

const distributionSchema = z
  .object({
    prerequisiteRepair: z.number().int().min(0),
    currentSkill: z.number().int().min(0),
    variation: z.number().int().min(0),
    application: z.number().int().min(0),
    advanced: z.number().int().min(0),
    thinkingChallenge: z.number().int().min(0),
  })
  .strict();

export const exerciseGenerationSpecSchema = z
  .object({
    generationSpecId: z.string().min(1),
    childId: z.string().min(1),
    createdAt: z.string().datetime(),
    schoolGrade: z.number().int().min(1).max(9),

    learningContext: z
      .object({
        curriculum: z.string().min(1),
        expectedLessonId: z.string().min(1).nullable(),
        resolvedLessonId: z.string().min(1).nullable(),
        source: z.enum(LEARNING_CONTEXT_SOURCES),
        confidence: z.enum(LEARNING_CONTEXT_CONFIDENCE),
        isEstimated: z.boolean(),
      })
      .strict(),

    goal: z
      .object({
        parentGoal: z.enum(PARENT_GOALS),
        sessionGoal: z.enum(SESSION_GOALS),
      })
      .strict(),

    targets: z
      .object({
        skills: z
          .array(
            z
              .object({
                skillId: z.string().min(1),
                role: z.enum(TARGET_ROLES),
                domain: z.string().min(1),
                curriculumOrigin: z.number().int().min(1).max(12),
                buckets: z.array(z.enum(DISTRIBUTION_BUCKETS)).min(1),
                knowledgeCeiling: z.enum(KNOWLEDGE_LEVELS),
                selectionReason: z.enum(TARGET_SELECTION_REASONS),
                selectedCurriculumOrigin: z.number().int().min(1).max(12),
                selectionConfidence: z.number().min(0).max(1),
                frontierEvidenceOrigin: z.number().int().min(1).max(12).optional(),
              })
              .strict(),
          )
          .min(1),
        problemTypeIds: z.array(z.string().min(1)),
        skillIds: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .refine(
        (t) => t.skills.every((s) => t.skillIds.includes(s.skillId)),
        { message: 'targets.skillIds must be the union of targets.skills ids', path: ['skillIds'] },
      ),

    childState: z
      .object({
        relevantMastery: z.record(z.string(), z.number().min(0).max(100)),
        prerequisiteGaps: z.array(
          z.object({ skillId: z.string().min(1), severity: z.number().min(0).max(1), blocking: z.boolean() }).strict(),
        ),
        readiness: z.enum(['ready', 'parallel_repair', 'repair_first']),
        thinkingProfile: z.record(z.enum(THINKING_DIMENSIONS), z.enum(THINKING_LEVELS)),
        actualLearningFrontier: z.record(
          z.string(),
          z
            .object({
              reachedCurriculumOrigin: z.number().int().min(1).max(12),
              aboveGrade: z.boolean(),
              confidence: z.number().min(0).max(1),
              evidenceCount: z.number().int().min(0),
              masteredSkillIds: z.array(z.string().min(1)),
              readyNextSkillIds: z.array(z.string().min(1)),
              exposureSkillIds: z.array(z.string().min(1)),
            })
            .strict(),
        ),
      })
      .strict(),

    generationPlan: z
      .object({
        totalQuestions: z.number().int().min(1).max(40),
        distribution: distributionSchema,
      })
      .strict()
      .refine(
        (p) => DISTRIBUTION_BUCKETS.reduce((s, b) => s + p.distribution[b], 0) === p.totalQuestions,
        { message: 'distribution buckets must sum to totalQuestions', path: ['distribution'] },
      ),

    difficulty: z
      .object({
        kMin: z.enum(KNOWLEDGE_LEVELS),
        kMax: z.enum(KNOWLEDGE_LEVELS),
        tMin: z.enum(THINKING_LEVELS),
        tMax: z.enum(THINKING_LEVELS),
        stretchRatio: z.number().min(0).max(1),
      })
      .strict()
      .refine((d) => KNOWLEDGE_LEVELS.indexOf(d.kMin) <= KNOWLEDGE_LEVELS.indexOf(d.kMax), {
        message: 'kMin must not exceed kMax',
        path: ['kMin'],
      })
      .refine((d) => THINKING_LEVELS.indexOf(d.tMin) <= THINKING_LEVELS.indexOf(d.tMax), {
        message: 'tMin must not exceed tMax',
        path: ['tMin'],
      }),

    constraints: z
      .object({
        noUnlearnedRequiredKnowledge: z.boolean(),
        allowAboveGradeReasoning: z.boolean(),
        requireUniqueVariants: z.boolean(),
        language: z.literal('vi'),
        ageAppropriate: z.boolean(),
        maxSolutionComplexity: z.enum(['low', 'standard', 'high']),
      })
      .strict(),

    provenance: z
      .object({
        plannerVersion: z.string().min(1),
        targetSelectorVersion: z.string().min(1),
        curriculumRevision: z.string().min(1),
        curriculumContentHash: z.string().min(1),
        twinVersion: z.string().min(1),
        gapSnapshotVersion: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ParsedExerciseGenerationSpec = z.infer<typeof exerciseGenerationSpecSchema>;
