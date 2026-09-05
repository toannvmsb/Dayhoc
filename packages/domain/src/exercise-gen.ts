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

/**
 * The role a target skill plays in the session (doc 14 C4.1 §2). The generation
 * bucket a skill may serve is derived from its role — the generator NEVER maps a
 * bucket to an arbitrary skill.
 */
export const TARGET_ROLES = ['CURRENT', 'PREREQUISITE_REPAIR', 'FRONTIER', 'THINKING'] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

/** WHY a target was selected — traceable (doc 14 C4.2 §4). */
export const TARGET_SELECTION_REASONS = [
  'CURRENT_CURRICULUM',
  'GAP_REPAIR',
  'NEXT_SAFE_FRONTIER', // a "ready next" above-grade skill whose prereqs are satisfied
  'MASTERED_FRONTIER_STRETCH', // an already-demonstrated above-grade skill, revisited harder
  'THINKING_STRETCH', // T4/T5 on a current grade-level skill
  'THINKING_ADJACENT_FALLBACK', // T4/T5 on a safe adjacent grade-level skill (no PT on current)
] as const;
export type TargetSelectionReason = (typeof TARGET_SELECTION_REASONS)[number];

export interface TargetSkill {
  readonly skillId: SkillId;
  readonly role: TargetRole;
  readonly domain: string;
  /** Grade origin of this skill's knowledge (may exceed the school grade for FRONTIER). */
  readonly curriculumOrigin: number;
  /** Which generation buckets may draw on this skill. */
  readonly buckets: readonly (keyof ExerciseDistribution)[];
  /** Highest K a FRONTIER/CURRENT target permits (a THINKING target stays at grade K). */
  readonly knowledgeCeiling: KnowledgeLevel;
  readonly selectionReason: TargetSelectionReason;
  /** = `curriculumOrigin`, spelled out for provenance. */
  readonly selectedCurriculumOrigin: number;
  /** For a FRONTIER target: the domain's highest DEMONSTRATED origin (the evidence behind the pick). */
  readonly frontierEvidenceOrigin?: number;
  /** 0..1 — how confident the selector is in this target (frontier confidence / mastery / 1 for CURRENT). */
  readonly selectionConfidence: number;
}

export interface SpecTargets {
  /** Typed targets by role (doc 14 C4.1). AI may not add to or change this set. */
  readonly skills: readonly TargetSkill[];
  /** Problem types that belong to the target skills. May be empty. */
  readonly problemTypeIds: readonly ProblemTypeId[];
  /**
   * @deprecated flat union of every target skill id — kept so C1–C4 consumers
   * that read `targets.skillIds` keep working. Derive from `skills`.
   */
  readonly skillIds: readonly SkillId[];
}

export interface SpecPrerequisiteGap {
  readonly skillId: SkillId;
  readonly severity: number; // 0..1
  readonly blocking: boolean; // blocks the current lesson
}

/**
 * Machine-readable per-domain frontier (doc 14 C4.1 §9). No magic strings — the
 * planner selects real frontier skills from `readyNextSkillIds` etc.
 */
export interface DomainFrontierView {
  readonly reachedCurriculumOrigin: number;
  readonly aboveGrade: boolean;
  readonly confidence: number; // 0..1
  readonly evidenceCount: number;
  readonly masteredSkillIds: readonly SkillId[];
  readonly readyNextSkillIds: readonly SkillId[];
  readonly exposureSkillIds: readonly SkillId[];
}

export interface SpecChildState {
  /** skillId → mastery 0..100, for the target skills + their weak prerequisites. */
  readonly relevantMastery: Readonly<Record<string, number>>;
  readonly prerequisiteGaps: readonly SpecPrerequisiteGap[];
  readonly readiness: 'ready' | 'parallel_repair' | 'repair_first';
  /** thinking dimension → demonstrated level (only dimensions with evidence). */
  readonly thinkingProfile: Readonly<Partial<Record<ThinkingDimension, ThinkingLevel>>>;
  /** domain → structured frontier (doc 14 C4.1 §9). NEVER a single global grade. */
  readonly actualLearningFrontier: Readonly<Record<string, DomainFrontierView>>;
}

