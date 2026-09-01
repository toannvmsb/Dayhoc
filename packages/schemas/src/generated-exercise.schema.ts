import { z } from 'zod';
import { DISTRIBUTION_BUCKETS, KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';

/**
 * Schema for AI-generated exercises (doc 14 §6, §7). The generator's output
 * crosses a trust boundary — it MUST validate here before the deterministic
 * `GeneratedExerciseValidator` applies the curricular checks.
 */

const answerSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string().min(1) }),
  z.object({ kind: z.literal('fraction'), numerator: z.number().int(), denominator: z.number().int() }),
  z.object({ kind: z.literal('numeric'), value: z.number(), tolerance: z.number().min(0) }),
  z.object({ kind: z.literal('choice'), correct: z.string().min(1), options: z.array(z.string().min(1)).min(2) }),
  z.object({ kind: z.literal('reasoning') }),
]);

export const generatedExerciseSchema = z
  .object({
    id: z.string().min(1),
    generationSpecId: z.string().min(1),
    skillId: z.string().min(1),
    requiredSkillIds: z.array(z.string().min(1)).min(1),
    supportingSkillIds: z.array(z.string().min(1)).optional(),
    problemTypeId: z.string().min(1).optional(),
    bucket: z.enum(DISTRIBUTION_BUCKETS),
    knowledgeLevel: z.enum(KNOWLEDGE_LEVELS),
    thinkingLevel: z.enum(THINKING_LEVELS),
    prompt: z.string().min(1),
    answerSpec: answerSpecSchema,
    // shape only — the exactly-6-non-empty rule is a validator check so it can
    // report HINT_LADDER_MALFORMED as REPAIRABLE rather than a hard schema block.
    hints: z.array(z.string()).min(1),
    workedSolution: z.string().min(1),
    rubric: z.string().min(1).optional(),
    origin: z.literal('ai_generated'),
    variantOf: z.string().min(1).optional(),
  })
  .strict();

export const generatedExerciseBatchSchema = z
  .object({
    generationSpecId: z.string().min(1),
    generatedAt: z.string().datetime(),
    generatorModel: z.string().min(1).optional(),
    items: z.array(generatedExerciseSchema),
  })
  .strict();

export type ParsedGeneratedExercise = z.infer<typeof generatedExerciseSchema>;
export type ParsedGeneratedExerciseBatch = z.infer<typeof generatedExerciseBatchSchema>;
