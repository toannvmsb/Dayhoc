import type { ItemGenerationSpec } from '@copilot/domain';
import type { ItemContentGenerator } from './item-generator.js';

/**
 * Item-generation routing (doc 56 §11). Routing is NEVER a map from subscription
 * tier → model. It is a function of: attempt number, the previous outcome, item
 * complexity, and a cost-guardrail state. The shape is always
 *   default model → validate → one bounded retry (same model, sharper
 *   instruction) → stronger fallback → reject/fallback safely.
 * Global LIVE generation stays disabled regardless of what this returns.
 */

export type CostGuardrailState = 'GREEN' | 'YELLOW' | 'RED';

export interface ItemRouteDecision {
  readonly generator: ItemContentGenerator;
  readonly step: 'default' | 'retry_same' | 'fallback_stronger';
  readonly reason: string;
}

export interface ItemRouteInput {
  readonly attempt: number; // 0-based
  readonly itemSpec: ItemGenerationSpec;
  readonly defaultGenerator: ItemContentGenerator;
  readonly fallbackGenerator: ItemContentGenerator | null;
  readonly escalateAfterAttempts: number;
  readonly guardrail: CostGuardrailState;
}

/** Complexity heuristic — higher-K / higher-T / frontier / reasoning items are harder. */
export function itemComplexity(itemSpec: ItemGenerationSpec): 'standard' | 'high' {
  const highK = itemSpec.knowledgeLevel >= 'K4';
  const highT = itemSpec.thinkingLevel >= 'T4';
  const frontier = itemSpec.targetRole === 'FRONTIER';
  const reasoning = itemSpec.answerKind === 'reasoning';
  return highK || highT || frontier || reasoning ? 'high' : 'standard';
}

export function selectGeneratorForAttempt(input: ItemRouteInput): ItemRouteDecision {
  if (input.attempt === 0) {
    return { generator: input.defaultGenerator, step: 'default', reason: 'first attempt — default model' };
  }
  const wantStronger =
    input.attempt >= input.escalateAfterAttempts &&
    input.fallbackGenerator !== null &&
    // RED guardrail: do NOT escalate to a more expensive model unless the item is genuinely hard
    (input.guardrail !== 'RED' || itemComplexity(input.itemSpec) === 'high');
  if (wantStronger && input.fallbackGenerator) {
    return {
      generator: input.fallbackGenerator,
      step: 'fallback_stronger',
      reason: `attempt ${input.attempt} ≥ escalateAfter ${input.escalateAfterAttempts} — stronger fallback`,
    };
  }
  return {
    generator: input.defaultGenerator,
    step: 'retry_same',
    reason:
      input.guardrail === 'RED'
        ? 'RED guardrail — retry on the same default model with a sharper instruction, no escalation'
        : `attempt ${input.attempt} — bounded retry on the same model`,
  };
}
