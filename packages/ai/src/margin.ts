/**
 * Commercial margin model (Pricing + AI Cost Guardrails v1.0 §6).
 *
 *   Contribution = 0.75 × Price − 30,000đ − AI_COGS
 *
 * where 30,000đ = 10,000đ server/data + 20,000đ HR/marketing allocation, and
 * the 0.75 factor absorbs 15% store/payment + 10% tax assumption on revenue.
 *
 * Hard business rule: modeled contribution margin must stay ≥ 50% of revenue —
 * even at the AI hard ceiling. Prices are LOCKED (§11); do not lower a price just
 * because measured AI COGS came in below target (§6).
 */

import type { Plan } from '@copilot/domain';

/** Fixed non-AI allocation per user per month, VND (§6). */
export const FIXED_ALLOCATION_VND = 30_000;
/** Revenue kept after 15% store/payment + 10% tax assumption (§6). */
export const REVENUE_RETENTION_FACTOR = 0.75;
/** The floor the model must never breach (§1, §6). */
export const CONTRIBUTION_MARGIN_FLOOR = 0.5;

export interface PlanCommercials {
  readonly plan: Plan;
  /** Monthly list price, VND. `null` for FREE. LOCKED §11. */
  readonly priceVnd: number | null;
  readonly aiTargetVnd: number;
  readonly aiCeilingVnd: number;
}

/** §1 pricing table + §5 AI budgets. LOCK NOW (§11). */
export const PLAN_COMMERCIALS: Readonly<Record<Plan, PlanCommercials>> = {
  free: { plan: 'free', priceVnd: null, aiTargetVnd: 1_500, aiCeilingVnd: 2_000 },
  basic: { plan: 'basic', priceVnd: 169_000, aiTargetVnd: 6_000, aiCeilingVnd: 8_000 },
  plus: { plan: 'plus', priceVnd: 229_000, aiTargetVnd: 14_000, aiCeilingVnd: 18_000 },
  pro: { plan: 'pro', priceVnd: 329_000, aiTargetVnd: 28_000, aiCeilingVnd: 35_000 },
};

export type MarginLight = 'GREEN' | 'YELLOW' | 'RED';

export interface MarginResult {
  readonly plan: Plan;
  readonly priceVnd: number;
  readonly aiCogsVnd: number;
  readonly contributionVnd: number;
  readonly marginPct: number; // 0..1 of revenue
  readonly light: MarginLight;
  readonly meetsFloor: boolean;
}

/** Contribution + margin for a plan at a given AI COGS. Throws for FREE (no price). */
export function contributionMargin(plan: Plan, aiCogsVnd: number): MarginResult {
  const c = PLAN_COMMERCIALS[plan];
  if (c.priceVnd === null) {
    throw new Error('FREE has no price — evaluate FREE against its AI ceiling, not margin');
  }
  const contributionVnd = REVENUE_RETENTION_FACTOR * c.priceVnd - FIXED_ALLOCATION_VND - aiCogsVnd;
  const marginPct = contributionVnd / c.priceVnd;
  return {
    plan,
    priceVnd: c.priceVnd,
    aiCogsVnd,
    contributionVnd,
    marginPct,
    light: marginLight(marginPct),
    meetsFloor: marginPct >= CONTRIBUTION_MARGIN_FLOOR,
  };
}

/** Traffic light (§6): GREEN > 55%, YELLOW 50–55%, RED < 50%. */
export function marginLight(marginPct: number): MarginLight {
  if (marginPct < 0.5) return 'RED';
  if (marginPct <= 0.55) return 'YELLOW';
  return 'GREEN';
}

/** Minimum list price that holds the 50% floor at a given AI COGS (§6). */
export function minimumPriceForFloor(aiCogsVnd: number): number {
  return 4 * (FIXED_ALLOCATION_VND + aiCogsVnd);
}

/** Evaluate every paid plan at target AND ceiling; used by cost reports + guardrail tests. */
export function marginTable(): {
  readonly atTarget: readonly MarginResult[];
  readonly atCeiling: readonly MarginResult[];
} {
  const paid: Plan[] = ['basic', 'plus', 'pro'];
  return {
    atTarget: paid.map((p) => contributionMargin(p, PLAN_COMMERCIALS[p].aiTargetVnd)),
    atCeiling: paid.map((p) => contributionMargin(p, PLAN_COMMERCIALS[p].aiCeilingVnd)),
  };
}
