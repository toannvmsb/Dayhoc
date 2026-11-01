import { describe, expect, it } from 'vitest';
import { vnDay, vnMostRecentMonday } from './vn-time.js';

describe('Vietnam day boundary (backlog B2-05)', () => {
  it('06:30 in Hanoi is already the new day even though UTC is still yesterday', () => {
    // 2026-11-01 23:30 UTC == 2026-11-02 06:30 ICT
    expect(vnDay(new Date('2026-11-01T23:30:00Z'))).toBe('2026-11-02');
  });

  it('16:59 UTC is still the same Vietnam day; 17:00 UTC rolls over', () => {
    expect(vnDay(new Date('2026-11-01T16:59:59Z'))).toBe('2026-11-01');
    expect(vnDay(new Date('2026-11-01T17:00:00Z'))).toBe('2026-11-02');
  });

  it('the week starts on Monday in Vietnam time', () => {
    // Sun 2026-11-01 20:00 UTC == Mon 2026-11-02 03:00 ICT → that Monday
    expect(vnMostRecentMonday(new Date('2026-11-01T20:00:00Z'))).toBe('2026-11-02');
    // Sun 2026-11-01 10:00 UTC == Sun 17:00 ICT → previous Monday
    expect(vnMostRecentMonday(new Date('2026-11-01T10:00:00Z'))).toBe('2026-10-26');
  });
});
