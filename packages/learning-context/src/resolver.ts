/**
 * LearningContextResolver (Pricing/AI Cost/Routing v1.1 §2, doc 13 §3).
 *
 * Merges the Curriculum Clock estimate with every observed context signal
 * (teacher / parent update, homework / notebook / test scan, teacher message,
 * app practice) by SOURCE RELIABILITY × confidence × recency × consistency ×
 * repetition — NOT "latest record wins". Pure and deterministic.
 */
import type {
  Evidence,
  ExpectedLearningContext,
  LearningContextConfidence,
  LearningContextSource,
  ResolvedLearningContext,
  SkillId,
  TeacherContribution,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

const DAY_MS = 86_400_000;
/** Recency half-life for context signals. */
const RECENCY_HALF_LIFE_DAYS = 14;

/** Base reliability by signal type (doc 13 §3.1). */
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

interface Signal {
  readonly lessonId: string;
  readonly reliability: number;
  readonly confidence: LearningContextConfidence;
  readonly source: LearningContextSource;
  readonly at: number; // epoch ms
  readonly typeKey: string;
}

export interface ResolveInput {
  readonly expected: ExpectedLearningContext | null;
  readonly contributions: readonly TeacherContribution[];
  readonly evidence: readonly Evidence[];
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf: Date;
  /** Recent-evidence window (days). */
  readonly recencyDays?: number;
}

export interface ResolveResult {
  readonly resolved: ResolvedLearningContext;
  /** Candidate lessons that materially disagreed → parent review. */
  readonly conflictLessonIds: readonly string[];
}

function lessonIdOfSkill(kb: KnowledgeBase, skillId: SkillId): string | null {
  const skill = kb.skills.get(skillId);
  return skill?.curriculumNodeId ?? null;
}

function evidenceReliabilityKey(e: Evidence): string {
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

export function resolveLearningContext(input: ResolveInput): ResolveResult {
  const { expected, contributions, evidence, knowledgeBase: kb, asOf } = input;
  const now = asOf.getTime();
  const recencyDays = input.recencyDays ?? 45;
  const cutoff = now - recencyDays * DAY_MS;

  const signals: Signal[] = [];

  // teacher / parent context updates
  for (const c of contributions) {
    const at = Date.parse(`${c.occurredOn}T00:00:00Z`);
    if (at < cutoff) continue;
    const typeKey = c.contributedAs === 'teacher' ? 'teacher_update' : 'parent_update';
    for (const sid of c.taughtSkillIds) {
      const lessonId = lessonIdOfSkill(kb, sid);
      if (!lessonId) continue;
      signals.push({
        lessonId,
        reliability: RELIABILITY[typeKey]!,
        confidence: c.contributedAs === 'teacher' ? 'STRONG' : 'SUPPORTING',
        source: sourceOf(typeKey),
        at,
        typeKey,
      });
    }
  }

  // observed schoolwork / practice evidence
  for (const e of evidence) {
    if (!e.skillId) continue;
    const at = Date.parse(e.occurredAt);
    if (Number.isNaN(at) || at < cutoff) continue;
    const lessonId = lessonIdOfSkill(kb, e.skillId);
    if (!lessonId) continue;
    const typeKey = evidenceReliabilityKey(e);
    signals.push({
      lessonId,
      reliability: RELIABILITY[typeKey]!,
      confidence: evidenceConfidence(e),
      source: sourceOf(typeKey),
      at,
      typeKey,
    });
  }

  // the calendar estimate is one more (weak) signal
  if (expected) {
    signals.push({
      lessonId: expected.lessonId,
      reliability: RELIABILITY.curriculum_timeline!,
      confidence: 'ESTIMATED',
      source: 'CURRICULUM_TIMELINE',
      at: Date.parse(`${expected.asOfDate}T00:00:00Z`),
      typeKey: 'curriculum_timeline',
    });
  }

  if (signals.length === 0) {
    return {
      resolved: {
        chapterId: expected?.chapterId ?? null,
        lessonId: expected?.lessonId ?? null,
        activeSkillIds: [],
        source: 'CURRICULUM_TIMELINE',
        confidence: 'ESTIMATED',
        lastVerifiedAt: null,
      },
      conflictLessonIds: [],
    };
  }

  // score each candidate lesson
  const byLesson = new Map<string, { score: number; signals: Signal[] }>();
  const countByType = new Map<string, number>();
  for (const s of signals) countByType.set(s.typeKey, (countByType.get(s.typeKey) ?? 0) + 1);

  for (const s of signals) {
    const recency = Math.pow(0.5, (now - s.at) / (RECENCY_HALF_LIFE_DAYS * DAY_MS));
    const repetition = 1 + 0.1 * Math.min((countByType.get(s.typeKey) ?? 1) - 1, 3);
    const contribution = s.reliability * CONFIDENCE_WEIGHT[s.confidence] * recency * repetition;
    const rec = byLesson.get(s.lessonId) ?? { score: 0, signals: [] };
    rec.score += contribution;
    rec.signals.push(s);
    byLesson.set(s.lessonId, rec);
  }

  // consistency bonus: ≥2 independent signal types agree on a lesson
  for (const rec of byLesson.values()) {
    const types = new Set(rec.signals.map((s) => s.typeKey));
    if (types.size >= 2) rec.score *= 1.15;
  }

  const ranked = [...byLesson.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topLessonId, top] = ranked[0]!;

  // guardrail: a lone ESTIMATE never overrides a ≤21-day-old VERIFIED/STRONG signal
  const recentVerified = signals
    .filter((s) => (s.confidence === 'VERIFIED' || s.confidence === 'STRONG') && now - s.at <= 21 * DAY_MS)
    .sort((a, b) => b.at - a.at)[0];
  let chosenLessonId = topLessonId;
  let chosenSignals = top.signals;
  if (recentVerified && byLesson.get(topLessonId)!.signals.every((s) => s.typeKey === 'curriculum_timeline')) {
    chosenLessonId = recentVerified.lessonId;
    chosenSignals = byLesson.get(recentVerified.lessonId)?.signals ?? [recentVerified];
  }

  // conflict: runner-up within 15% from a different source
  const conflictLessonIds: string[] = [];
  if (ranked[1]) {
    const [runnerId, runner] = ranked[1];
    const topSources = new Set(top.signals.map((s) => s.source));
    const runnerSources = new Set(runner.signals.map((s) => s.source));
    const disjoint = ![...runnerSources].some((s) => topSources.has(s));
    if (runner.score >= top.score * 0.85 && disjoint) conflictLessonIds.push(runnerId);
  }

  // the "source of record" for the resolved lesson: the most authoritative signal
  // pointing at it (reliability × confidence), then most recent.
  const authority = (s: Signal): number => s.reliability * CONFIDENCE_WEIGHT[s.confidence];
  const strongest = [...chosenSignals].sort((a, b) => authority(b) - authority(a) || b.at - a.at)[0]!;

  const chapterId = chapterIdOfLesson(chosenLessonId, expected);
  const activeSkillIds = skillsForLesson(kb, chosenLessonId);

  return {
    resolved: {
      chapterId,
      lessonId: chosenLessonId,
      activeSkillIds,
      source: strongest.source,
      confidence: strongest.confidence,
      lastVerifiedAt:
        strongest.confidence === 'VERIFIED' || strongest.confidence === 'STRONG'
          ? new Date(strongest.at).toISOString()
          : null,
    },
    conflictLessonIds,
  };
}

function chapterIdOfLesson(lessonId: string, expected: ExpectedLearningContext | null): number | null {
  // node id shape: C.G<grade>.<chapter>.<lesson>
  const m = /^C\.G\d+\.(\d+)\./.exec(lessonId);
  if (m) return Number(m[1]);
  return expected?.chapterId ?? null;
}

function skillsForLesson(kb: KnowledgeBase, lessonId: string): SkillId[] {
  const out: SkillId[] = [];
  for (const s of kb.skills.values()) {
    if (s.curriculumNodeId === lessonId) out.push(s.id as SkillId);
  }
  return out;
}
