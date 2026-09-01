/**
 * Commercial margin model (Pricing + AI Cost Guardrails **v1.1** §5).
 * Source: `File du an/AI_Parent_Learning_Copilot_Pricing_AI_Cost_Routing_v1.1.zip`
 * → `pricing_guardrails_v1.1.yaml`. See docs/implementation/15_AI_COST_AND_MODEL_ROUTING.md.
 *
 *   Modeled Profit = Price × 75% − 30,000đ − AI_COGS
 *
 * where 30,000đ = 10,000đ server/data + 20,000đ HR/marketing allocation, and the
 * 0.75 factor absorbs 15% store/payment + 10% tax reserve on revenue.
 *
 * `Max AI COGS at the 50% modeled-margin floor = Price × 25% − 30,000đ`.
 *
 * v1.1 has THREE thresholds per plan: `aiTargetVnd` < `aiOperationalCeilingVnd` <
 * `absoluteBoundaryVnd` (the 50%-floor line). Operational ceilings sit
 * deliberately below the absolute boundary. Prices are LOCKED — do not lower a
 * price because measured AI COGS came in low (v1.1 §5).
 *
 * Contribution-style planning model, NOT final accounting profit.
 */

import type { Plan } from '@copilot/domain';

/** Fixed non-AI allocation per paid user per month, VND (v1.1 §5). */
export const FIXED_ALLOCATION_VND = 30_000;
/** Revenue kept after 15% store/payment + 10% tax reserve (v1.1 §5). */
export const REVENUE_RETENTION_FACTOR = 0.75;
/** The modeled-margin floor the paid plans must never breach. */
export const CONTRIBUTION_MARGIN_FLOOR = 0.5;

export interface PlanCommercials {
  readonly plan: Plan;
  /** Monthly list price, VND. `null` for FREE. LOCKED (v1.1 §5). */
  readonly priceVnd: number | null;
  /** Soft budget — GREEN below this. */
  readonly aiTargetVnd: number;
  /** Operational ceiling — YELLOW between target and this; RED above. */
  readonly aiOperationalCeilingVnd: number;
  /**
   * Absolute AI COGS at which the modeled margin hits 50% — crossing it (in
   * projection) is a BLOCKER. `null` for FREE (judged against its ceiling only).
   */
  readonly absoluteBoundaryVnd: number | null;
}

/** v1.1 `pricing_guardrails_v1.1.yaml` — LOCKED. */
export const PLAN_COMMERCIALS: Readonly<Record<Plan, PlanCommercials>> = {
  free: { plan: 'free', priceVnd: null, aiTargetVnd: 2_000, aiOperationalCeilingVnd: 3_000, absoluteBoundaryVnd: null },
  basic: { plan: 'basic', priceVnd: 169_000, aiTargetVnd: 8_000, aiOperationalCeilingVnd: 10_000, absoluteBoundaryVnd: 12_250 },
  plus: { plan: 'plus', priceVnd: 229_000, aiTargetVnd: 15_000, aiOperationalCeilingVnd: 22_000, absoluteBoundaryVnd: 27_250 },
  pro: { plan: 'pro', priceVnd: 329_000, aiTargetVnd: 28_000, aiOperationalCeilingVnd: 40_000, absoluteBoundaryVnd: 52_250 },
};

export interface MarginResult {
  readonly plan: Plan;
  readonly priceVnd: number;
  readonly aiCogsVnd: number;
  readonly contributionVnd: number;
  readonly marginPct: number; // 0..1 of revenue
  readonly meetsFloor: boolean;
}

/** Contribution + modeled margin for a plan at a given AI COGS. Throws for FREE (no price). */
export function contributionMargin(plan: Plan, aiCogsVnd: number): MarginResult {
  const c = PLAN_COMMERCIALS[plan];
  if (c.priceVnd === null) {
    throw new Error('FREE has no price — evaluate FREE against its operational ceiling, not margin');
  }
  const contributionVnd = REVENUE_RETENTION_FACTOR * c.priceVnd - FIXED_ALLOCATION_VND - aiCogsVnd;
  const marginPct = contributionVnd / c.priceVnd;
  return {
    plan,
    priceVnd: c.priceVnd,
    aiCogsVnd,
    contributionVnd,
    marginPct,
    meetsFloor: marginPct >= CONTRIBUTION_MARGIN_FLOOR,
  };
}

/**
 * The AI COGS at which `plan` hits the 50% modeled-margin floor.
 * `Price × 75% − 30K − COGS = Price × 50%  ⇒  COGS = Price × 25% − 30K`.
 */
export function absoluteBoundaryVnd(plan: Plan): number {
  const c = PLAN_COMMERCIALS[plan];
  if (c.priceVnd === null) throw new Error('FREE has no margin boundary');
  return c.priceVnd * (REVENUE_RETENTION_FACTOR - CONTRIBUTION_MARGIN_FLOOR) - FIXED_ALLOCATION_VND;
}

/** Minimum list price that holds the 50% floor at a given AI COGS: `4 × (30K + AI_COGS)`. */
export function minimumPriceForFloor(aiCogsVnd: number): number {
  return 4 * (FIXED_ALLOCATION_VND + aiCogsVnd);
}

/** Evaluate every paid plan at target AND operational ceiling — for cost reports + guardrail tests. */
export function marginTable(): {
  readonly atTarget: readonly MarginResult[];
  readonly atOperationalCeiling: readonly MarginResult[];
} {
  const paid: Plan[] = ['basic', 'plus', 'pro'];
  return {
    atTarget: paid.map((p) => contributionMargin(p, PLAN_COMMERCIALS[p].aiTargetVnd)),
    atOperationalCeiling: paid.map((p) => contributionMargin(p, PLAN_COMMERCIALS[p].aiOperationalCeilingVnd)),
  };
}
