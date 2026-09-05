import { z } from 'zod';

/**
 * Schema for the REDUCED model output (doc 56 §2/§3). The model returns content
 * only — prompt / answer / distractors / hints / worked solution / rubric — for
 * 1–2 items per call. Every educational-authority field (skillId, K, T, bucket,
 * requiredSkillIds, origin, …) is composed back deterministically by
 * `composeExercise`, so this schema has NO discriminated union and is safe for
 * provider-native STRICT structured output.
 *
 *   `answer` is always a plain string ("42", "3/4", "-5", "An đúng vì …", "" for
 *   a reasoning item). Deterministic code coerces it to the item's pinned
 *   `AnswerKind`. `distractors` are the wrong options for a `choice` item
 *   (the correct option is `answer`); ignored for every other kind.
 */

export const GENERATED_ITEM_CONTENT_JSON_SCHEMA_NAME = 'generatedItemContent';
export const GENERATED_ITEM_CONTENT_JSON_SCHEMA_VERSION = 'generatedItemContent.jsonschema.v1';

export const generatedItemContentSchema = z
  .object({
    itemId: z.string().min(1),
    prompt: z.string().min(1),
    answer: z.string(), // may be "" for a reasoning item
    distractors: z.array(z.string().min(1)).max(5).optional(),
    hints: z.array(z.string()).min(1),
    workedSolution: z.string().min(1),
    rubric: z.string().min(1).optional(),
  })
  .strict();

export const generatedItemContentBatchSchema = z
  .object({
    items: z.array(generatedItemContentSchema).min(1).max(2),
  })
  .strict();

export type ParsedGeneratedItemContent = z.infer<typeof generatedItemContentSchema>;
export type ParsedGeneratedItemContentBatch = z.infer<typeof generatedItemContentBatchSchema>;

/**
 * Hand-authored strict JSON Schema mirroring the Zod schema above. Because the
 * answer is a plain string (no union), this is fully strict-mode compatible on
 * providers that reject `oneOf`/`anyOf` unions in strict structured output.
 *
 * `strict: true` on the provider requires EVERY property to be listed in
 * `required` and `additionalProperties: false`. Optional fields (`distractors`,
 * `rubric`) are therefore expressed as nullable-and-required: the model must
 * emit the key, using `null` when not applicable, and the Zod coercion below
 * treats `null`/`""` as absent.
 */
export const GENERATED_ITEM_CONTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'prompt', 'answer', 'distractors', 'hints', 'workedSolution', 'rubric'],
        properties: {
          itemId: { type: 'string', minLength: 1 },
          prompt: { type: 'string', minLength: 1 },
          answer: { type: 'string' },
          distractors: { type: ['array', 'null'], items: { type: 'string', minLength: 1 } },
          hints: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'string', minLength: 1 } },
          workedSolution: { type: 'string', minLength: 1 },
          rubric: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

/**
 * Coerce a provider payload (which may use `null` for the optional fields under
 * strict mode) into the canonical Zod shape — `null` → absent.
 */
export function normalizeGeneratedItemContentPayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return {
    items: items.map((it) => {
      if (it === null || typeof it !== 'object') return it;
      const item = it as Record<string, unknown>;
      const out: Record<string, unknown> = {
        itemId: item.itemId,
        prompt: item.prompt,
        answer: item.answer,
        hints: item.hints,
        workedSolution: item.workedSolution,
      };
      if (Array.isArray(item.distractors) && item.distractors.length > 0) out.distractors = item.distractors;
      if (typeof item.rubric === 'string' && item.rubric.trim().length > 0) out.rubric = item.rubric;
      return out;
    }),
  };
}
