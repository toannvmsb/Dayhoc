/**
 * Curriculum calendars (Pricing/AI Cost/Routing v1.1 §2 — Curriculum Clock).
 *
 * Authored reference data, one entry per (curriculum, grade, academic_year).
 * PROVISIONAL — seeded from public MOET dates + the SGK phân phối chương trình;
 * the pilot school's own calendar overrides this later (open question O-1). The
 * clock uses these to ESTIMATE the current lesson — never verified truth.
 *
 * Source YAML: `data/calendars/*.yaml` → `src/data/calendars.json` via
 * `npm run data -w @copilot/math-data`.
 */
import raw from './data/calendars.json' with { type: 'json' };

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
  readonly curriculum: string; // e.g. KET_NOI_TRI_THUC
  readonly grade: 4 | 7;
  readonly academic_year: string; // e.g. 2026-2027
  readonly school_start_date: string; // ISO date
  readonly teaching_weeks: number;
  readonly holidays: readonly CalendarHoliday[];
  readonly semesters: readonly CalendarSemester[];
  readonly pacing: readonly CalendarPacingRow[];
}

const CALENDARS = raw as readonly CurriculumCalendar[];

export function loadCurriculumCalendars(): readonly CurriculumCalendar[] {
  return CALENDARS;
}

export function getCurriculumCalendar(
  curriculum: string,
  grade: 4 | 7,
  academicYear: string,
): CurriculumCalendar | undefined {
  return CALENDARS.find(
    (c) => c.curriculum === curriculum && c.grade === grade && c.academic_year === academicYear,
  );
}

/** All curriculum-node ids the calendar references, in teaching order. */
export function calendarLessonOrder(cal: CurriculumCalendar): readonly string[] {
  return [...cal.pacing]
    .sort((a, b) => a.from_week - b.from_week)
    .flatMap((p) => p.lesson_ids);
}
