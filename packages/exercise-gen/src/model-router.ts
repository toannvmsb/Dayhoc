import type { ItemGenerationSpec, ProblemStructure } from '@copilot/domain';

/**
 * Production model routing (doc 62 §E, doc 63 §1) — DETERMINISTIC, versioned,
 * and NEVER a function of subscription tier.
 *
 * Two locked roles:
 *   DEFAULT          = gpt-4.1-mini  — carries the bulk of generation
 *   HIGH_COMPLEXITY  = gpt-5-mini    — first choice for the hard slice AND the
 *                                     escalation fallback
 *
 * gpt-4o-mini is not in the production path.
 */

export const MODEL_ROUTER_VERSION = 'model-router.v1';

export type ModelRole = 'DEFAULT' | 'HIGH_COMPLEXITY';

/**
 * Structures that are inherently reasoning-heavy. Explicitly maintained (doc 63
 * §1) — not inferred. These route to HIGH_COMPLEXITY even at low K/T.
 */
export const HIGH_COMPLEXITY_STRUCTURES: ReadonlySet<ProblemStructure> = new Set<ProblemStructure>([
  'multi_step_word_problem',
  'compare_and_decide',
  'explain_or_justify',
  'find_the_error',
  'construct_an_example',
]);

export interface ModelRouteDecision {
  readonly role: ModelRole;
  readonly reason: string;
  readonly routerVersion: string;
}

/**
 * First-choice model role for an item slot. gpt-5-mini when ANY of:
 *   K ≥ 4 · T = T5 · targetRole = FRONTIER · structure ∈ HIGH_COMPLEXITY_STRUCTURES
 * else gpt-4.1-mini.
 */
export function routeItemModel(itemSpec: ItemGenerationSpec): ModelRouteDecision {
  const reasons: string[] = [];
  if (itemSpec.knowledgeLevel >= 'K4') reasons.push(`K=${itemSpec.knowledgeLevel}`);
  if (itemSpec.thinkingLevel === 'T5') reasons.push('T=T5');
  if (itemSpec.targetRole === 'FRONTIER') reasons.push('targetRole=FRONTIER');
  if (HIGH_COMPLEXITY_STRUCTURES.has(itemSpec.problemStructure)) reasons.push(`structure=${itemSpec.problemStructure}`);

  if (reasons.length > 0) {
    return { role: 'HIGH_COMPLEXITY', reason: `high-complexity: ${reasons.join(', ')}`, routerVersion: MODEL_ROUTER_VERSION };
  }
  return { role: 'DEFAULT', reason: 'standard complexity', routerVersion: MODEL_ROUTER_VERSION };
}