/**
 * Question buckets. Maps 1:1 to the pedagogical intent; the sum MUST equal
 * `totalQuestions`. Each bucket binds to a TARGET ROLE (doc 14 C4.1 §6/§7) —
 * ADVANCED KNOWLEDGE and ADVANCED THINKING are NOT one flag:
 *   prerequisiteRepair → PREREQUISITE_REPAIR targets, K ≤ K2
 *   currentSkill / variation / application → CURRENT targets, K within grade
 *   advanced          → FRONTIER targets — ADVANCED KNOWLEDGE (K4/K5 / above-grade)
 *   thinkingChallenge → THINKING targets — ADVANCED THINKING (T4/T5) on
 *                       grade-level knowledge; does NOT imply above-grade K
 */
export interface ExerciseDistribution {
  readonly prerequisiteRepair: number;
  readonly currentSkill: number;
  readonly variation: number;
  readonly application: number;
  /** ADVANCED KNOWLEDGE — bound to FRONTIER targets. `> 0` ⟺ a FRONTIER target exists. */
  readonly advanced: number;
  /** ADVANCED THINKING — bound to THINKING targets (high T, grade-level K). */
  readonly thinkingChallenge: number;
}

/** Which target role a generation bucket must draw on (doc 14 C4.1 §6). */
export const BUCKET_ROLE: Record<keyof ExerciseDistribution, TargetRole> = {
  prerequisiteRepair: 'PREREQUISITE_REPAIR',
  currentSkill: 'CURRENT',
  variation: 'CURRENT',
  application: 'CURRENT',
  advanced: 'FRONTIER',
  thinkingChallenge: 'THINKING',
};

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
  /** Version of the deterministic target selector (doc 14 C4.1 §13). */
  readonly targetSelectorVersion: string;
  /** Human revision tag of the curriculum / skill graph the spec was built on. */
  readonly curriculumRevision: string;
  /** Deterministic content fingerprint of that KB — answers "which skill graph exactly?". */
  readonly curriculumContentHash: string;
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
  /** The skill this item PRACTISES (the spec target it was generated for). */
  readonly skillId: SkillId;
  /**
   * The skills ACTUALLY required to solve the item — not everything related.
   * The validator checks these against the prereq DAG and the blocking gaps
   * (doc 14 C3.1 §B). AI must not invent a production skill id here.
   */
  readonly requiredSkillIds: readonly SkillId[];
  /** Helpful-but-not-required context skills (optional). */
  readonly supportingSkillIds?: readonly SkillId[];
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

/** Per-ITEM outcome (doc 14 C3.1 §C). */
export const ITEM_VALIDATION_OUTCOMES = ['PASS', 'REPAIRABLE', 'REGENERATE', 'BLOCK'] as const;
export type ItemValidationOutcome = (typeof ITEM_VALIDATION_OUTCOMES)[number];
/** @deprecated use `ItemValidationOutcome`. */
export type ValidationOutcome = ItemValidationOutcome;
export const VALIDATION_OUTCOMES = ITEM_VALIDATION_OUTCOMES;

/** Worst-wins ordering for item outcomes. */
export const OUTCOME_SEVERITY: Record<ItemValidationOutcome, number> = {
  PASS: 0,
  REPAIRABLE: 1,
  REGENERATE: 2,
  BLOCK: 3,
};

/**
 * BATCH-level disposition (doc 14 C3.1 §C). A single item failing does NOT by
 * default poison the batch — but a serious generator-contract violation does.
 *   DELIVER          — every slot valid, deliver as is.
 *   REPAIR           — only local, safe-to-repair findings (missing solution / rubric).
 *   REGENERATE_SLOTS — regenerate the affected / missing slots, keep the good ones.
 *   QUARANTINE       — contract violated (invented id, unsafe, schema corruption,
 *                      forbidden knowledge); reject the whole batch, regenerate fresh.
 */
export const BATCH_DISPOSITIONS = ['DELIVER', 'REPAIR', 'REGENERATE_SLOTS', 'QUARANTINE'] as const;
export type BatchDisposition = (typeof BATCH_DISPOSITIONS)[number];

