import type { ChildId, ProblemTypeId, SkillId } from './identifiers.js';
import type { Domain, ThinkingDimension, ThinkingLevel } from './taxonomy.js';

/**
 * Child Learning Twin — a derived, fully recomputable view of learner state.
 * NOT persisted as a table; rebuilt from the append-only evidence stream. Rebuilding
 * from the same evidence MUST yield an identical twin (idempotent recompute).
 *
 * Three axes are kept strictly separate (core invariant):
 *   skill mastery  ≠  problem-type mastery  ≠  thinking profile.
 * There is deliberately NO single "level" field — the frontier is per-domain.
 */
export interface ChildLearningTwin {
  readonly childId: ChildId;
  readonly computedAt: string; // ISO
  /** How many evidence records fed this build — lets callers detect staleness. */
  readonly computedFromEvidenceCount: number;
  readonly skillMastery: ReadonlyMap<SkillId, SkillMasteryState>;
  readonly problemTypeMastery: ReadonlyMap<ProblemTypeId, MasteryState>;
  readonly thinkingProfile: ReadonlyMap<ThinkingDimension, ThinkingDimensionState>;
  readonly frontier: readonly DomainFrontier[];
}

/** A mastery estimate in [0,100] plus how much to trust it. */
export interface MasteryState {
  readonly mastery: number; // 0..100 — weighted, multi-signal (NOT raw accuracy)
  readonly confidence: number; // 0..1 — trust in the estimate (evidence weight + consistency)
  readonly evidenceCount: number;
  readonly lastObservedAt: string | null; // ISO
}

export interface SkillMasteryState extends MasteryState {
  /** How well it is likely retained *now* (decays with time since last verification). */
  readonly retention: number; // 0..1
  /** Recent same-skill error streak — a signal the gap engine (Phase 4) consumes. */
  readonly recentErrorStreak: number;
  readonly lastVerifiedAt: string | null; // ISO — last A/B-tier confirming evidence
}

export interface ThinkingDimensionState {
  /** Highest thinking level with positive evidence on items exercising this dimension. */
  readonly demonstratedLevel: ThinkingLevel | null;
  readonly score: number; // 0..100 — weighted success on dimension-exercising items
  readonly confidence: number; // 0..1
  readonly evidenceCount: number;
}

export interface DomainFrontier {
  readonly domain: Domain;
  /** e.g. "grade_7_standard", "above_grade_G8_exposure" — DISPLAY ONLY, never parsed by logic. */
  readonly frontierLabel: string;
  /** Grade origin of the most advanced skill the child shows real traction on. */
  readonly reachedCurriculumOrigin: number;
  readonly aboveGrade: boolean;
  readonly evidenceCount: number;
  /** 0..1 — how much to trust this frontier (mastery consistency × evidence weight). */
  readonly confidence: number;
  /** Skills in this domain the child has mastered, most curriculum-advanced first. */
  readonly masteredSkillIds: readonly SkillId[];
  /** Mastered skills whose dependents' other prerequisites are also satisfied — the safe "next step". */
  readonly readyNextSkillIds: readonly SkillId[];
  /** Skills with some positive evidence but not yet mastered (exposure, not traction). */
  readonly exposureSkillIds: readonly SkillId[];
}
