/**
 * Curriculum-pace policy (doc 13 §4 — LOCKED 2026-09-01).
 *
 * Two ideas are kept strictly separate:
 *   1. CONFIRMED current learning context  — a human said "we are on Bài X".
 *   2. system-inferred curriculum PACE     — the class is drifting ahead/behind
 *                                            the calendar mean, learned from
 *                                            observed schoolwork.
 *
 * A pace adjustment ONLY shifts the FUTURE expected context / window. It never
 * turns an observed lesson into VERIFIED actual context — that still requires
 * evidence meeting the context-confidence policy (see resolver invariants).
 *
 * Thresholds:
 *   • 1–2 consistent observations            → no adjustment.
 *   • ≥3 consistent observations             → paceDeltaHypothesis (surfaced, not applied).
 *   • ≥5 consistent observations spanning
 *     ≥2 distinct school weeks               → system may APPLY a LOW-confidence
 *                                              paceDelta automatically.
 *   • a recent parent/teacher confirmation
 *     ≥2 lessons off the calendar            → recalibrates faster: the auto-apply
 *                                              observation floor drops to 3.
 *   • conflicting / stale evidence           → decays: pure recompute over current
 *                                              evidence returns 0.
 *   • bounded: hypothesis ±0.35, auto-apply ±0.25.
 */
import type { Evidence, ExpectedLearningContext, LessonConfirmationEvent } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

const DAY_MS = 86_400_000;
const OBS_WINDOW_DAYS = 28;
const HYP_MIN_OBS = 3;
const AUTO_MIN_OBS = 5;
const AUTO_MIN_OBS_WITH_CONFIRMATION = 3;
const AUTO_MIN_SPAN_WEEKS = 2;
const CONFIRMATION_LAG_LESSONS = 2;
export const HYPOTHESIS_BOUND = 0.35;
export const AUTO_APPLY_BOUND = 0.25;

/** Evidence sources that indicate WHERE IN THE CURRICULUM the class currently is. */
const POSITION_SOURCES = new Set(['school_homework', 'notebook_scan', 'school_test', 'school_exam']);

export interface PaceHypothesis {
  /** Suggested pace adjustment −0.35..0.35; 0 = no hypothesis. */
  readonly value: number;
  readonly observationCount: number;
  /** Distinct ISO weeks the observations span. */
  readonly spanWeeks: number;
  readonly rationale: string;
}

export interface PaceAutoApply {
  readonly applied: boolean;
  /** The value to feed back into the clock (0 when not applied). */
  readonly value: number;
  readonly confidence: 'LOW' | 'NONE';
  readonly reason: string;
}

export interface PaceEvaluation {
  readonly hypothesis: PaceHypothesis;
  readonly autoApply: PaceAutoApply;
}

export interface EvaluatePaceInput {
  readonly expected: ExpectedLearningContext | null;
  readonly evidence: readonly Evidence[];
  readonly lessonConfirmations?: readonly LessonConfirmationEvent[];
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf: Date;
}

const NONE: PaceEvaluation = {
  hypothesis: { value: 0, observationCount: 0, spanWeeks: 0, rationale: 'not enough consistent evidence' },
  autoApply: { applied: false, value: 0, confidence: 'NONE', reason: 'no consistent pace signal' },
};

function clamp(x: number, bound: number): number {
  return Math.max(-bound, Math.min(bound, x));
}

/** Curriculum node ids for one grade, in teaching order (C.G<g>.<chapter>.<lesson>). */
export function curriculumNodeOrder(kb: KnowledgeBase, gradePrefix: string): string[] {
  return [...kb.curriculum.keys()]
    .filter((id) => id.startsWith(gradePrefix) && /\.\d+\.\d+$/.test(id))
    .sort((a, b) => {
      const [, ac, al] = /\.(\d+)\.(\d+)$/.exec(a)!;
      const [, bc, bl] = /\.(\d+)\.(\d+)$/.exec(b)!;
      return Number(ac) - Number(bc) || Number(al) - Number(bl);
    });
}

