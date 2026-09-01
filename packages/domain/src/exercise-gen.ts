import type { ChildId, GradeContext, ProblemTypeId, SkillId } from './identifiers.js';
import type { KnowledgeLevel, ThinkingDimension, ThinkingLevel } from './taxonomy.js';
import type { LearningContextConfidence, LearningContextSource } from './context.js';
import type { AnswerSpec } from './planning.js';

/**
 * ExerciseGenerationSpec (doc 14 §3, Pricing v1.1 §3 — LOCKED, AI_GENERATION_FIRST).
 *
 * The deterministic education engine produces this BEFORE any AI call. It is the
 * educational contract: it decides WHAT to practise, WHY, which skills / problem
 * types, K/T levels, gap repair, stretch, how many questions, and the hard
 * constraints. AI generates content strictly INSIDE this spec and never changes
 * any of it (doc 14 §5).
 *
 * The spec is a pure function of
 *   (resolved learning context, skill/prereq/problem-type graphs, learning twin,
 *    knowledge gaps, prerequisite readiness, actual learning frontier, parent
 *    goal, available learning time).
 * Two children at the same grade + SGK + current lesson but different
 * mastery / gaps / thinking profile / frontier / goal → materially different specs.
 */
export interface ExerciseGenerationSpec {
  readonly generationSpecId: string;
  readonly childId: ChildId;
  readonly createdAt: string; // ISO
  /** The child's school grade — CONTEXT for above-grade checks, never a ceiling. */
  readonly schoolGrade: GradeContext;

  readonly learningContext: SpecLearningContext;
  readonly goal: SpecGoal;
  readonly targets: SpecTargets;
  readonly childState: SpecChildState;
  readonly generationPlan: SpecGenerationPlan;
  readonly difficulty: SpecDifficulty;
  readonly constraints: SpecConstraints;
  readonly provenance: SpecProvenance;
}

export interface SpecLearningContext {
  readonly curriculum: string; // KET_NOI_TRI_THUC
  /** Calendar estimate — may be null when the child has no enrollment. */
  readonly expectedLessonId: string | null;
  /** The lesson the planner is targeting (resolver output). */
  readonly resolvedLessonId: string | null;
  readonly source: LearningContextSource;
  readonly confidence: LearningContextConfidence;
  /** True when the context is only an estimate → content selection is more conservative (invariant 10). */
  readonly isEstimated: boolean;
}

/** Canonical parent-goal slugs (match planner/gap-engine config keys). */
export const PARENT_GOALS = [
  'theo_sat_chuong_trinh', // stay with the school curriculum
  'kha_gioi', // solid + a bit ahead
  'phat_trien_tu_duy', // thinking development
  'hsg_thi_chuyen', // HSG / entrance exam
] as const;
export type ParentGoal = (typeof PARENT_GOALS)[number];

/** What THIS session is for — derived from situation + gaps + exam proximity. */
export const SESSION_GOALS = [
  'lesson_practice',
  'gap_repair',
  'exam_revision',
  'stretch_and_thinking',
] as const;
export type SessionGoal = (typeof SESSION_GOALS)[number];

export interface SpecGoal {
  readonly parentGoal: ParentGoal;
  readonly sessionGoal: SessionGoal;
}

export interface SpecTargets {
  /** Production skill IDs — AI may not add to or change this set (invariant 1/2). */
  readonly skillIds: readonly SkillId[];
  /** Problem types that belong to the target skills (invariant 3). May be empty. */
  readonly problemTypeIds: readonly ProblemTypeId[];
}

export interface SpecPrerequisiteGap {
  readonly skillId: SkillId;
  readonly severity: number; // 0..1
  readonly blocking: boolean; // blocks the current lesson
}

export interface SpecChildState {
  /** skillId → mastery 0..100, for the target skills + their weak prerequisites. */
  readonly relevantMastery: Readonly<Record<string, number>>;
  readonly prerequisiteGaps: readonly SpecPrerequisiteGap[];
  readonly readiness: 'ready' | 'parallel_repair' | 'repair_first';
  /** thinking dimension → demonstrated level (only dimensions with evidence). */
  readonly thinkingProfile: Readonly<Partial<Record<ThinkingDimension, ThinkingLevel>>>;
  /** domain → frontier label, e.g. "above_grade_G9_exposure". NEVER one global grade. */
  readonly actualLearningFrontier: Readonly<Record<string, string>>;
}

/**
 * Question buckets. Maps 1:1 to the pedagogical intent; the sum MUST equal
 * `totalQuestions` (checked by the schema and the builder).
 */
export interface ExerciseDistribution {
  readonly prerequisiteRepair: number;
  readonly currentSkill: number;
  readonly variation: number;
  readonly application: number;
  readonly advanced: number;
  readonly thinkingChallenge: number;
}

export const DISTRIBUTION_BUCKETS = [
  'prerequisiteRepair',
  'currentSkill',
  'variation',
  'application',
  'advanced',
  'thinkingChallenge',
] as const satisfies readonly (keyof ExerciseDistribution)[];

export function distributionTotal(d: ExerciseDistribution): number {
  return DISTRIBUTION_BUCKETS.reduce((sum, k) => sum + d[k], 0);
}

