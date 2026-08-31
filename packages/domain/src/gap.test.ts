import { describe, expect, it } from 'vitest';
import {
  CORE_DISCRIMINATION_TARGETS,
  GAP_LIFECYCLE_STATES,
  GAP_TRANSITIONS,
} from './gap.js';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from './taxonomy.js';

describe('gap lifecycle invariants', () => {
  it('cannot close directly from DETECTED (no close after a single signal)', () => {
    expect(GAP_TRANSITIONS.DETECTED).not.toContain('CLOSED');
    expect(GAP_TRANSITIONS.DETECTED).toEqual(['CONFIRMED']);
  });

  it('every lifecycle state has a declared transition set', () => {
    for (const state of GAP_LIFECYCLE_STATES) {
      expect(GAP_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('reaching CLOSED requires passing through IMPROVING', () => {
    const canReachClosed = Object.entries(GAP_TRANSITIONS).filter(([, to]) =>
      to.includes('CLOSED'),
    );
    expect(canReachClosed.map(([from]) => from).sort()).toEqual(['IMPROVING', 'MONITORING']);
  });
});

describe('taxonomy independence', () => {
  it('exposes six knowledge levels and five thinking levels as separate axes', () => {
    expect(KNOWLEDGE_LEVELS).toHaveLength(6);
    expect(THINKING_LEVELS).toHaveLength(5);
  });

  it('tracks exactly eight core discrimination targets', () => {
    expect(new Set(CORE_DISCRIMINATION_TARGETS).size).toBe(8);
  });
});
