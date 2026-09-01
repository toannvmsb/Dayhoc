import { DISTRIBUTION_BUCKETS, KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';

/**
 * Hand-authored JSON Schema for `GeneratedExerciseBatch` (doc 14 C5.1 §3/§4) —
 * used for provider-native STRICT structured output. It mirrors
 * `generatedExerciseBatchSchema` (the canonical Zod schema); the Zod parse +
 * the deterministic `GeneratedExerciseValidator` remain the real contract, this
 * only tightens what the provider is asked to emit.
 *
 * Bump `GENERATED_BATCH_JSON_SCHEMA_VERSION` whenever this shape changes so a
 * benchmark result stays comparable.
 */
export const GENERATED_BATCH_JSON_SCHEMA_NAME = 'generatedExerciseBatch';
export const GENERATED_BATCH_JSON_SCHEMA_VERSION = 'generatedExerciseBatch.jsonschema.v1';

const answerSpec = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'value'], properties: { kind: { const: 'exact' }, value: { type: 'string', minLength: 1 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'numerator', 'denominator'], properties: { kind: { const: 'fraction' }, numerator: { type: 'integer' }, denominator: { type: 'integer' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'value', 'tolerance'], properties: { kind: { const: 'numeric' }, value: { type: 'number' }, tolerance: { type: 'number', minimum: 0 } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'correct', 'options'], properties: { kind: { const: 'choice' }, correct: { type: 'string', minLength: 1 }, options: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } } } },
    { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'reasoning' } } },
  ],
} as const;

const item = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'generationSpecId', 'skillId', 'requiredSkillIds', 'bucket', 'knowledgeLevel', 'thinkingLevel', 'prompt', 'answerSpec', 'hints', 'workedSolution', 'origin'],
  properties: {
    id: { type: 'string', minLength: 1 },
    generationSpecId: { type: 'string', minLength: 1 },
    skillId: { type: 'string', minLength: 1 },
    requiredSkillIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    supportingSkillIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    problemTypeId: { type: 'string', minLength: 1 },
    bucket: { enum: [...DISTRIBUTION_BUCKETS] },
    knowledgeLevel: { enum: [...KNOWLEDGE_LEVELS] },
    thinkingLevel: { enum: [...THINKING_LEVELS] },
    prompt: { type: 'string', minLength: 1 },
    answerSpec,
    hints: { type: 'array', minItems: 1, items: { type: 'string' } },
    workedSolution: { type: 'string', minLength: 1 },
    rubric: { type: 'string', minLength: 1 },
    origin: { const: 'ai_generated' },
    variantOf: { type: 'string', minLength: 1 },
  },
} as const;

export const GENERATED_BATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['generationSpecId', 'generatedAt', 'items'],
  properties: {
    generationSpecId: { type: 'string', minLength: 1 },
    generatedAt: { type: 'string' },
    generatorModel: { type: 'string', minLength: 1 },
    items: { type: 'array', items: item },
  },
} as const;