/** Reason codes that mean the generator broke its contract → QUARANTINE the batch. */
export const CONTRACT_VIOLATION_CODES = [
  'SCHEMA_INVALID',
  'UNKNOWN_SKILL_ID',
  'UNKNOWN_REQUIRED_SKILL_ID',
  'SKILL_NOT_IN_SPEC',
  'UNLEARNED_REQUIRED_KNOWLEDGE',
  'ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED',
  'UNSAFE_CONTENT',
  'NOT_AGE_APPROPRIATE',
  'TARGET_ROLE_MISMATCH',
  'FRONTIER_SKILL_NOT_SELECTED',
  'REQUIRED_SKILL_OUT_OF_BOUNDS',
] as const;

export const EXERCISE_VALIDATION_REASON_CODES = [
  // schema / completeness
  'SCHEMA_INVALID',
  'MISSING_ANSWER',
  'MISSING_SOLUTION',
  'MISSING_RUBRIC',
  'HINT_LADDER_MALFORMED',
  // identity (non-negotiable — AI may not invent IDs)
  'UNKNOWN_SKILL_ID',
  'UNKNOWN_REQUIRED_SKILL_ID',
  'SKILL_NOT_IN_SPEC',
  'UNKNOWN_PROBLEM_TYPE',
  'PROBLEM_TYPE_SKILL_MISMATCH',
  // target-role consistency (doc 14 C4.1 §8)
  'TARGET_ROLE_MISMATCH',
  'FRONTIER_SKILL_NOT_SELECTED',
  'REQUIRED_SKILL_OUT_OF_BOUNDS',
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
  /** Byte-identical to a Reference Library grounding example (doc 14 C5.2 §D) — hard gate, rate must be 0. */
  'REFERENCE_EXACT_COPY',
  /** Same template as a grounding example, only numbers/casing changed (doc 14 C5 §7 / C5.2 §D) — regenerate. */
  'REFERENCE_EXAMPLE_COPY',
  'UNSAFE_CONTENT',
  'NOT_AGE_APPROPRIATE',
  'LANGUAGE_MISMATCH',
  'DISTRIBUTION_MISMATCH',
] as const;
export type ExerciseValidationReasonCode = (typeof EXERCISE_VALIDATION_REASON_CODES)[number];

export interface ExerciseFinding {
  readonly code: ExerciseValidationReasonCode;
  readonly outcome: ItemValidationOutcome;
  /** Item ids this finding is about (empty for batch-level findings). */
  readonly questionIds: readonly string[];
  readonly detail: string;
  readonly repairInstruction?: string;
}

export interface BatchValidationResult {
  /** Batch-level disposition (doc 14 C3.1 §C). */
  readonly batchDisposition: BatchDisposition;
  /**
   * TRUE only when every slot is valid AND the count matches the spec — the app
   * does NOT deliver a partial worksheet silently.
   */
  readonly deliverable: boolean;
  /** Per-item worst outcome, keyed by item id. */
  readonly itemOutcomes: Readonly<Record<string, ItemValidationOutcome>>;
  readonly validatorVersion: string;
  /** Items that passed EVERY check — the only ones that may reach an Assignment. */
  readonly acceptedItems: readonly GeneratedExercise[];
  readonly findings: readonly ExerciseFinding[];
  readonly reasonCodes: readonly ExerciseValidationReasonCode[];
  /** How many more items the caller should regenerate to honour the spec. */
  readonly shortfall: number;
  /** @deprecated worst item outcome; use `batchDisposition`. */
  readonly outcome: ItemValidationOutcome;
}

/**
 * Generation rollout mode (doc 14 C5 §11). A per-deployment / per-child flag —
 * NEVER selected by parent goal or plan tier.
 *   OFF    — legacy practice only, no AI generation runs at all.
 *   SHADOW — legacy practice is what the child sees; AI generation runs in
 *            parallel and NEVER enters the child-visible Assignment.
 *   LIVE   — reserved for a future phase; must stay disabled until approved.
 */
export const AI_GENERATION_MODES = ['OFF', 'SHADOW', 'LIVE'] as const;
export type AiGenerationMode = (typeof AI_GENERATION_MODES)[number];

