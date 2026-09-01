import { describe, expect, it } from 'vitest';
import { CurriculumClockService, effectiveSchoolWeek } from './clock.js';
import { calendarLessonOrder, getCurriculumCalendar } from '@copilot/math-data';

const G7 = { curriculum: 'KET_NOI_TRI_THUC', grade: 7 as const, academicYear: '2026-2027' };
const G4 = { curriculum: 'KET_NOI_TRI_THUC', grade: 4 as const, academicYear: '2026-2027' };

describe('CurriculumClockService (Pricing v1.1 §2)', () => {
  const clock = new CurriculumClockService();

  it('TEST 1 — a new Grade-4 child with no updates still gets an estimated lesson', () => {
    const ctx = clock.positionFor(G4, new Date('2026-10-01'));
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe('CURRICULUM_TIMELINE');
    expect(ctx!.confidence).toBe('ESTIMATED');
    expect(ctx!.primaryLessonId).toMatch(/^C\.G4\./);
    expect(ctx!.asOfDate).toBe('2026-10-01');
  });

  it('week 1 = the first lesson; before the school year = week 0', () => {
    const before = clock.positionFor(G7, new Date('2026-08-20'));
    expect(before!.effectiveSchoolWeek).toBe(0);
    expect(before!.primaryLessonId).toBe('C.G7.1.1');
    const w1 = clock.positionFor(G7, new Date('2026-09-07'));
    expect(w1!.effectiveSchoolWeek).toBe(1);
    expect(w1!.chapterId).toBe(1);
  });

  it('mid-year lands in the right chapter (Bài 21 — dãy tỉ số bằng nhau, chương VI)', () => {
    // school start 2026-09-05, ~20 effective weeks in ≈ mid-February
    const ctx = clock.positionFor(G7, new Date('2027-02-01'));
    expect(ctx!.chapterId).toBe(6);
    expect(ctx!.primaryLessonId).toMatch(/^C\.G7\.6\./);
    expect(ctx!.alsoPlausibleLessonIds.length).toBeGreaterThan(0);
  });

  it('end of year clamps to the last chapter, never past it', () => {
    const ctx = clock.positionFor(G7, new Date('2027-06-15'));
    expect(ctx!.effectiveSchoolWeek).toBeLessThanOrEqual(35);
    expect(ctx!.chapterId).toBe(10);
  });

  it('Tết holiday weeks are subtracted from the effective week', () => {
    const cal = getCurriculumCalendar('KET_NOI_TRI_THUC', 7, '2026-2027')!;
    const beforeTet = effectiveSchoolWeek(cal, new Date('2027-02-10'));
    const afterTet = effectiveSchoolWeek(cal, new Date('2027-03-01'));
    // ~3 calendar weeks apart, but ~1 is holiday → effective gap ≈ 2
    expect(afterTet - beforeTet).toBeLessThanOrEqual(3);
    expect(afterTet).toBeGreaterThan(beforeTet);
  });

  it('a positive pace_delta moves the estimate forward', () => {
    const ahead = new CurriculumClockService(() => 0.2);
    const base = clock.positionFor(G7, new Date('2026-11-01'))!;
    const fast = ahead.positionFor(G7, new Date('2026-11-01'))!;
    expect(fast.paceDeltaApplied).toBeCloseTo(0.2, 5);
    const order = calendarLessonOrder(getCurriculumCalendar('KET_NOI_TRI_THUC', 7, '2026-2027')!);
    expect(order.indexOf(fast.primaryLessonId)).toBeGreaterThanOrEqual(order.indexOf(base.primaryLessonId));
  });

  it('is a pure function of (child, date, pace_delta) — idempotent', () => {
    const a = clock.positionFor(G7, new Date('2026-11-14'));
    const b = clock.positionFor(G7, new Date('2026-11-14'));
    expect(a).toEqual(b);
  });

  it('returns null for an unknown calendar', () => {
    expect(clock.positionFor({ ...G7, academicYear: '2099-2100' }, new Date())).toBeNull();
  });
});
