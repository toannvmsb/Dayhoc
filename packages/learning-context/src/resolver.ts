/**
 * LearningContextResolver (Pricing/AI Cost/Routing v1.1 §2, doc 13 §3 + B3 §2).
 *
 * Merges the Curriculum Clock estimate with every observed context signal by
 *   reliability × confidence × recency × consistency × repetition
 * for scoring — but that is NEVER the only rule. Deterministic guardrails (A–F)
 * decide the outcome in the cases that matter. Pure and idempotent.
 */
import type {
  Evidence,
  ExpectedLearningContext,
  LearningContextConfidence,
  LearningContextSource,
  LessonConfirmationEvent,
  ResolvedLearningContext,
  SkillId,
  TeacherContribution,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { curriculumNodeOrder } from './pace.js';

const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 14;
/** A VERIFIED/STRONG context this recent is authoritative vs a bare estimate (invariant A). */
const RECENT_VERIFIED_DAYS = 21;
/** A VERIFIED signal older than this is "stale" — kept in history, weaker for scoring (invariant E). */
const STALE_VERIFIED_DAYS = 35;

const RELIABILITY: Record<string, number> = {
  teacher_update: 0.95,
  verified_test: 0.9,
  parent_update: 0.75,
  homework_scan: 0.7,
  notebook_scan: 0.65,
  teacher_message_scan: 0.6,
  app_practice: 0.5,
  curriculum_timeline: 0.35,
};

const CONFIDENCE_WEIGHT: Record<LearningContextConfidence, number> = {
  VERIFIED: 1,
  STRONG: 0.8,
  SUPPORTING: 0.6,
  ESTIMATED: 0.4,
};
const CONFIDENCE_RANK: Record<LearningContextConfidence, number> = {
  ESTIMATED: 0,
  SUPPORTING: 1,
  STRONG: 2,
  VERIFIED: 3,
};

interface Signal {
  readonly lessonId: string;
  readonly reliability: number;
  /** As reported by the signal. */
  readonly confidence: LearningContextConfidence;
  readonly source: LearningContextSource;
  readonly at: number; // epoch ms
  readonly typeKey: string;
  /** Is this an explicit human confirmation (vs observed schoolwork)? — invariant F. */
  readonly isConfirmation: boolean;
}

export interface ResolveInput {
  readonly expected: ExpectedLearningContext | null;
  readonly contributions: readonly TeacherContribution[];
  readonly lessonConfirmations?: readonly LessonConfirmationEvent[];
  readonly evidence: readonly Evidence[];
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf: Date;
  readonly recencyDays?: number;
  /**
   * The child's school grade. The "current class lesson" is a lesson of THIS
   * grade — cross-grade remediation work still feeds the twin/gap engine, but it
   * does not move the resolved learning context.
   */
  readonly gradeContext?: number;
}

export interface ResolveResult {
  readonly resolved: ResolvedLearningContext;
  /** Candidate lessons that materially disagreed at VERIFIED/STRONG strength. */
  readonly conflictLessonIds: readonly string[];
}

function lessonIdOfSkill(kb: KnowledgeBase, skillId: SkillId): string | null {
  return kb.skills.get(skillId)?.curriculumNodeId ?? null;
}

function evidenceTypeKey(e: Evidence): string {
  switch (e.source) {
    case 'teacher_feedback':
      return 'teacher_update';
    case 'school_test':
    case 'school_exam':
      return 'verified_test';
    case 'parent_feedback':
      return 'parent_update';
    case 'school_homework':
      return 'homework_scan';
    case 'notebook_scan':
      return 'notebook_scan';
    case 'teacher_message_scan':
      return 'teacher_message_scan';
    default:
      return 'app_practice';
  }
}

function evidenceConfidence(e: Evidence): LearningContextConfidence {
  return e.confidenceTier === 'A'
    ? 'VERIFIED'
    : e.confidenceTier === 'B'
      ? 'STRONG'
      : e.confidenceTier === 'C'
        ? 'SUPPORTING'
        : 'ESTIMATED';
}

function sourceOf(typeKey: string): LearningContextSource {
  if (typeKey === 'teacher_update') return 'TEACHER_UPDATE';
  if (typeKey === 'parent_update') return 'PARENT_UPDATE';
  if (typeKey === 'curriculum_timeline') return 'CURRICULUM_TIMELINE';
  return 'SCHOOLWORK_EVIDENCE';
}

function skillsForLesson(kb: KnowledgeBase, lessonId: string): SkillId[] {
  const out: SkillId[] = [];
  for (const s of kb.skills.values()) if (s.curriculumNodeId === lessonId) out.push(s.id as SkillId);
  return out;
}

function chapterIdOfLesson(lessonId: string, expected: ExpectedLearningContext | null): number | null {
  const m = /^C\.G\d+\.(\d+)\./.exec(lessonId);
  return m ? Number(m[1]) : (expected?.chapterId ?? null);
}

export function resolveLearningContext(input: ResolveInput): ResolveResult {
  const { expected, contributions, evidence, knowledgeBase: kb, asOf } = input;
  const now = asOf.getTime();
  const recencyDays = input.recencyDays ?? 45;
  const cutoff = now - recencyDays * DAY_MS;
  // the current class lesson is a lesson of the child's own grade
  const gradePrefix =
    input.gradeContext !== undefined
      ? `C.G${input.gradeContext}.`
      : (/^(C\.G\d+)\./.exec(expected?.lessonId ?? '')?.[1] ?? null);
  const inGrade = (lessonId: string): boolean => !gradePrefix || lessonId.startsWith(gradePrefix);

  const signals: Signal[] = [];

  // explicit lesson confirmations (parent/teacher) — invariant F: `isConfirmation`.
  // A teacher confirming the current lesson is VERIFIED context; a parent, STRONG.
  for (const c of input.lessonConfirmations ?? []) {
    const at = Date.parse(c.confirmedAt);
    if (Number.isNaN(at) || at < cutoff) continue;
    const typeKey = c.source === 'TEACHER_UPDATE' ? 'teacher_update' : 'parent_update';
    signals.push({
      lessonId: c.lessonId,
      reliability: RELIABILITY[typeKey]!,
      confidence: c.confidence,
      source: c.source,
      at,
      typeKey,
      isConfirmation: true,
    });
  }

  // teacher / parent "what was taught" contributions
  for (const c of contributions) {
    const at = Date.parse(`${c.occurredOn}T00:00:00Z`);
    if (at < cutoff) continue;
    const typeKey = c.contributedAs === 'teacher' ? 'teacher_update' : 'parent_update';
    for (const sid of c.taughtSkillIds) {
      const lessonId = lessonIdOfSkill(kb, sid);
      if (!lessonId || !inGrade(lessonId)) continue;
      signals.push({
        lessonId,
        reliability: RELIABILITY[typeKey]!,
        confidence: c.contributedAs === 'teacher' ? 'VERIFIED' : 'STRONG',
        source: sourceOf(typeKey),
        at,
        typeKey,
        isConfirmation: true,
      });
    }
  }

  // observed schoolwork / practice evidence
  for (const e of evidence) {
    if (!e.skillId) continue;
    const at = Date.parse(e.occurredAt);
    if (Number.isNaN(at) || at < cutoff) continue;
    const lessonId = lessonIdOfSkill(kb, e.skillId);
    if (!lessonId || !inGrade(lessonId)) continue; // cross-grade remediation ≠ current class lesson
    const typeKey = evidenceTypeKey(e);
    signals.push({
      lessonId,
      reliability: RELIABILITY[typeKey]!,
      confidence: evidenceConfidence(e),
      source: sourceOf(typeKey),
      at,
      typeKey,
      isConfirmation: false,
    });
  }

  // the calendar estimate is one more (weak) signal — its own primary lesson
  if (expected) {
    signals.push({
      lessonId: expected.lessonId,
      reliability: RELIABILITY.curriculum_timeline!,
      confidence: 'ESTIMATED',
      source: 'CURRICULUM_TIMELINE',
      at: Date.parse(`${expected.asOfDate}T00:00:00Z`),
      typeKey: 'curriculum_timeline',
      isConfirmation: false,
    });
  }

  // --- no real signal: the estimate stands, ESTIMATED ---
  const observed = signals.filter((s) => s.typeKey !== 'curriculum_timeline');
  if (observed.length === 0) {
    return {
      resolved: {
        chapterId: expected?.chapterId ?? null,
        lessonId: expected?.lessonId ?? null,
        activeSkillIds: [],
        source: 'CURRICULUM_TIMELINE',
        confidence: 'ESTIMATED',
        lastVerifiedAt: null,
        window: expected ? [...expected.window.lessonIds] : [],
        guardrailApplied: 'no_observed_evidence_estimate_only',
      },
      conflictLessonIds: [],
    };
  }

  // effective confidence for scoring — invariant E: stale VERIFIED → STRONG
  const effConf = (s: Signal): LearningContextConfidence =>
    s.confidence === 'VERIFIED' && now - s.at > STALE_VERIFIED_DAYS * DAY_MS ? 'STRONG' : s.confidence;

  // --- score candidate lessons ---
  const byLesson = new Map<string, { score: number; signals: Signal[] }>();
  const countByType = new Map<string, number>();
  for (const s of signals) countByType.set(s.typeKey, (countByType.get(s.typeKey) ?? 0) + 1);

  for (const s of signals) {
    const recency = Math.pow(0.5, (now - s.at) / (RECENCY_HALF_LIFE_DAYS * DAY_MS));
    const repetition = 1 + 0.1 * Math.min((countByType.get(s.typeKey) ?? 1) - 1, 3);
    const contribution = s.reliability * CONFIDENCE_WEIGHT[effConf(s)] * recency * repetition;
    const rec = byLesson.get(s.lessonId) ?? { score: 0, signals: [] };
    rec.score += contribution;
    rec.signals.push(s);
    byLesson.set(s.lessonId, rec);
  }
  for (const rec of byLesson.values()) {
    if (new Set(rec.signals.map((s) => s.typeKey)).size >= 2) rec.score *= 1.15; // consistency
  }

  const ranked = [...byLesson.entries()].sort((a, b) => b[1].score - a[1].score);
  let [chosenLessonId, chosen] = ranked[0]!;
  let guardrail: string | null = null;

  // --- invariant D: conflicting VERIFIED sources on different lessons ---
  const verifiedByLesson = new Map<string, Signal[]>();
  for (const s of signals) {
    if (effConf(s) === 'VERIFIED') {
      const arr = verifiedByLesson.get(s.lessonId) ?? [];
      arr.push(s);
      verifiedByLesson.set(s.lessonId, arr);
    }
  }
  const conflictLessonIds: string[] = [];
  if (verifiedByLesson.size >= 2) {
    // deterministic policy: the most recent VERIFIED wins; the others are a conflict
    const mostRecentVerified = [...verifiedByLesson.entries()]
      .map(([lid, ss]) => ({ lid, at: Math.max(...ss.map((s) => s.at)) }))
      .sort((a, b) => b.at - a.at)[0]!;
    chosenLessonId = mostRecentVerified.lid;
    chosen = byLesson.get(chosenLessonId)!;
    guardrail = 'D_conflicting_verified_most_recent_wins';
    for (const lid of verifiedByLesson.keys()) if (lid !== chosenLessonId) conflictLessonIds.push(lid);
  } else {
    // --- invariant A: a recent VERIFIED is never overridden by CURRICULUM_TIMELINE,
    //     nor by a top candidate whose signals are ALL the weakest (ESTIMATED) tier
    //     (B3-4: many low-confidence observations can't beat one recent VERIFIED). ---
    const recentVerified = signals
      .filter(
        (s) =>
          effConf(s) === 'VERIFIED' &&
          s.typeKey !== 'curriculum_timeline' &&
          now - s.at <= RECENT_VERIFIED_DAYS * DAY_MS,
      )
      .sort((a, b) => b.at - a.at)[0];
    const chosenIsWeak = chosen.signals.every(
      (s) => s.typeKey === 'curriculum_timeline' || effConf(s) === 'ESTIMATED',
    );
    const chosenHasVerified = chosen.signals.some((s) => effConf(s) === 'VERIFIED');
    if (recentVerified && chosenIsWeak && !chosenHasVerified) {
      chosenLessonId = recentVerified.lessonId;
      chosen = byLesson.get(chosenLessonId) ?? { score: 0, signals: [recentVerified] };
      guardrail = chosen.signals.every((s) => s.typeKey === 'curriculum_timeline')
        ? 'A_recent_verified_not_overridden_by_timeline'
        : 'A_recent_verified_beats_low_confidence_majority';
    }

    // soft conflict: a runner-up within 15% from a disjoint source set
    if (!guardrail && ranked[1]) {
      const [runnerId, runner] = ranked[1];
      const topSources = new Set(chosen.signals.map((s) => s.source));
      const runnerSources = new Set(runner.signals.map((s) => s.source));
      const disjoint = ![...runnerSources].some((x) => topSources.has(x));
      if (runner.score >= chosen.score * 0.85 && disjoint) {
        conflictLessonIds.push(runnerId);
        guardrail = 'soft_conflict_provisional_pick_more_advanced';
        // provisionally take the more advanced lesson (planner checks prereqs anyway)
        const order = expected?.window.lessonIds ?? [];
        if (order.indexOf(runnerId) > order.indexOf(chosenLessonId)) {
          chosenLessonId = runnerId;
          chosen = runner;
        }
      }
    }
  }

  // --- resolved confidence — invariant B: repetition can't manufacture VERIFIED ---
  const chosenSignals = chosen.signals.length > 0 ? chosen.signals : signals.filter((s) => s.lessonId === chosenLessonId);
  const maxReportedConf = chosenSignals.reduce<LearningContextConfidence>(
    (acc, s) => (CONFIDENCE_RANK[effConf(s)] > CONFIDENCE_RANK[acc] ? effConf(s) : acc),
    'ESTIMATED',
  );
  let resolvedConfidence = maxReportedConf;
  // invariant C: ≥3 consistent SUPPORTING signals may promote SUPPORTING → STRONG (one tier only)
  const supportingHere = chosenSignals.filter((s) => effConf(s) === 'SUPPORTING' && !s.isConfirmation);
  if (maxReportedConf === 'SUPPORTING' && supportingHere.length >= 3) resolvedConfidence = 'STRONG';

  // "source of record": the most authoritative signal pointing at the chosen lesson
  const authority = (s: Signal): number => s.reliability * CONFIDENCE_WEIGHT[effConf(s)];
  const strongest = [...chosenSignals].sort((a, b) => authority(b) - authority(a) || b.at - a.at)[0]!;

  const confirmingAts = chosenSignals
    .filter((s) => effConf(s) === 'VERIFIED' || effConf(s) === 'STRONG')
    .map((s) => s.at);
  const lastVerifiedAt =
    (resolvedConfidence === 'VERIFIED' || resolvedConfidence === 'STRONG') && confirmingAts.length > 0
      ? new Date(Math.max(...confirmingAts)).toISOString()
      : null;

  // --- narrow the window around the resolved lesson ---
  //   VERIFIED / a confirmation → exactly the resolved lesson;
  //   STRONG → ±1 lesson;  weaker → the clock window ∩ ±1 (or ±1 in grade order).
  const chosenGradePrefix = /^(C\.G\d+)\./.exec(chosenLessonId)?.[1] ?? '';
  const gradeOrder = chosenGradePrefix ? curriculumNodeOrder(kb, chosenGradePrefix) : [];
  const gi2 = gradeOrder.indexOf(chosenLessonId);
  let narrowed: string[];
  if (resolvedConfidence === 'VERIFIED' || strongest.isConfirmation) {
    narrowed = [chosenLessonId];
  } else if (resolvedConfidence === 'STRONG') {
    narrowed = gi2 >= 0 ? gradeOrder.slice(Math.max(0, gi2 - 1), gi2 + 2) : [chosenLessonId];
  } else {
    const clockWindow = new Set(expected?.window.lessonIds ?? []);
    const near = gi2 >= 0 ? gradeOrder.slice(Math.max(0, gi2 - 2), gi2 + 3) : [chosenLessonId];
    narrowed = clockWindow.size > 0 ? near.filter((l) => clockWindow.has(l) || l === chosenLessonId) : near;
  }

  return {
    resolved: {
      chapterId: chapterIdOfLesson(chosenLessonId, expected),
      lessonId: chosenLessonId,
      activeSkillIds: skillsForLesson(kb, chosenLessonId),
      source: strongest.source,
      confidence: resolvedConfidence,
      lastVerifiedAt,
      window: narrowed,
      guardrailApplied: guardrail,
    },
    conflictLessonIds,
  };
}