export interface SpecGenerationPlan {
  readonly totalQuestions: number;
  readonly distribution: ExerciseDistribution;
}

export interface SpecDifficulty {
  readonly kMin: KnowledgeLevel;
  readonly kMax: KnowledgeLevel;
  readonly tMin: ThinkingLevel;
  readonly tMax: ThinkingLevel;
  /** Fraction of items allowed at the top of the K/T range (productive struggle). 0..1. */
  readonly stretchRatio: number;
}

export interface SpecConstraints {
  /** Every item solvable with only mastered / currently-learning prerequisites (invariant 6). */
  readonly noUnlearnedRequiredKnowledge: boolean;
  /** Thinking (T) may exceed the school grade; required knowledge (K) may not (invariant 5). */
  readonly allowAboveGradeReasoning: boolean;
  readonly requireUniqueVariants: boolean;
  readonly language: 'vi';
  readonly ageAppropriate: boolean;
  readonly maxSolutionComplexity: 'low' | 'standard' | 'high';
}

export interface SpecProvenance {
  readonly plannerVersion: string;
  readonly curriculumVersion: string;
  /** twin.computedAt — ties the spec to the learner state it was built from. */
  readonly twinVersion: string;
  /** gapEngineResult.computedAt. */
  readonly gapSnapshotVersion: string;
}

// --- Generated exercises + validation (doc 14 §6, C3) -------------------

/**
 * One AI-generated exercise. Content only — every structural / curricular
 * decision was already made by the `ExerciseGenerationSpec`. Must pass
 * `GeneratedExerciseValidator` before it can reach a child.
 */
export interface GeneratedExercise {
  readonly id: string; // ULID assigned by the generator
  readonly generationSpecId: string;
  readonly skillId: SkillId;
  readonly problemTypeId?: ProblemTypeId;
  /** Which `ExerciseDistribution` bucket this item fills. */
  readonly bucket: keyof ExerciseDistribution;
  readonly knowledgeLevel: KnowledgeLevel;
  readonly thinkingLevel: ThinkingLevel;
  readonly prompt: string;
  readonly answerSpec: AnswerSpec;
  /** Six-rung hint ladder (Math Core §17) — last rung is the full solution. */
  readonly hints: readonly string[];
  readonly workedSolution: string;
  /** Required for `answerSpec.kind === 'reasoning'`: how to grade the explanation. */
  readonly rubric?: string;
  readonly origin: 'ai_generated';
  readonly variantOf?: string;
}

export interface GeneratedExerciseBatch {
  readonly generationSpecId: string;
  readonly generatedAt: string; // ISO
  readonly generatorModel?: string;
  readonly items: readonly GeneratedExercise[];
}

export const VALIDATION_OUTCOMES = ['PASS', 'REPAIRABLE', 'REGENERATE', 'BLOCK'] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

/** Worst-wins ordering. */
export const OUTCOME_SEVERITY: Record<ValidationOutcome, number> = {
  PASS: 0,
  REPAIRABLE: 1,
  REGENERATE: 2,
  BLOCK: 3,
};

export const EXERCISE_VALIDATION_REASON_CODES = [
  // schema / completeness
  'SCHEMA_INVALID',
  'MISSING_ANSWER',
  'MISSING_SOLUTION',
  'MISSING_RUBRIC',
  'HINT_LADDER_MALFORMED',
  // identity (non-negotiable — AI may not invent IDs)
  'UNKNOWN_SKILL_ID',
  'SKILL_NOT_IN_SPEC',
  'UNKNOWN_PROBLEM_TYPE',
  'PROBLEM_TYPE_SKILL_MISMATCH',
  // difficulty
  'OUTSIDE_K_RANGE',
  'OUTSIDE_T_RANGE',
  'CHALLENGE_EXCEEDS_SPEC',
  // curriculum safety
  'UNLEARNED_REQUIRED_KNOWLEDGE',
  'ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED',
  // answer
  'ANSWER_UNVERIFIABLE',
  'ANSWER_INCONSISTENT',
  // batch / surface
  'DUPLICATE_VARIANT',
  'UNSAFE_CONTENT',
  'NOT_AGE_APPROPRIATE',
  'LANGUAGE_MISMATCH',
  'DISTRIBUTION_MISMATCH',
] as const;
export type ExerciseValidationReasonCode = (typeof EXERCISE_VALIDATION_REASON_CODES)[number];

export interface ExerciseFinding {
  readonly code: ExerciseValidationReasonCode;
  readonly outcome: ValidationOutcome;
  /** Item ids this finding is about (empty for batch-level findings). */
  readonly questionIds: readonly string[];
  readonly detail: string;
  readonly repairInstruction?: string;
}

export interface BatchValidationResult {
  /** Worst finding outcome (PASS when there are no findings). */
  readonly outcome: ValidationOutcome;
  readonly validatorVersion: string;
  /** Items that passed EVERY check — the only ones that may reach an Assignment. */
  readonly acceptedItems: readonly GeneratedExercise[];
  readonly findings: readonly ExerciseFinding[];
  readonly reasonCodes: readonly ExerciseValidationReasonCode[];
  /** How many more items the caller should regenerate to honour the spec. */
  readonly shortfall: number;
}
