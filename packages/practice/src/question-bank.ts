import { z } from 'zod';
import {
  asProblemTypeId,
  asSkillId,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type Question,
} from '@copilot/domain';
import raw from './data/questions.json' with { type: 'json' };

const answerSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string() }),
  z.object({ kind: z.literal('fraction'), numerator: z.number().int(), denominator: z.number().int() }),
  z.object({ kind: z.literal('numeric'), value: z.number(), tolerance: z.number().min(0) }),
  z.object({ kind: z.literal('choice'), correct: z.string(), options: z.array(z.string()).min(2) }),
  z.object({ kind: z.literal('reasoning') }),
]);

const questionSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  problemTypeId: z.string().min(1).optional(),
  knowledgeLevel: z.enum(KNOWLEDGE_LEVELS),
  thinkingLevel: z.enum(THINKING_LEVELS),
  prompt: z.string().min(1),
  answerSpec: answerSpecSchema,
  hints: z.array(z.string()).length(6),
  workedSolution: z.string().min(1),
  origin: z.enum(['authored', 'ai_generated']),
});

export class QuestionBankError extends Error {}

let cache: readonly Question[] | undefined;

/**
 * The authored question bank (Phase 5). Authored-first: AI generation (validated
 * against the same schema) is layered on later. Every question carries the full
 * six-rung hint ladder.
 */
export function loadQuestionBank(): readonly Question[] {
  if (cache) return cache;
  const parsed = z.array(questionSchema).safeParse(raw);
  if (!parsed.success) {
    throw new QuestionBankError(
      `question bank failed validation:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cache = parsed.data.map(({ problemTypeId, skillId, ...rest }): Question => ({
    ...rest,
    skillId: asSkillId(skillId),
    ...(problemTypeId ? { problemTypeId: asProblemTypeId(problemTypeId) } : {}),
  }));
  return cache;
}

export function questionsForSkill(skillId: string): Question[] {
  return loadQuestionBank().filter((q) => q.skillId === skillId);
}