/**
 * How sure we are the ANSWER on a generated item is actually correct (doc 14 C5
 * §9 + C5.1 §1) — separate from `ItemValidationOutcome`, which only checks
 * contract SHAPE. An AI-provided solution is never assumed correct, and a
 * well-formed answer key is NOT a correct one.
 *
 *   FORMAT_VERIFIED
 *     — the answer key is well-formed and self-consistent (options contain the
 *       correct choice, denominator ≠ 0, value finite, …) but NOTHING has
 *       independently established that it is the RIGHT answer.
 *   DETERMINISTIC_CORRECTNESS_VERIFIED
 *     — an independent deterministic checker re-derived the answer from the
 *       problem and it matches (only for the narrow arithmetic families the
 *       math verifier supports — doc 14 C5.1 §2).
 *   AI_CROSSCHECK_REQUIRED
 *     — no deterministic path exists for this answer kind (reasoning/proof, or
 *       the math verifier could not parse the problem); a second-pass AI or a
 *       human must confirm it before it can be trusted.
 *   AI_CROSSCHECK_PASSED / AI_CROSSCHECK_FAILED
 *     — RESERVED (doc 14 C5.2 §E). NOT produced in C5.1/C5.2 — a second-pass AI
 *       verifier is not implemented. When it is, an AI cross-check outcome MUST
 *       use these DISTINCT states; it must NEVER be reported as
 *       `DETERMINISTIC_CORRECTNESS_VERIFIED`. Only independent deterministic
 *       verification or `HUMAN_GOLDEN_VERIFIED` may back a true
 *       correctness-ground-truth metric.
 *   HUMAN_GOLDEN_VERIFIED
 *     — a human reviewer confirmed this exact item.
 *   UNVERIFIED
 *     — the answer key is malformed, OR the deterministic checker proved it
 *       WRONG, OR nothing has run yet.
 *
 * LOCKED INVARIANT (C5.2 §E): FORMAT_VERIFIED ≠ DETERMINISTIC_CORRECTNESS_VERIFIED.
 * Schema validity alone never counts as answer verification. An AI cross-check
 * is never deterministic correctness.
 */
export const ANSWER_VERIFICATION_LEVELS = [
  'FORMAT_VERIFIED',
  'DETERMINISTIC_CORRECTNESS_VERIFIED',
  'AI_CROSSCHECK_REQUIRED',
  'AI_CROSSCHECK_PASSED',
  'AI_CROSSCHECK_FAILED',
  'HUMAN_GOLDEN_VERIFIED',
  'UNVERIFIED',
] as const;
export type AnswerVerificationLevel = (typeof ANSWER_VERIFICATION_LEVELS)[number];

/** Levels that may back a TRUE correctness-ground-truth metric (C5.2 §E). AI cross-check is NOT one. */
export const CORRECTNESS_GROUND_TRUTH_LEVELS = ['DETERMINISTIC_CORRECTNESS_VERIFIED', 'HUMAN_GOLDEN_VERIFIED'] as const;

// ======================================================================
// RELIABILITY REDESIGN (doc 56) — item-level generation
// ----------------------------------------------------------------------
// The C5 batch pipeline above asked one model call to emit a whole
// worksheet AND echo every deterministic field (skillId, requiredSkillIds,
// bucket, K, T, origin, …). That produced two failure classes — semantic
// (reference copying) and contract (missing `origin` / empty
// `requiredSkillIds` on large batches). The redesign removes ALL
// educational authority from the model: deterministic code owns every
// structural field, the model returns only CONTENT, and generation runs
// 1–2 items per call so one bad item never discards good ones.
// ======================================================================

