import type { ChildId, SkillId } from './identifiers.js';
import type { Domain } from './taxonomy.js';

/**
 * TeacherContribution — an append-only context event. May be authored by a teacher
 * OR by a parent entering it on the teacher's behalf. It is an *indirect* evidence
 * source (it tells us what was taught), never a direct mastery signal.
 */
export interface TeacherContribution {
  readonly id: string;
  readonly childId: ChildId;
  readonly contributedAs: 'teacher' | 'parent';
  readonly actorUserId: string;
  readonly occurredOn: string; // ISO date (day granularity)
  readonly recordedAt: string; // ISO
  readonly taughtSkillIds: readonly SkillId[];
  readonly problemTypeIds: readonly SkillId[];
  readonly homeworkRefs: readonly string[];
  readonly examRef?: { readonly date: string; readonly scopeNote?: string };
}

/** How a learning-context position was established (Pricing v1.1 §2, doc 13). */
export const LEARNING_CONTEXT_SOURCES = [
  'TEACHER_UPDATE',
  'PARENT_UPDATE',
  'SCHOOLWORK_EVIDENCE',
  'CURRICULUM_TIMELINE',
] as const;
export type LearningContextSource = (typeof LEARNING_CONTEXT_SOURCES)[number];

export const LEARNING_CONTEXT_CONFIDENCE = ['VERIFIED', 'STRONG', 'SUPPORTING', 'ESTIMATED'] as const;
export type LearningContextConfidence = (typeof LEARNING_CONTEXT_CONFIDENCE)[number];

/** A range of plausible lessons (Curriculum Clock — doc 13 §1). */
export interface ExpectedLessonWindow {
  readonly fromLessonId: string;
  readonly toLessonId: string;
  readonly widthLessons: number;
  readonly lessonIds: readonly string[];
}

/** Which calendar row produced an estimate, and how trustworthy it is (doc 13 §3). */
export interface CalendarProvenance {
  readonly calendarId: string;
  readonly version: number;
  readonly status: 'PROVISIONAL' | 'VERIFIED';
  readonly source: string;
  readonly academicYear: string;
}

/** The calendar-based estimate of where the class *should* be (Curriculum Clock). */
export interface ExpectedLearningContext {
  readonly curriculum: string;
  readonly chapterId: number;
  /** Most likely single lesson — NOT authoritative alone (never shown as fact). */
  readonly lessonId: string;
  readonly alsoPlausibleLessonIds: readonly string[];
  /** The plausible range; the resolver narrows this as evidence arrives. */
  readonly window: ExpectedLessonWindow;
  readonly source: 'CURRICULUM_TIMELINE';
  readonly confidence: 'ESTIMATED';
  readonly asOfDate: string; // ISO date
  readonly paceDeltaApplied: number;
  readonly calendar: CalendarProvenance;
}

/** The single resolved answer the planner uses (LearningContextResolver). */
export interface ResolvedLearningContext {
  readonly chapterId: number | null;
  readonly lessonId: string | null;
  readonly activeSkillIds: readonly SkillId[];
  readonly source: LearningContextSource;
  readonly confidence: LearningContextConfidence;
  /** Timestamp of the strongest confirming signal; null when only an estimate. */
  readonly lastVerifiedAt: string | null;
  /**
   * Narrowed window the class is in — starts as the clock window, tightens
   * around confirmed/observed lessons (doc 13 §1).
   */
  readonly window: readonly string[];
  /** Which deterministic guardrail (if any) decided the outcome (doc 13 §2 A–F). */
  readonly guardrailApplied: string | null;
}

/**
 * An explicit context event — a parent/teacher confirming or correcting the
 * current lesson. Appended, never destructive; flows through the resolver like
 * any other signal (doc 13 §5, B3 requirement 5).
 */
export interface LessonConfirmationEvent {
  readonly id: string;
  readonly childId: ChildId;
  readonly lessonId: string;
  readonly topicNote?: string;
  readonly source: 'TEACHER_UPDATE' | 'PARENT_UPDATE';
  readonly confidence: LearningContextConfidence;
  readonly confirmedBy: string; // user id
  readonly confirmedAt: string; // ISO
}

/**
 * LearningContext — "what is the child learning right now".
 * MUST build even with zero teacher contributions AND zero parent input — the
 * Curriculum Clock supplies an `ESTIMATED` baseline (Pricing v1.1 §2).
 */
export interface LearningContext {
  readonly childId: ChildId;
  readonly builtAt: string; // ISO
  /** Calendar estimate (Curriculum Clock). */
  readonly expected: ExpectedLearningContext | null;
  /** Reliability-weighted merge of estimate + all observed evidence (Context Resolver). */
  readonly resolved: ResolvedLearningContext;
  /** Learned class-pace adjustment currently APPLIED to the clock, −0.35..0.35. */
  readonly paceDelta: number;
  /**
   * A pace adjustment the resolver SUGGESTS from repeated consistent evidence
   * (invariant C). Not applied until confirmed / persisted — surfaced for review.
   */
  readonly paceDeltaHypothesis: {
    readonly value: number;
    readonly observationCount: number;
    /** Distinct school weeks the observations span. */
    readonly spanWeeks: number;
    readonly rationale: string;
  };
  /**
   * @deprecated migration alias for `expected` — whole-grade scope.
   * Removed once all consumers read `expected`/`resolved` (doc 17 Group B/C).
   */
  readonly standardPosition: CurriculumPosition;
  /** @deprecated migration alias for `resolved`. */
  readonly actualTaughtPosition: CurriculumPosition;
  /** Per-domain exposure frontier — NEVER a single global grade level. */
  readonly frontier: readonly FrontierEntry[];
  /** Skills with fresh evidence, most-recent first — the "đang học" list. */
  readonly activeSkillIds: readonly SkillId[];
  /** True when no teacher contribution fed this context (surfaced in UI as a nudge). */
  readonly teacherParticipated: boolean;
  /** Sources that disagree on what's being taught → parent review (UI/UX Spec §17 Conflict). */
  readonly conflicts: readonly ContextConflict[];
}

export interface CurriculumPosition {
  readonly skillIds: readonly SkillId[];
  readonly note?: string;
}

export interface FrontierEntry {
  readonly domain: Domain;
  /** Free-form exposure label, e.g. "G7_advanced", "G8_G9_HSG_exposure". */
  readonly frontierLabel: string;
  readonly evidenceCount: number;
}

export interface ContextConflict {
  readonly skillId: SkillId;
  readonly reason: string;
  readonly sources: readonly string[];
}
