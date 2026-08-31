import {
  GAP_TRANSITIONS,
  type GapId,
  type GapLifecycleEvent,
  type GapLifecycleState,
} from '@copilot/domain';

export class InvalidGapTransitionError extends Error {
  constructor(from: GapLifecycleState, to: GapLifecycleState) {
    super(`gap transition ${from} -> ${to} is not allowed`);
    this.name = 'InvalidGapTransitionError';
  }
}

export interface TransitionInput {
  readonly gapId: GapId;
  readonly from: GapLifecycleState;
  readonly to: GapLifecycleState;
  readonly reason: string;
  readonly evidenceRef?: string;
  readonly at: string; // ISO
  readonly newId: () => string;
}

/** Validate + record one lifecycle transition. Emits an append-only event. */
export function applyTransition(input: TransitionInput): GapLifecycleEvent {
  const allowed = GAP_TRANSITIONS[input.from];
  if (!allowed.includes(input.to)) {
    throw new InvalidGapTransitionError(input.from, input.to);
  }
  return {
    id: `gle_${input.newId()}`,
    gapId: input.gapId,
    fromState: input.from,
    toState: input.to,
    reason: input.reason,
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    createdAt: input.at,
  };
}

export interface LifecycleSignals {
  /** Corroborating evidence count for the gap since it was DETECTED. */
  readonly corroboratingSignals: number;
  /** Consecutive successful remediation re-tests. */
  readonly remediationSuccesses: number;
  /** A delayed retention check passed (Math Core §22 close criteria). */
  readonly retentionCheckPassed: boolean;
  /** The current gap severity is trending down. */
  readonly improving: boolean;
}

/**
 * Recommend the next lifecycle state from accumulated signals — never jumps.
 * A gap is NEVER closed on a single correct answer: CLOSED requires
 * remediation + repeated re-test success + a passed delayed retention check.
 */
export function nextLifecycleState(
  current: GapLifecycleState,
  s: LifecycleSignals,
): GapLifecycleState {
  switch (current) {
    case 'DETECTED':
      return s.corroboratingSignals >= 1 ? 'CONFIRMED' : 'DETECTED';
    case 'CONFIRMED':
      return 'TREATING';
    case 'TREATING':
      return s.remediationSuccesses >= 2 && s.improving ? 'IMPROVING' : 'TREATING';
    case 'IMPROVING':
      return s.remediationSuccesses >= 3 && s.retentionCheckPassed ? 'CLOSED' : 'IMPROVING';
    case 'CLOSED':
      return 'MONITORING';
    case 'MONITORING':
      return s.improving ? 'CLOSED' : 'DETECTED'; // regression re-opens
  }
}
