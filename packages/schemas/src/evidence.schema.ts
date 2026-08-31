import { z } from 'zod';
import {
  CONFIDENCE_TIERS,
  EVIDENCE_SOURCES,
  PROVENANCE,
  REASONING_QUALITY,
} from '@copilot/domain';

const isoDate = z.string().datetime({ offset: true });

export const evidenceResultSchema = z.object({
  correct: z.boolean().optional(),
  score: z.number().min(0).max(1).optional(),
  steps: z.array(z.string()).readonly().optional(),
});

/** Schema for an inbound Evidence record (before it is assigned an id + appended). */
export const evidenceInputSchema = z.object({
  childId: z.string().min(1),
  source: z.enum(EVIDENCE_SOURCES),
  occurredAt: isoDate,
  skillId: z.string().min(1).optional(),
  problemTypeId: z.string().min(1).optional(),
  result: evidenceResultSchema,
  reasoningQuality: z.enum(REASONING_QUALITY).optional(),
  hintDependency: z.number().min(0).max(1).optional(),
  timeSpentSeconds: z.number().nonnegative().optional(),
  confidenceTier: z.enum(CONFIDENCE_TIERS),
  provenance: z.enum(PROVENANCE),
  aiInferenceId: z.string().optional(),
});

export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
