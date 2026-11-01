import { describe, expect, it } from 'vitest';
import { DEFAULT_STRETCH_CONFIG } from './stretch-zone.js';
import {
  LEARNING_GOAL_INFO,
  LEARNING_GOALS,
  parseStoredGoals,
  primaryGoal,
  stretchConfigForGoals,
} from './goals.js';

describe('learning goals (backlog B2-03)', () => {
  it('every goal mix sums to 1 and stays within a sane 55–90% comfortable band', () => {
    for (const g of LEARNING_GOALS) {
      const [solvable, struggle] = LEARNING_GOAL_INFO[g].mix;
      expect(solvable + struggle).toBeCloseTo(1, 10);
      expect(solvable).toBeGreaterThanOrEqual(0.55);
      expect(solvable).toBeLessThanOrEqual(0.9);
    }
  });

  it('no goal → the default §17 mix', () => {
    expect(stretchConfigForGoals([])).toEqual(DEFAULT_STRETCH_CONFIG);
  });

  it('ADVANCED stretches more than the default; CATCH_UP stretches less', () => {
    expect(stretchConfigForGoals(['ADVANCED']).struggleShare).toBeGreaterThan(DEFAULT_STRETCH_CONFIG.struggleShare);
    expect(stretchConfigForGoals(['CATCH_UP']).struggleShare).toBeLessThan(DEFAULT_STRETCH_CONFIG.struggleShare);
  });

  it('EXAM_PREP is a scope flag: it never overrides the difficulty goal', () => {
    expect(primaryGoal(['EXAM_PREP', 'CATCH_UP'])).toBe('CATCH_UP');
    expect(stretchConfigForGoals(['CATCH_UP', 'EXAM_PREP'])).toEqual(stretchConfigForGoals(['CATCH_UP']));
    expect(primaryGoal(['EXAM_PREP'])).toBe('KEEP_PACE');
  });

  it('stored jsonb is read defensively — garbage never throws', () => {
    expect(parseStoredGoals(null)).toEqual([]);
    expect(parseStoredGoals('ADVANCED')).toEqual([]);
    expect(parseStoredGoals(['ADVANCED', { code: 'EXAM_PREP' }, 'NOPE', 7, null, 'ADVANCED'])).toEqual(['ADVANCED', 'EXAM_PREP']);
  });
});
