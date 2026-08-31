/**
 * Branded identifier types.
 *
 * Decision D1 (approved): Skill IDs are grade-opaque and stable. Grade is stored
 * as separate metadata (`gradeContext`), never encoded as a runtime partition.
 * Legacy prefixes like `M4.*` / `G7.*` remain valid string aliases in data files.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SkillId = Brand<string, 'SkillId'>;
export type ProblemTypeId = Brand<string, 'ProblemTypeId'>;
export type CurriculumNodeId = Brand<string, 'CurriculumNodeId'>;
export type ChildId = Brand<string, 'ChildId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type GapId = Brand<string, 'GapId'>;

/** School grade is CONTEXT, not a ceiling (core invariant). Range: pilots use 4 and 7. */
export type GradeContext = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const asSkillId = (raw: string): SkillId => raw as SkillId;
export const asProblemTypeId = (raw: string): ProblemTypeId => raw as ProblemTypeId;
export const asChildId = (raw: string): ChildId => raw as ChildId;
