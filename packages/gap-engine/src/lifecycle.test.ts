import { describe, expect, it } from 'vitest';
import type { GapId } from '@copilot/domain';
import { applyTransition, InvalidGapTransitionError, nextLifecycleState } from './lifecycle.js';

const gapId = 'gap_1' as GapId;
const base = { gapId, reason: 'test', at: '2026-08-31T09:00:00Z', newId: () => 'x' };

describe('gap lifecycle state machine', () => {
  it('allows DETECTED → CONFIRMED and records an append-only event', () => {
    const ev = applyTransition({ ...base, from: 'DETECTED', to: 'CONFIRMED' });
    expect(ev.fromState).toBe('DETECTED');
    expect(ev.toState).toBe('CONFIRMED');
    expect(ev.id).toBe('gle_x');
  });

  it('rejects an illegal jump (DETECTED → CLOSED)', () => {
    expect(() => applyTransition({ ...base, from: 'DETECTED', to: 'CLOSED' })).toThrow(
      InvalidGapTransitionError,
    );
  });

  it('never closes a gap on a single correct answer', () => {
    // one corroboration, one success — nowhere near CLOSED
    let state = nextLifecycleState('DETECTED', {
      corroboratingSignals: 1,
      remediationSuccesses: 1,
      retentionCheckPassed: false,
      improving: true,
    });
    expect(state).toBe('CONFIRMED');
    state = nextLifecycleState('CONFIRMED', {
      corroboratingSignals: 1,
      remediationSuccesses: 1,
      retentionCheckPassed: true,
      improving: true,
    });
    expect(state).toBe('TREATING');
    // even "treating" with 1 success does not advance
    state = nextLifecycleState('TREATING', {
      corroboratingSignals: 1,
      remediationSuccesses: 1,
      retentionCheckPassed: true,
      improving: true,
    });
    expect(state).toBe('TREATING');
  });

  it('reaches CLOSED only after repeated re-test success AND a retention check', () => {
    const improving = nextLifecycleState('TREATING', {
      corroboratingSignals: 2,
      remediationSuccesses: 2,
      retentionCheckPassed: false,
      improving: true,
    });
    expect(improving).toBe('IMPROVING');

    const notYet = nextLifecycleState('IMPROVING', {
      corroboratingSignals: 2,
      remediationSuccesses: 3,
      retentionCheckPassed: false, // retention check missing
      improving: true,
    });
    expect(notYet).toBe('IMPROVING');

    const closed = nextLifecycleState('IMPROVING', {
      corroboratingSignals: 2,
      remediationSuccesses: 3,
      retentionCheckPassed: true,
      improving: true,
    });
    expect(closed).toBe('CLOSED');
  });

  it('re-opens from MONITORING on regression', () => {
    expect(
      nextLifecycleState('MONITORING', {
        corroboratingSignals: 0,
        remediationSuccesses: 0,
        retentionCheckPassed: false,
        improving: false,
      }),
    ).toBe('DETECTED');
  });
});
