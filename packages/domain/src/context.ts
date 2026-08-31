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

/**
 * LearningContext — "what is the child learning right now", assembled from evidence.
 * MUST build even with zero teacher contributions (parent-only path).
 */
export interface LearningContext {
  readonly childId: ChildId;
  readonly builtAt: string; // ISO
  /** Where the standard curriculum expects the child to be (from grade + calendar/evidence). */
  readonly standardPosition: CurriculumPosition;
  /** What has actually been taught recently, from teacher/parent/scan evidence. */
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