/** The answer family an item uses. Pinned deterministically → the model's output schema has no union. */
export const ANSWER_KINDS = ['numeric', 'fraction', 'choice', 'exact', 'reasoning'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Controlled vocabulary for how a problem is shaped (doc 56 §5 — ProblemDNA). */
export const PROBLEM_STRUCTURES = [
  'direct_computation',
  'single_step_word_problem',
  'multi_step_word_problem',
  'compare_and_decide',
  'work_backwards',
  'explain_or_justify',
  'find_the_error',
  'construct_an_example',
] as const;
export type ProblemStructure = (typeof PROBLEM_STRUCTURES)[number];

/**
 * How the item's answer is expected to be checkable — set by deterministic
 * policy from the answer kind + problem structure, never by the model.
 *   DETERMINISTIC_EXPECTED — a closed numeric/fraction/exact answer the math
 *                            verifier should be able to re-derive; a failure to
 *                            verify is a real finding.
 *   AI_OR_HUMAN_CROSSCHECK — reasoning / multi-step word problems where no
 *                            deterministic path exists; the item is accepted at
 *                            an honest lower verification level, never claimed
 *                            deterministically correct.
 */
export const ANSWER_VERIFICATION_POLICIES = ['DETERMINISTIC_EXPECTED', 'AI_OR_HUMAN_CROSSCHECK'] as const;
export type AnswerVerificationPolicy = (typeof ANSWER_VERIFICATION_POLICIES)[number];

/**
 * ItemGenerationSpec (doc 56 §1/§4) — the deterministic PER-ITEM contract. Every
 * educational-authority field is populated by application code from the
 * `ExerciseGenerationSpec` + KB BEFORE any AI call. `composeExercise` reattaches
 * these verbatim to the model's content. The model never owns any field here.
 */
export interface ItemGenerationSpec {
  readonly itemId: string; // deterministic, assigned by buildItemGenerationSpecs
  readonly generationSpecId: string;
  readonly index: number; // 0-based worksheet position
  readonly skillId: SkillId;
  readonly targetRole: TargetRole;
  readonly bucket: keyof ExerciseDistribution;
  readonly domain: string;
  readonly curriculumNodeId: string;
  readonly curriculumOrigin: number;
  readonly schoolGrade: GradeContext;
  /** Exact levels — deterministically chosen inside the spec's K/T range (§1). */
  readonly knowledgeLevel: KnowledgeLevel;
  readonly thinkingLevel: ThinkingLevel;
  readonly problemStructure: ProblemStructure;
  /** The answer family the item MUST use — pins the strict output schema (§3). */
  readonly answerKind: AnswerKind;
  readonly problemTypeId: ProblemTypeId | null;
  /** Skills actually required to solve — deterministic, from the prereq DAG (§1). */
  readonly requiredSkillIds: readonly SkillId[];
  readonly supportingSkillIds: readonly SkillId[];
  /** Curriculum-safety facts pre-computed so compose / validation need no re-derivation. */
  readonly curriculumSafety: {
    readonly noUnlearnedRequiredKnowledge: boolean;
    readonly allowAboveGradeKnowledge: boolean;
    readonly blockingPrerequisiteSkillIds: readonly SkillId[];
  };
  readonly constraints: {
    readonly language: 'vi';
    readonly notation: 'SGK';
    readonly hintRungs: 6;
    readonly ageAppropriate: boolean;
    readonly maxSolutionComplexity: 'low' | 'standard' | 'high';
  };
  readonly answerVerificationPolicy: AnswerVerificationPolicy;
}

/**
 * GeneratedItemContent (doc 56 §2) — the ONLY thing the model returns. No
 * skillId, no K/T, no bucket, no ids beyond the echoed `itemId`. `answer` is a
 * plain string that deterministic `composeExercise` coerces to the pinned
 * `AnswerKind`; `distractors` only for a `choice` item.
 */
export interface GeneratedItemContent {
  readonly itemId: string;
  readonly prompt: string;
  readonly answer: string; // "" for a reasoning item
  readonly distractors?: readonly string[];
  readonly hints: readonly string[]; // 6 rungs
  readonly workedSolution: string;
  readonly rubric?: string; // reasoning items
}

/**
 * ProblemDNA (doc 56 §5) — the de-anchored generation grounding for ONE item.
 * STRUCTURE, not reference wording: the generator normally never sees a raw
 * reference prompt. A pure function of (ItemGenerationSpec, KB, references).
 */
export interface ProblemDNA {
  readonly itemId: string;
  readonly generationSpecId: string;
  readonly language: 'vi';
  readonly skill: {
    readonly id: SkillId;
    readonly name: string;
    readonly domain: string;
    readonly description: string;
  };
  readonly problemStructure: ProblemStructure;
  readonly operationStructure: readonly string[];
  readonly difficulty: {
    readonly knowledgeLevel: KnowledgeLevel;
    readonly knowledgeMeaning: string;
    readonly thinkingLevel: ThinkingLevel;
    readonly thinkingMeaning: string;
  };
  readonly thinkingRequirement: string;
  readonly answerKind: AnswerKind;
  readonly constraints: ItemGenerationSpec['constraints'] & {
    readonly numberRange?: { readonly min: number; readonly max: number };
  };
  readonly allowedVariationAxes: readonly string[];
  readonly forbiddenSimilarities: {
    /** Scenario nouns / contexts seen in references — do not reuse. */
    readonly scenarios: readonly string[];
    /** Number multisets from references — do not reproduce exactly. */
    readonly numberTuples: readonly (readonly number[])[];
    /** Structural skeletons (numbers + nouns blanked) from references — do not match. */
    readonly templateSkeletons: readonly string[];
  };
  /** Abstract style guidance — NEVER raw prompt text. */
  readonly styleHints: readonly string[];
  /**
   * A raw reference prompt is attached ONLY here, ONLY with an explicit
   * justification + elevated leakage-risk acknowledgement (doc 56 §5). Default null.
   */
  readonly rawReference:
    | { readonly prompt: string; readonly justification: string; readonly leakageRisk: 'ELEVATED' }
    | null;
  /**
   * The deterministic MathKernel for this item (doc 58). When present, the AI
   * MUST reproduce `requiredNumbersInPrompt` and `expectedAnswer` exactly — it
   * only writes the scenario / wording. `null` → open item, the AI supplies the
   * answer and it stays `AI_CROSSCHECK_REQUIRED`.
   */
  readonly mathKernel: MathKernel | null;
  readonly dnaHash: string;
}

/** The hard quality gates every generated item must pass (doc 56 §10). No partial bypass. */
export const ITEM_ACCEPTANCE_GATES = [
  'SCHEMA_VALID',
  'SKILL_ALIGNED',
  'CURRICULUM_SAFE',
  'PREREQUISITE_SAFE',
  'ANSWER_VERIFIED', // where deterministically supported
  'SIMILARITY_OK',
  'UNIQUENESS_OK',
  'K_LEVEL_OK',
  'T_LEVEL_OK',
] as const;
export type ItemAcceptanceGate = (typeof ITEM_ACCEPTANCE_GATES)[number];

export interface ItemGateResult {
  readonly gate: ItemAcceptanceGate;
  readonly pass: boolean;
  readonly detail: string;
  /** A deterministic, generator-facing instruction for a retry (never validator free-text). */
  readonly regenerationInstruction?: string;
}

/**
 * Answer status for the two-tier acceptance model (doc 56 §ANSWER VERIFICATION
 * POLICY). An item can pass CONTENT acceptance while its answer is only
 * PENDING_CROSSCHECK for production.
 *   DETERMINISTIC_CORRECT — an independent checker re-derived the answer → OK
 *   DETERMINISTIC_WRONG   — an independent checker proved it wrong → HARD FAIL
 *   CROSSCHECK_REQUIRED   — no deterministic path (reasoning, or the verifier
 *                           can't parse a valid problem) → content OK, NOT
 *                           production-ready until an AI/human confirms it
 *   SEMANTIC_UNKNOWN      — the answer is not proven wrong, but a bounded
 *                           semantic-preservation check could not prove the
 *                           prose preserves the kernel's meaning → NOT accepted,
 *                           retry / escalation eligible (doc 62 §3). Distinct
 *                           from DETERMINISTIC_WRONG: the model may be right.
 *   MALFORMED             — the answer key itself is not well-formed → HARD FAIL
 */
export const ITEM_ANSWER_STATUSES = [
  'DETERMINISTIC_CORRECT',
  'DETERMINISTIC_WRONG',
  'CROSSCHECK_REQUIRED',
  'SEMANTIC_UNKNOWN',
  'MALFORMED',
] as const;
export type ItemAnswerStatus = (typeof ITEM_ANSWER_STATUSES)[number];

/** Three-way verdict of the bounded semantic-preservation check (doc 62 §3). */
export const SEMANTIC_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type SemanticVerdict = (typeof SEMANTIC_VERDICTS)[number];

// ======================================================================
// ANSWER VERIFICATION ARCHITECTURE (doc 58) — deterministic MathKernel
// ----------------------------------------------------------------------
// A deterministic layer between ItemGenerationSpec and AI content
// generation. The kernel OWNS the mathematically authoritative facts
// (operands, operation graph, expected answer, units). The AI turns the
// kernel into prose (scenario, wording, distractors, hints, solution) and
// may NOT change any authoritative fact. When a kernel exists, an item is
// production-ready only if its answer matches `kernel.expectedAnswer`.
// ======================================================================

/**
 * Math family a `MathKernel` implements. `null` (no kernel) → the item is
 * `AI_CROSSCHECK_REQUIRED`, an acceptable intermediate but not production-ready.
 * A — fully deterministic; B — deterministic math, prose framing varies;
 * C — open / reasoning, no kernel.
 */
export const MATH_KERNEL_FAMILIES = [
  'INT_ARITH', // A — closed integer expression (+ - × :), 1-3 ops
  'DISTRIBUTIVE', // A — a×(b+c) = a×b + a×c
  'SUM_DIFF', // A — two numbers from sum + difference
  'UNIT_RATE', // A — N units → M units at a fixed rate
  'FRACTION_ARITH', // A — a/b (op) c/d, simplified
  'RATIO_SHARE', // A — divide a quantity in a ratio
  'LINEAR_EQ', // A — ax + b = c → x
  'ANGLE_SUM', // A — third angle of a triangle
  'ANGLE_TYPE', // A — classify an angle by its measure (choice)
  'PERCENT', // A — p% of N
  'UNIT_CONVERSION', // A — convert a measure between units
  'RECT_GEOMETRY', // A — perimeter / area of a rectangle
  'WORD_1STEP', // B — one arithmetic operation wrapped in a scenario
  'WORD_2STEP', // B — two chained operations, deterministic graph
] as const;
export type MathKernelFamily = (typeof MATH_KERNEL_FAMILIES)[number];

export const MATH_KERNEL_GROUP: Record<MathKernelFamily, 'A' | 'B'> = {
  INT_ARITH: 'A',
  DISTRIBUTIVE: 'A',
  SUM_DIFF: 'A',
  UNIT_RATE: 'A',
  FRACTION_ARITH: 'A',
  RATIO_SHARE: 'A',
  LINEAR_EQ: 'A',
  ANGLE_SUM: 'A',
  ANGLE_TYPE: 'A',
  PERCENT: 'A',
  UNIT_CONVERSION: 'A',
  RECT_GEOMETRY: 'A',
  WORD_1STEP: 'B',
  WORD_2STEP: 'B',
};

/** The mathematically authoritative answer the AI must reproduce. */
export type KernelAnswer =
  | { readonly kind: 'numeric'; readonly value: number; readonly tolerance: number }
  | { readonly kind: 'fraction'; readonly numerator: number; readonly denominator: number }
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'choice'; readonly correct: string; readonly distractors: readonly string[] };