/** ISO-week key (year + week number) — used to check observations aren't all in one week. */
function isoWeekKey(epochMs: number): string {
  const d = new Date(epochMs);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${week}`;
}

/**
 * Evaluate the class curriculum pace from observed schoolwork. Pure and
 * idempotent — recomputed from scratch every cycle, so stale/conflicting
 * evidence naturally decays the adjustment back toward 0.
 */
export function evaluatePace(input: EvaluatePaceInput): PaceEvaluation {
  const { expected, evidence, knowledgeBase: kb, asOf } = input;
  if (!expected) return NONE;
  const gradePrefix = /^(C\.G\d+)\./.exec(expected.lessonId)?.[1];
  if (!gradePrefix) return NONE;
  const order = curriculumNodeOrder(kb, gradePrefix);
  const expectedIdx = order.indexOf(expected.lessonId);
  if (expectedIdx < 0) return NONE;

  const now = asOf.getTime();
  const cutoff = now - OBS_WINDOW_DAYS * DAY_MS;

  const obs = evidence
    .filter((e) => e.skillId && POSITION_SOURCES.has(e.source))
    .map((e) => {
      const at = Date.parse(e.occurredAt);
      const lessonId = kb.skills.get(e.skillId!)?.curriculumNodeId ?? '';
      return { at, idx: order.indexOf(lessonId) };
    })
    .filter((o) => !Number.isNaN(o.at) && o.at >= cutoff && o.idx >= 0);

  if (obs.length < HYP_MIN_OBS) return NONE;

  const lags = obs.map((o) => o.idx - expectedIdx);
  const allAhead = lags.every((l) => l >= 1);
  const allBehind = lags.every((l) => l <= -1);
  if (!allAhead && !allBehind) {
    return {
      hypothesis: { value: 0, observationCount: obs.length, spanWeeks: 0, rationale: 'observations disagree on direction — pace held at 0' },
      autoApply: { applied: false, value: 0, confidence: 'NONE', reason: 'conflicting evidence — recalculated to 0' },
    };
  }

  const meanLag = lags.reduce((a, b) => a + b, 0) / lags.length;
  const hypValue = Number(clamp(meanLag / Math.max(4, expectedIdx), HYPOTHESIS_BOUND).toFixed(3));
  const spanWeeks = new Set(obs.map((o) => isoWeekKey(o.at))).size;
  const dir = allAhead ? 'ahead of' : 'behind';
  const hypothesis: PaceHypothesis = {
    value: hypValue,
    observationCount: obs.length,
    spanWeeks,
    rationale: `${obs.length} recent schoolwork observations over ${spanWeeks} school week(s) consistently ${dir} the calendar (mean lag ${meanLag.toFixed(1)} lessons)`,
  };

  // a recent confirmation ≥2 lessons off, same direction, lets pace recalibrate faster
  const confirmationSupports = (input.lessonConfirmations ?? []).some((c) => {
    const at = Date.parse(c.confirmedAt);
    if (Number.isNaN(at) || at < cutoff) return false;
    const cIdx = order.indexOf(c.lessonId);
    if (cIdx < 0) return false;
    const cLag = cIdx - expectedIdx;
    return allAhead ? cLag >= CONFIRMATION_LAG_LESSONS : cLag <= -CONFIRMATION_LAG_LESSONS;
  });
  const minObs = confirmationSupports ? AUTO_MIN_OBS_WITH_CONFIRMATION : AUTO_MIN_OBS;

  if (obs.length >= minObs && spanWeeks >= AUTO_MIN_SPAN_WEEKS) {
    const value = Number(clamp(hypValue, AUTO_APPLY_BOUND).toFixed(3));
    return {
      hypothesis,
      autoApply: {
        applied: value !== 0,
        value,
        confidence: value !== 0 ? 'LOW' : 'NONE',
        reason: confirmationSupports
          ? `${obs.length} consistent observations + a matching lesson confirmation → low-confidence auto pace ${value}`
          : `${obs.length} consistent observations over ${spanWeeks} weeks → low-confidence auto pace ${value}`,
      },
    };
  }

  return {
    hypothesis,
    autoApply: {
      applied: false,
      value: 0,
      confidence: 'NONE',
      reason: `hypothesis only — need ≥${minObs} observations over ≥${AUTO_MIN_SPAN_WEEKS} weeks (have ${obs.length} over ${spanWeeks})`,
    },
  };
}
