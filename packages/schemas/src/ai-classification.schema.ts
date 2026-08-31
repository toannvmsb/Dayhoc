import { z } from 'zod';
import { GAP_TYPES, KNOWLEDGE_LEVELS, REASONING_QUALITY, THINKING_LEVELS } from '@copilot/domain';

/**
 * AI Structured Output Contract (Tech Spec §7).
 * Every AI output that feeds the engine MUST validate against a versioned schema.
 * The LLM proposes CANDIDATES only; the deterministic core decides.
 */
export const classificationSchemaV1 = z.object({
  schema_version: z.literal('classify.v1'),
  candidate_skill_ids: z.array(z.string().min(1)).min(1),
  problem_type_id: z.string().min(1).optional(),
  knowledge_level: z.enum(KNOWLEDGE_LEVELS),
  thinking_level: z.enum(THINKING_LEVELS),
  error_class: z.enum(GAP_TYPES).optional(),
  reasoning_quality: z.enum(REASONING_QUALITY).optional(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  safety_flags: z.array(z.string()).default([]),
});

export type ClassificationV1 = z.infer<typeof classificationSchemaV1>;
