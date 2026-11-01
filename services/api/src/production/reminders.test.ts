import { describe, expect, it } from 'vitest';
import { COOLDOWN_DAYS, MAX_REMINDERS_PER_LAPSE, decideReminder, inactiveDaysOf, type ReminderFacts } from './reminders.js';

const base: ReminderFacts = {
  lastAttemptDay: '2026-10-28',
  firstAssignmentDay: '2026-10-20',
  today: '2026-10-30',
  remindersEnabled: true,
  remindersSinceActivity: [],
};

describe('inactivity reminder decision (backlog B2-04)', () => {
  it('counts Vietnam calendar days since the last attempt', () => {
    expect(inactiveDaysOf(base)).toBe(2);
    expect(inactiveDaysOf({ ...base, today: '2026-10-28' })).toBe(0);
  });

  it('fires at exactly 2 days, not at 1', () => {
    expect(decideReminder(base)).toEqual({ send: true, inactiveDays: 2 });
    expect(decideReminder({ ...base, today: '2026-10-29' })).toMatchObject({ send: false, reason: 'ACTIVE_RECENTLY' });
  });

  it('a child who never attempted is measured from the first worksheet', () => {
    const f = { ...base, lastAttemptDay: null, firstAssignmentDay: '2026-10-27' };
    expect(decideReminder(f)).toEqual({ send: true, inactiveDays: 3 });
  });

  it('a child who was never given any work is not nagged', () => {
    expect(decideReminder({ ...base, lastAttemptDay: null, firstAssignmentDay: null })).toMatchObject({
      send: false,
      reason: 'NEVER_STARTED',
    });
  });

  it('respects the parent switch', () => {
    expect(decideReminder({ ...base, remindersEnabled: false })).toMatchObject({ send: false, reason: 'DISABLED' });
  });

  it(`waits ${COOLDOWN_DAYS} days between reminders`, () => {
    expect(decideReminder({ ...base, today: '2026-10-31', remindersSinceActivity: ['2026-10-30'] })).toMatchObject({
      send: false,
      reason: 'COOLDOWN',
    });
    expect(decideReminder({ ...base, today: '2026-11-02', remindersSinceActivity: ['2026-10-30'] })).toMatchObject({
      send: true,
    });
  });

  it(`stops after ${MAX_REMINDERS_PER_LAPSE} reminders without any activity`, () => {
    const sent = ['2026-10-30', '2026-11-02', '2026-11-05'];
    expect(decideReminder({ ...base, today: '2026-11-20', remindersSinceActivity: sent })).toMatchObject({
      send: false,
      reason: 'LAPSE_CAP_REACHED',
    });
  });
});