export interface KernelOperand {
  readonly name: string; // 'a', 'S', 'length', …
  readonly value: number;
  readonly unit?: string;
}

/**
 * The bounded, deterministic operation semantics a kernel-covered item MUST
 * realize (doc 58 §3). Prevents "all the numbers are present but the prose
 * means a different operation" (`36 / 9` → "36 items plus another 9"). NOT NLP:
 * a small keyword contract per operation.
 */
export const KERNEL_OPERATIONS = [
  'ADDITION',
  'SUBTRACTION',
  'MULTIPLICATION',
  'DIVISION',
  'MIXED', // a closed multi-operation expression
  'CLASSIFY',
  'PROPORTION',
  'SOLVE_EQUATION',
  'CONVERT',
] as const;
export type KernelOperation = (typeof KERNEL_OPERATIONS)[number];

export const KERNEL_SCENARIO_TYPES = [
  'CLOSED_EXPRESSION',
  'COMBINE',
  'REMOVE',
  'EQUAL_SHARING',
  'SCALING',
  'RATE',
  'FIND_UNKNOWN',
  'CLASSIFY',
  'CONVERT',
  'GEOMETRY',
] as const;
export type KernelScenarioType = (typeof KERNEL_SCENARIO_TYPES)[number];

export interface KernelSemantics {
  readonly operation: KernelOperation;
  readonly scenarioType: KernelScenarioType;
  /** role name → operand value, e.g. { total: 36, groupCount: 9 }. */
  readonly operandRoles: Readonly<Record<string, number>>;
  /** which quantity the item asks for, e.g. 'quantityPerGroup'. */
  readonly askedQuantityRole: string;
}

