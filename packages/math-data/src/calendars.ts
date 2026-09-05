/**
 * Curriculum calendars (Pricing/AI Cost/Routing v1.1 §2 — Curriculum Clock).
 *
 * DATA / CONFIG-DRIVEN. One entry per (curriculum, grade, academic_year), each
 * carrying provenance metadata (`meta`). PROVISIONAL until the pilot school's
 * own calendar is confirmed (open question O-1). `CurriculumClockService` reads
 * this config — a new school year is a new data row, never a code change.
 *
 * Source YAML: `data/calendars/*.yaml` → `src/data/calendars.json` via
 * `npm run data -w @copilot/math-data`.
 */
import raw from './data/calendars.json' with { type: 'json' };

export type CalendarStatus = 'PROVISIONAL' | 'VERIFIED';

export interface CalendarMeta {
  readonly calendar_id: string;
  readonly curriculum_id: string;
  readonly grade: 4 | 7;
  readonly academic_year: string;
  readonly version: number;
  readonly status: CalendarStatus;
  readonly effective_from: string; // ISO date
  readonly effective_to: string; // ISO date
  readonly source: string;
  readonly region: string | null;
  readonly school_override_id: string | null;
  readonly created_at: string; // ISO date
}

export interface CalendarHoliday {
  readonly name: string;
  readonly from: string; // ISO date
  readonly to: string; // ISO date
}

export interface CalendarSemester {
  readonly index: number;
  readonly from_week: number;
  readonly to_week: number;
}

export interface CalendarPacingRow {
  readonly chapter: number;
  readonly name: string;
  readonly from_week: number;
  readonly to_week: number;
  readonly lesson_ids: readonly string[];
}

export interface CurriculumCalendar {
  readonly meta: CalendarMeta;
  readonly curriculum: string; // e.g. KET_NOI_TRI_THUC
  readonly grade: 4 | 7;
  readonly academic_year: string; // e.g. 2026-2027
  readonly school_start_date: string; // ISO date
  readonly teaching_weeks: number;
  /** Plausible distance from the calendar mean, in "lessons" (expectedWindow width). */
  readonly pace_uncertainty_lessons: number;
  readonly holidays: readonly CalendarHoliday[];
  readonly semesters: readonly CalendarSemester[];
  readonly pacing: readonly CalendarPacingRow[];
}

const CALENDARS = raw as readonly CurriculumCalendar[];

export function loadCurriculumCalendars(): readonly CurriculumCalendar[] {
  return CALENDARS;
}

/** By (curriculum, grade, academicYear). Latest `meta.version` wins on a tie. */
export function getCurriculumCalendar(
  curriculum: string,
  grade: 4 | 7,
  academicYear: string,
): CurriculumCalendar | undefined {
  return CALENDARS.filter(
    (c) => c.curriculum === curriculum && c.grade === grade && c.academic_year === academicYear,
  ).sort((a, b) => b.meta.version - a.meta.version)[0];
}

/** By stable calendar id (e.g. a school override). */
export function getCurriculumCalendarById(calendarId: string): CurriculumCalendar | undefined {
  return CALENDARS.find((c) => c.meta.calendar_id === calendarId);
}

/** All curriculum-node ids the calendar references, in teaching order. */
export function calendarLessonOrder(cal: CurriculumCalendar): readonly string[] {
  return [...cal.pacing]
    .sort((a, b) => a.from_week - b.from_week)
    .flatMap((p) => p.lesson_ids);
}

/**
 * Human label for a curriculum id — for display only (`ParentHome.child.
 * schoolContext`, the teacher curriculum-program picker). Only one SGK series
 * is seeded today; an id with no known label falls back to itself rather than
 * throwing, so a future curriculum never breaks a screen while it's being
 * added.
 */
export const CURRICULUM_LABELS: Readonly<Record<string, string>> = {
  KET_NOI_TRI_THUC: 'Kết nối tri thức',
};

export function curriculumLabel(curriculumId: string): string {
  return CURRICULUM_LABELS[curriculumId] ?? curriculumId;
}
