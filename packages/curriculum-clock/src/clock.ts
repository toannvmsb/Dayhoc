/**
 * CurriculumClockService (Pricing/AI Cost/Routing v1.1 §2, doc 13).
 *
 * Estimates where a child's class *should* be in the SGK, from the academic
 * calendar alone — so the app works even when neither parent nor teacher ever
 * updates the current lesson. Pure and deterministic. The output is always
 * `confidence: ESTIMATED` and must never be treated as verified truth.
 */
import {
  calendarLessonOrder,
  getCurriculumCalendar,
  type CurriculumCalendar,
} from '@copilot/math-data';

const DAY_MS = 86_400_000;

export interface ClockChild {
  readonly curriculum: string; // KET_NOI_TRI_THUC
  readonly grade: 4 | 7;
  readonly academicYear: string; // 2026-2027
}

export interface ExpectedContext {
  readonly curriculum: string;
  readonly grade: 4 | 7;
  readonly chapterId: number;
  /** KB curriculum-node id, e.g. C.G7.6.21. */
  readonly primaryLessonId: string;
  /** The class could plausibly also be here (± 1 lesson). */
  readonly alsoPlausibleLessonIds: readonly string[];
  readonly source: 'CURRICULUM_TIMELINE';
  readonly confidence: 'ESTIMATED';
  readonly asOfDate: string; // ISO date
  readonly effectiveSchoolWeek: number;
  readonly paceDeltaApplied: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** School weeks between two dates, minus any fully-overlapped holiday weeks. */
export function effectiveSchoolWeek(cal: CurriculumCalendar, asOf: Date): number {
  const start = Date.parse(`${cal.school_start_date}T00:00:00Z`);
  const now = Date.parse(`${isoDate(asOf)}T00:00:00Z`);
  if (now < start) return 0;
  const rawWeeks = Math.floor((now - start) / (7 * DAY_MS)) + 1;

  let holidayWeeks = 0;
  for (const h of cal.holidays) {
    const hFrom = Date.parse(`${h.from}T00:00:00Z`);
    const hTo = Date.parse(`${h.to}T00:00:00Z`);
    if (hTo < start || hFrom > now) continue;
    const overlapMs = Math.min(hTo, now) - Math.max(hFrom, start);
    holidayWeeks += Math.round(overlapMs / (7 * DAY_MS));
  }
  return Math.max(1, Math.min(rawWeeks - holidayWeeks, cal.teaching_weeks));
}

export class CurriculumClockService {
  /**
   * @param paceDeltaFor optional per-child pace adjustment (from the resolver,
   *   doc 13 §4). Positive = class is ahead of the calendar mean.
   */
  constructor(private readonly paceDeltaFor: (child: ClockChild) => number = () => 0) {}

  positionFor(child: ClockChild, asOf: Date): ExpectedContext | null {
    const cal = getCurriculumCalendar(child.curriculum, child.grade, child.academicYear);
    if (!cal) return null;

    const paceDelta = clamp(this.paceDeltaFor(child), -0.35, 0.35);
    const week = effectiveSchoolWeek(cal, asOf);
    const adjustedWeek = Math.max(1, Math.round(week * (1 + paceDelta)));

    // find the chapter whose week window contains adjustedWeek (or the last one)
    const rows = [...cal.pacing].sort((a, b) => a.from_week - b.from_week);
    const chapter =
      rows.find((r) => adjustedWeek >= r.from_week && adjustedWeek <= r.to_week) ??
      (adjustedWeek < rows[0]!.from_week ? rows[0]! : rows[rows.length - 1]!);

    // position within the chapter, proportional to elapsed weeks
    const span = Math.max(1, chapter.to_week - chapter.from_week + 1);
    const into = clamp((adjustedWeek - chapter.from_week) / span, 0, 1);
    const idx = Math.min(chapter.lesson_ids.length - 1, Math.floor(into * chapter.lesson_ids.length));
    const primaryLessonId = chapter.lesson_ids[idx]!;

    const order = calendarLessonOrder(cal);
    const gi = order.indexOf(primaryLessonId);
    const alsoPlausibleLessonIds = [order[gi - 1], order[gi + 1]].filter(
      (x): x is string => typeof x === 'string',
    );

    return {
      curriculum: cal.curriculum,
      grade: cal.grade,
      chapterId: chapter.chapter,
      primaryLessonId,
      alsoPlausibleLessonIds,
      source: 'CURRICULUM_TIMELINE',
      confidence: 'ESTIMATED',
      asOfDate: isoDate(asOf),
      effectiveSchoolWeek: week,
      paceDeltaApplied: paceDelta,
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
