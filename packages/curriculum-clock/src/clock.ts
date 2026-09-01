/**
 * CurriculumClockService (Pricing/AI Cost/Routing v1.1 §2, doc 13).
 *
 * Estimates where a child's class *should* be in the SGK, from the academic
 * calendar alone — so the app works even when neither parent nor teacher ever
 * updates the current lesson. Pure and deterministic. The output is always
 * `confidence: ESTIMATED` and MUST NOT be treated as a verified single lesson.
 *
 * Every estimate carries an `expectedWindow` (a range of plausible lessons), not
 * just a point. The window is wide when uncertainty is high (early year, recent
 * holidays, large pace uncertainty) and the resolver narrows it as real evidence
 * arrives. Config-driven: a new school year is a new calendar row, not code.
 */
import {
  calendarLessonOrder,
  getCurriculumCalendar,
  getCurriculumCalendarById,
  type CalendarStatus,
  type CurriculumCalendar,
} from '@copilot/math-data';

const DAY_MS = 86_400_000;

export interface ClockChild {
  readonly curriculum: string; // KET_NOI_TRI_THUC
  readonly grade: 4 | 7;
  readonly academicYear: string; // 2026-2027
  /** Optional stable calendar id — a school-specific override wins over (curriculum, grade, year). */
  readonly calendarId?: string;
}

export interface ExpectedWindow {
  readonly fromLessonId: string;
  readonly toLessonId: string;
  /** How many lessons on each side of the primary the window spans. */
  readonly widthLessons: number;
  readonly lessonIds: readonly string[];
}

export interface CalendarProvenance {
  readonly calendarId: string;
  readonly version: number;
  readonly status: CalendarStatus; // PROVISIONAL | VERIFIED
  readonly source: string;
  readonly academicYear: string;
}

export interface ExpectedContext {
  readonly curriculum: string;
  readonly grade: 4 | 7;
  readonly chapterId: number;
  /** The single most likely lesson — NOT authoritative on its own. */
  readonly primaryLessonId: string;
  /** ±1 lesson (subset of `expectedWindow`), kept for compatibility. */
  readonly alsoPlausibleLessonIds: readonly string[];
  /** The range of lessons the class could plausibly be in (doc 13 §1). */
  readonly expectedWindow: ExpectedWindow;
  readonly source: 'CURRICULUM_TIMELINE';
  readonly confidence: 'ESTIMATED';
  readonly asOfDate: string; // ISO date
  readonly effectiveSchoolWeek: number;
  readonly paceDeltaApplied: number;
  readonly calendar: CalendarProvenance;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** School weeks since the start date, minus any overlapped holiday weeks. */
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

/** True when a holiday ended within the last ~2 weeks of `asOf` (extra pace uncertainty). */
function recentHolidayEnded(cal: CurriculumCalendar, asOf: Date): boolean {
  const now = Date.parse(`${isoDate(asOf)}T00:00:00Z`);
  return cal.holidays.some((h) => {
    const hTo = Date.parse(`${h.to}T00:00:00Z`);
    return hTo <= now && now - hTo <= 14 * DAY_MS;
  });
}

export class CurriculumClockService {
  /**
   * @param paceDeltaFor optional per-child pace adjustment (from the resolver,
   *   doc 13 §4). Positive = class is ahead of the calendar mean.
   */
  constructor(private readonly paceDeltaFor: (child: ClockChild) => number = () => 0) {}

  #calendarFor(child: ClockChild): CurriculumCalendar | undefined {
    if (child.calendarId) return getCurriculumCalendarById(child.calendarId);
    return getCurriculumCalendar(child.curriculum, child.grade, child.academicYear);
  }

  /**
   * @param opts.paceDeltaOverride when set, use this learned pace adjustment
   *   instead of the constructor's `paceDeltaFor` — used for the second pass
   *   after the resolver auto-applies a pace (doc 13 §4). Only shifts the FUTURE
   *   estimate/window; it never becomes verified actual context.
   */
  positionFor(
    child: ClockChild,
    asOf: Date,
    opts: { paceDeltaOverride?: number } = {},
  ): ExpectedContext | null {
    const cal = this.#calendarFor(child);
    if (!cal) return null;

    const rawPace = opts.paceDeltaOverride ?? this.paceDeltaFor(child);
    const paceDelta = clamp(rawPace, -0.35, 0.35);
    const week = effectiveSchoolWeek(cal, asOf);
    const adjustedWeek = Math.max(1, Math.round(week * (1 + paceDelta)));

    const rows = [...cal.pacing].sort((a, b) => a.from_week - b.from_week);
    const chapter =
      rows.find((r) => adjustedWeek >= r.from_week && adjustedWeek <= r.to_week) ??
      (adjustedWeek < rows[0]!.from_week ? rows[0]! : rows[rows.length - 1]!);

    const span = Math.max(1, chapter.to_week - chapter.from_week + 1);
    const into = clamp((adjustedWeek - chapter.from_week) / span, 0, 1);
    const idx = Math.min(chapter.lesson_ids.length - 1, Math.floor(into * chapter.lesson_ids.length));
    const primaryLessonId = chapter.lesson_ids[idx]!;

    const order = calendarLessonOrder(cal);
    const gi = order.indexOf(primaryLessonId);

    // window width: base pace uncertainty + extra for early-year and post-holiday
    let width = Math.max(1, cal.pace_uncertainty_lessons);
    if (week <= 3) width += 1; // very early — could be behind/ahead
    if (recentHolidayEnded(cal, asOf)) width += 1;

    const lo = Math.max(0, gi - width);
    const hi = Math.min(order.length - 1, gi + width);
    const windowLessonIds = order.slice(lo, hi + 1);

    const alsoPlausibleLessonIds = [order[gi - 1], order[gi + 1]].filter(
      (x): x is string => typeof x === 'string',
    );

    return {
      curriculum: cal.curriculum,
      grade: cal.grade,
      chapterId: chapter.chapter,
      primaryLessonId,
      alsoPlausibleLessonIds,
      expectedWindow: {
        fromLessonId: order[lo]!,
        toLessonId: order[hi]!,
        widthLessons: width,
        lessonIds: windowLessonIds,
      },
      source: 'CURRICULUM_TIMELINE',
      confidence: 'ESTIMATED',
      asOfDate: isoDate(asOf),
      effectiveSchoolWeek: week,
      paceDeltaApplied: paceDelta,
      calendar: {
        calendarId: cal.meta.calendar_id,
        version: cal.meta.version,
        status: cal.meta.status,
        source: cal.meta.source,
        academicYear: cal.meta.academic_year,
      },
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