/**
 * MathKernel (doc 58 §2) — the deterministic ProblemInstance. Pure output of
 * (ItemGenerationSpec, deterministic RNG, uniqueness/forbidden constraints).
 * Generated BEFORE any AI call. Everything here is authoritative.
 */
export interface MathKernel {
  readonly family: MathKernelFamily;
  readonly problemTypeId: string | null;
  readonly answerKind: AnswerKind; // authoritative — overrides the itemSpec's pin
  readonly operands: readonly KernelOperand[];
  /** Deterministic step graph, e.g. ["S = a + b", "x = (S + D) / 2"]. */
  readonly operationGraph: readonly string[];
  readonly intermediateValues: Readonly<Record<string, number>>;
  readonly expectedAnswer: KernelAnswer;
  /** An expression the deterministic evaluator can re-check, when the family has one. */
  readonly canonicalVerificationExpression: string | null;
  readonly units: string | null;
  /** Numbers the AI MUST include verbatim in the prompt (the given data). */
  readonly requiredNumbersInPrompt: readonly number[];
  /** The bounded operation-semantics contract (doc 58 §3). */
  readonly semantics: KernelSemantics;
  readonly constraints: {
    readonly integerResult: boolean;
    readonly fractionSimplified: boolean;
    readonly numberRange: { readonly min: number; readonly max: number };
  };
  /** A deterministic Vietnamese step summary — the AI's worked solution must not contradict it. */
  readonly solutionOutline: string;
  readonly kernelHash: string;
}

