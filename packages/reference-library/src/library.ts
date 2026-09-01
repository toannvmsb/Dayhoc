import { z } from 'zod';
import {
  asProblemTypeId,
  asSkillId,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type KnowledgeLevel,
  type ProblemTypeId,
  type Question,
  type SkillId,
  type ThinkingLevel,
} from '@copilot/domain';
import authoredRaw from './data/questions.json' with { type: 'json' };
import aiDraftRaw from './data/questions.ai-draft.json' with { type: 'json' };

/**
 * @copilot/reference-library — the repurposed question bank (doc 14 §1, C2).
 *
 * This is NOT the delivery source for ordinary practice (AI_GENERATION_FIRST).
 * It exists only for:
 *   - grounding / few-shot examples for the exercise generator
 *   - problem-family examples and answer-format standards
 *   - difficulty (K/T) calibration references
 *   - generator evaluation, validator test cases, regression & Golden Tests
 *
 * There is deliberately no "pick a question to serve this child" API here.
 * The legacy delivery path (`@copilot/practice` `buildAssignment`) still reads
 * this library as a compatibility shim until the generation runtime lands (C5).
 */

/** A reference item. Same shape as a `Question`; the name signals intent. */
export type ReferenceExample = Question;

const answerSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string() }),
  z.object({ kind: z.literal('fraction'), numerator: z.number().int(), denominator: z.number().int() }),
  z.object({ kind: z.literal('numeric'), value: z.number(), tolerance: z.number().min(0) }),
  z.object({ kind: z.literal('choice'), correct: z.string(), options: z.array(z.string()).min(2) }),
  z.object({ kind: z.literal('reasoning') }),
]);

const exampleSchema = z.object({
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

export class ReferenceLibraryError extends Error {}

const raw = [...(authoredRaw as unknown[]), ...(aiDraftRaw as unknown[])];
let cache: readonly ReferenceExample[] | undefined;

/**
 * The full reference library (educator-authored + AI-drafted, all validated
 * against one schema). Every item carries the six-rung hint ladder.
 */
export function loadReferenceLibrary(): readonly ReferenceExample[] {
  if (cache) return cache;
  const parsed = z.array(exampleSchema).safeParse(raw);
  if (!parsed.success) {
    throw new ReferenceLibraryError(
      `reference library failed validation:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cache = parsed.data.map(({ problemTypeId, skillId, ...rest }): ReferenceExample => ({
    ...rest,
    skillId: asSkillId(skillId),
    ...(problemTypeId ? { problemTypeId: asProblemTypeId(problemTypeId) } : {}),
  }));
  return cache;
}

/** Reference examples for one skill (calibration / inspection — not delivery). */
export function examplesForSkill(skillId: string): ReferenceExample[] {
  return loadReferenceLibrary().filter((q) => q.skillId === skillId);
}

export interface GroundingQuery {
  readonly skillId: SkillId | string;
  readonly problemTypeId?: ProblemTypeId | string;
  /** K/T to anchor calibration on (optional). */
  readonly knowledgeLevel?: KnowledgeLevel;
  readonly thinkingLevel?: ThinkingLevel;
  readonly limit?: number;
}

/**
 * Up to `limit` (default 3) grounding examples for the generator's few-shot
 * prompt: same skill, preferring the same problem type, then nearest K/T.
 */
export function groundingExamplesFor(query: GroundingQuery): ReferenceExample[] {
  const limit = query.limit ?? 3;
  const pool = loadReferenceLibrary().filter((q) => q.skillId === query.skillId);
  if (pool.length === 0) return [];

  const kAnchor = query.knowledgeLevel ? KNOWLEDGE_LEVELS.indexOf(query.knowledgeLevel) : null;
  const tAnchor = query.thinkingLevel ? THINKING_LEVELS.indexOf(query.thinkingLevel) : null;

  const scored = pool
    .map((q) => {
      let score = 0;
      if (query.problemTypeId && q.problemTypeId === query.problemTypeId) score -= 100;
      if (kAnchor !== null) score += Math.abs(KNOWLEDGE_LEVELS.indexOf(q.knowledgeLevel) - kAnchor);
      if (tAnchor !== null) score += Math.abs(THINKING_LEVELS.indexOf(q.thinkingLevel) - tAnchor);
      return { q, score };
    })
    .sort((a, b) => a.score - b.score || a.q.id.localeCompare(b.q.id));

  return scored.slice(0, limit).map((s) => s.q);
}

/** Observed K/T span in the library for a skill — a calibration reference. */
export function calibrationRangeFor(
  skillId: string,
): { kMin: KnowledgeLevel; kMax: KnowledgeLevel; tMin: ThinkingLevel; tMax: ThinkingLevel } | null {
  const pool = examplesForSkill(skillId);
  if (pool.length === 0) return null;
  const ks = pool.map((q) => KNOWLEDGE_LEVELS.indexOf(q.knowledgeLevel)).sort((a, b) => a - b);
  const ts = pool.map((q) => THINKING_LEVELS.indexOf(q.thinkingLevel)).sort((a, b) => a - b);
  return {
    kMin: KNOWLEDGE_LEVELS[ks[0]!]!,
    kMax: KNOWLEDGE_LEVELS[ks[ks.length - 1]!]!,
    tMin: THINKING_LEVELS[ts[0]!]!,
    tMax: THINKING_LEVELS[ts[ts.length - 1]!]!,
  };
}
