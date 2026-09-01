import { z } from 'zod';
import { DOMAINS, KNOWLEDGE_LEVELS, THINKING_DIMENSIONS, THINKING_LEVELS } from '@copilot/domain';

/**
 * Schemas for the math knowledge base data files (Math Core §2, §14, §37).
 * Every data file is validated against these at load time — malformed data is a
 * hard failure, never a silent skip (Engineering rule: schema validation at boundaries).
 *
 * Decision D1: `id` is a stable, grade-opaque string. Legacy `M4.*` / `G7.*` prefixes
 * are allowed as-is; grade lives ONLY in `gradeContext`, never parsed from the id.
 */

const skillIdPattern = /^[A-Z][A-Z0-9]*(\.[A-Z0-9_]+)+$/;
export const skillIdSchema = z.string().regex(skillIdPattern, 'must look like NS.SUBGROUP.NAME');

const gradeContextSchema = z
  .number()
  .int()
  .min(1)
  .max(9) as z.ZodType<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9>;

/**
 * Curriculum node kind (doc 13 C4.2 §2). Only `CORE_CURRICULUM` nodes may become
 * the RESOLVED current school lesson — the others are skill families / diagnostic
 * / reference targets. Never string-match the id ("EXT"); use this.
 */
export const CURRICULUM_NODE_TYPES = [
  'CORE_CURRICULUM',
  'ENRICHMENT',
  'ADVANCED',
  'HSG',
  'DIAGNOSTIC',
  'REFERENCE',
] as const;
export const curriculumNodeTypeSchema = z.enum(CURRICULUM_NODE_TYPES);

export const curriculumNodeSchema = z.object({
  id: z.string().regex(/^C\.[A-Z0-9]+(\.[A-Z0-9_]+)*$/),
  gradeContext: gradeContextSchema,
  /** Defaults to CORE_CURRICULUM so pre-C4.2 data still validates + stays eligible. */
  nodeType: curriculumNodeTypeSchema.default('CORE_CURRICULUM'),
  textbook: z.string().min(1),
  volume: z.union([z.literal(1), z.literal(2)]).optional(),
  strand: z.string().min(1), // "Chủ đề 10 — Phân số"
  lesson: z.string().min(1),
});

/** True when a node represents something a school class actually teaches. */
export function isEligibleForCurrentLearningContext(node: { readonly nodeType?: string }): boolean {
  return (node.nodeType ?? 'CORE_CURRICULUM') === 'CORE_CURRICULUM';
}

export const problemTypeSchema = z.object({
  id: skillIdSchema,
  skillId: skillIdSchema,
  name: z.string().min(1),
  knowledgeLevel: z.enum(KNOWLEDGE_LEVELS),
  thinkingLevel: z.enum(THINKING_LEVELS),
});

export const skillSchema = z.object({
  id: skillIdSchema,
  gradeContext: gradeContextSchema,
  domain: z.enum(DOMAINS),
  topic: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  /** Which curriculum node introduces this skill. Every skill MUST map to one. */
  curriculumNodeId: curriculumNodeSchema.shape.id,
  /** Grade origin of the *knowledge* — may exceed gradeContext (above-grade / HSG). */
  curriculumOrigin: gradeContextSchema,
  thinkingDimensions: z.array(z.enum(THINKING_DIMENSIONS)).default([]),
  advancedExtensions: z.array(z.string()).default([]),
});

export const prerequisiteEdgeSchema = z.object({
  from: skillIdSchema,
  to: skillIdSchema,
  importance: z.number().min(0).max(1),
  /** True when `from` and `to` sit in different gradeContexts (Math Core cross-grade DAG). */
  crossGrade: z.boolean(),
});

/** Provenance for one built grade dataset (doc 14 C3.1 §D — no hard-coded versions). */
export const datasetMetaSchema = z.object({
  /** Human-readable revision tag, bumped when curriculum semantics change. */
  datasetRevision: z.string().min(1),
  /** Which source the KB JSON was generated from. */
  source: z.string().min(1).default('math-dev-core'),
});

export const gradeDatasetSchema = z.object({
  gradeContext: gradeContextSchema,
  meta: datasetMetaSchema.optional(),
  curriculum: z.array(curriculumNodeSchema),
  skills: z.array(skillSchema),
  prerequisites: z.array(prerequisiteEdgeSchema),
  problemTypes: z.array(problemTypeSchema),
});

export type DatasetMeta = z.infer<typeof datasetMetaSchema>;
export type CurriculumNodeType = z.infer<typeof curriculumNodeTypeSchema>;
export type CurriculumNode = z.infer<typeof curriculumNodeSchema>;
export type ProblemType = z.infer<typeof problemTypeSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type PrerequisiteEdgeData = z.infer<typeof prerequisiteEdgeSchema>;
export type GradeDataset = z.infer<typeof gradeDatasetSchema>;