export type MathKernelResult =
  | { readonly ok: true; readonly kernel: MathKernel }
  | { readonly ok: false; readonly reason: string };

/** Reason codes for a kernel-consistency contradiction (doc 58 §6). Any → HARD FAIL. */
export const KERNEL_CONSISTENCY_CODES = [
  'ANSWER_MISMATCH', // returned answer ≠ kernel.expectedAnswer
  'KERNEL_NUMBER_DROPPED', // a required given number is missing from the prompt
  'OPERAND_MUTATION', // a given number appears CHANGED (arithmetic altered)
  'UNIT_INCONSISTENT',
  'SEMANTIC_STRUCTURE_MISMATCH', // the prose implies a different operation (doc 58 §3)
  'SOLUTION_CONTRADICTS_KERNEL',
  'DISTRACTOR_INCLUDES_ANSWER',
  'PROMPT_NOT_SOLVABLE',
] as const;
export type KernelConsistencyCode = (typeof KERNEL_CONSISTENCY_CODES)[number];

export interface KernelConsistencyResult {
  readonly consistent: boolean;
  readonly codes: readonly KernelConsistencyCode[];
  readonly detail: string;
  /**
   * Overall verdict of the reconciliation layer (doc 62). PASS = every check
   * proven consistent. FAIL = a deterministic contradiction (→ DETERMINISTIC_WRONG).
   * UNKNOWN = no contradiction proven, but a prose-preservation check could not
   * be resolved either way (→ SEMANTIC_UNKNOWN, retry/escalate). Absent on the
   * back-compat path = derive from `consistent`.
   */
  readonly semanticVerdict?: SemanticVerdict;
  /** reconcilable codes the normalizer PROVED consistent (informational). */
  readonly reconciled?: readonly string[];
}

/** AI answer-crosscheck verdict (doc 58 §8). FALLBACK only — never the default path. */
export const CROSSCHECK_VERDICTS = ['PASS', 'FAIL', 'UNCERTAIN'] as const;
export type CrosscheckVerdict = (typeof CROSSCHECK_VERDICTS)[number];

export interface ItemAcceptanceResult {
  readonly itemId: string;
  /**
   * CONTENT acceptance — every gate passes (ANSWER_VERIFIED here means "not
   * malformed AND not proven wrong"; an unverifiable-but-valid answer passes).
   * Kept as `accepted` for back-compat with the C4 pipeline.
   */
  readonly accepted: boolean;
  /**
   * PRODUCTION-READY — content-accepted AND the answer is independently
   * verified correct. A content-accepted item that is only
   * `CROSSCHECK_REQUIRED` is PENDING_CROSSCHECK, not production-ready.
   */
  readonly productionReady: boolean;
  readonly answerStatus: ItemAnswerStatus;
  readonly gates: readonly ItemGateResult[];
  readonly failedGates: readonly ItemAcceptanceGate[];
  readonly answerVerificationLevel: AnswerVerificationLevel;
}
