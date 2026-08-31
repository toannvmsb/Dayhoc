import { HINT_RUNGS, type HintLadderState, type HintRung } from '@copilot/domain';

/**
 * The six-rung hint ladder (Math Core §13, §17):
 *   orientation → guiding_question → second_hint → simpler_analogue
 *   → retry_original → full_solution.
 *
 * A pure state machine. `dependency` (0..1) grows as more rungs are revealed and
 * is used verbatim as `hintDependency` when the attempt becomes evidence — so a
 * child who needed the full solution barely moves their mastery upward.
 */
export function initHintLadder(questionId: string): HintLadderState {
  return { questionId, rung: 'none', rungsRevealed: 0, attempts: 0, resolved: false, dependency: 0 };
}

export interface HintEvent {
  readonly type: 'attempt_wrong' | 'attempt_correct' | 'request_hint';
}

const DEPENDENCY_BY_RUNGS = [0, 0.2, 0.4, 0.55, 0.75, 0.9, 1];

export function advanceHintLadder(state: HintLadderState, event: HintEvent): HintLadderState {
  if (state.resolved) return state;

  switch (event.type) {
    case 'attempt_correct':
      return { ...state, attempts: state.attempts + 1, resolved: true };

    case 'attempt_wrong': {
      const attempts = state.attempts + 1;
      // an unaided wrong attempt nudges the first rung open
      if (state.rungsRevealed === 0) {
        return { ...state, attempts, rung: HINT_RUNGS[0]!, rungsRevealed: 1, dependency: DEPENDENCY_BY_RUNGS[1]! };
      }
      return { ...state, attempts };
    }

    case 'request_hint': {
      const next = Math.min(state.rungsRevealed + 1, HINT_RUNGS.length);
      return {
        ...state,
        rungsRevealed: next,
        rung: rungAt(next),
        dependency: DEPENDENCY_BY_RUNGS[next]!,
      };
    }
  }
}

function rungAt(revealed: number): HintRung | 'none' {
  return revealed <= 0 ? 'none' : HINT_RUNGS[Math.min(revealed, HINT_RUNGS.length) - 1]!;
}

/** The hint text for the current rung, from a question's ordered hint list. */
export function currentHintText(
  state: HintLadderState,
  hints: readonly string[],
  workedSolution: string,
): string | null {
  if (state.rungsRevealed <= 0) return null;
  if (state.rung === 'full_solution') return workedSolution;
  return hints[Math.min(state.rungsRevealed, hints.length) - 1] ?? null;
}
