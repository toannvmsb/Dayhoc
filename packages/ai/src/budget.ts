/**
 * AI budget enforcement (Pricing + AI Cost Guardrails v1.0 §5, §8, §10.9).
 *
 * Every plan has a per-user monthly AI budget with a soft TARGET and a hard
 * CEILING. Budget control is GRACEFUL — it degrades to cheaper paths, it never
 * bricks the product (§8). Two invariants the tests pin:
 *
 *   1. A retry / escalation loop can NEVER push spend past the hard ceiling
 *      (§10.9) — the ceiling check happens BEFORE each call and re-checks on
 *      escalation.
 *   2. Safety, correctness validation, privacy and deletion behaviour are never
 *      reduced to save AI cost (§8) — those paths do not consult the budget.
 */

import type { Plan } from '@copilot/domain';
import { PLAN_COMMERCIALS } from './margin.js';
import type { RoutingTier } from './routing.js';

export interface PlanScanLimits {
  readonly scanPagesPerMonth: number;
  readonly worksheetsPerWeek: number;
  readonly worksheetsPerMonth: number;
}

/** §5 quota limits per plan. */
export const PLAN_SCAN_LIMITS: Readonly<Record<Plan, PlanScanLimits>> = {
  free: { scanPagesPerMonth: 2, worksheetsPerWeek: 0, worksheetsPerMonth: 0 },
  basic: { scanPagesPerMonth: 8, worksheetsPerWeek: 2, worksheetsPerMonth: 8 },
  plus: { scanPagesPerMonth: 28, worksheetsPerWeek: 7, worksheetsPerMonth: 28 },
  pro: { scanPagesPerMonth: 60, worksheetsPerWeek: 15, worksheetsPerMonth: 60 },
};

export interface BudgetState {
  readonly plan: Plan;
  readonly billingMonth: string; // YYYY-MM
  readonly aiSpentVnd: number;
  readonly scanPagesUsed: number;
  readonly worksheetsUsed: number;
}

/** Persisted rollup port (table `plan_budget_ledger`). No update/delete of history. */
export interface BudgetLedger {
  get(userId: string, billingMonth: string): Promise<BudgetState | null>;
  /** Append actual spend after a call completed. */
  record(userId: string, event: { billingMonth: string; plan: Plan; costVnd: number; scanPages?: number; worksheets?: number }): Promise<void>;
}

export class InMemoryBudgetLedger implements BudgetLedger {
  readonly #rows = new Map<string, BudgetState>();
  #key(u: string, m: string): string {
    return `${u}::${m}`;
  }
  get(userId: string, billingMonth: string): Promise<BudgetState | null> {
    return Promise.resolve(this.#rows.get(this.#key(userId, billingMonth)) ?? null);
  }
  record(
    userId: string,
    event: { billingMonth: string; plan: Plan; costVnd: number; scanPages?: number; worksheets?: number },
  ): Promise<void> {
    const k = this.#key(userId, event.billingMonth);
    const prev = this.#rows.get(k) ?? {
      plan: event.plan,
      billingMonth: event.billingMonth,
      aiSpentVnd: 0,
      scanPagesUsed: 0,
      worksheetsUsed: 0,
    };
    this.#rows.set(k, {
      plan: event.plan,
      billingMonth: event.billingMonth,
      aiSpentVnd: prev.aiSpentVnd + Math.max(0, event.costVnd),
      scanPagesUsed: prev.scanPagesUsed + (event.scanPages ?? 0),
      worksheetsUsed: prev.worksheetsUsed + (event.worksheets ?? 0),
    });
    return Promise.resolve();
  }
}

export type BudgetPhase = 'under_target' | 'over_target' | 'at_ceiling';

export interface BudgetVerdict {
  readonly phase: BudgetPhase;
  readonly spentVnd: number;
  readonly targetVnd: number;
  readonly ceilingVnd: number;
  readonly remainingToCeilingVnd: number;
  /** May this specific call proceed as requested? */
  readonly allow: boolean;
  /** When not allowed (or degraded), the cheaper path to take instead. */
  readonly fallback: RoutingTier | null;
  readonly reason: string;
}

/**
 * Graceful fallback order (§8). `deterministic` / `question_bank` / `cache` are
 * always available; paid AI tiers switch off as budget tightens.
 */
export const FALLBACK_ORDER: readonly RoutingTier[] = [
  'deterministic',
  'question_bank',
  'cache',
  'luna',
  'ocr_assist',
  'advanced',
];

const FREE_ALWAYS_OK = new Set<RoutingTier>(['deterministic', 'question_bank', 'cache']);

export interface BudgetCheckInput {
  readonly plan: Plan;
  readonly state: BudgetState | null;
  /** Estimated VND cost of the call about to be made. */
  readonly estimatedCostVnd: number;
  /** Tier the router wants to use. */
  readonly requestedTier: RoutingTier;
  /**
   * Safety-critical calls (privacy, deletion, correctness validation) bypass the
   * budget entirely (§8). The caller asserts this; it is never inferred.
   */
  readonly safetyCritical?: boolean;
}

/**
 * Decide whether a call may run, or which cheaper path to take. Pure — the
 * caller records actual spend afterwards via `BudgetLedger.record`.
 */
export function checkBudget(input: BudgetCheckInput): BudgetVerdict {
  const c = PLAN_COMMERCIALS[input.plan];
  const target = c.aiTargetVnd;
  const ceiling = c.aiCeilingVnd;
  const spent = input.state?.aiSpentVnd ?? 0;
  const remaining = ceiling - spent;
  const projected = spent + Math.max(0, input.estimatedCostVnd);

  const base = { spentVnd: spent, targetVnd: target, ceilingVnd: ceiling, remainingToCeilingVnd: Math.max(0, remaining) };

  if (input.safetyCritical) {
    return { ...base, phase: phaseOf(spent, target, ceiling), allow: true, fallback: null, reason: 'safety_critical_bypass' };
  }

  if (FREE_ALWAYS_OK.has(input.requestedTier)) {
    return { ...base, phase: phaseOf(spent, target, ceiling), allow: true, fallback: null, reason: 'non_metered_path' };
  }

  // Hard ceiling: the call may not run if it would cross the ceiling (§10.9).
  if (projected > ceiling) {
    return {
      ...base,
      phase: 'at_ceiling',
      allow: false,
      fallback: cheaperThan(input.requestedTier),
      reason: spent >= ceiling ? 'ceiling_reached' : 'call_would_exceed_ceiling',
    };
  }

  // Over target but under ceiling: allow, but prefer to degrade the advanced tier.
  if (projected > target) {
    if (input.requestedTier === 'advanced') {
      return { ...base, phase: 'over_target', allow: false, fallback: 'luna', reason: 'over_target_advanced_downgraded' };
    }
    return { ...base, phase: 'over_target', allow: true, fallback: null, reason: 'over_target_cheap_tier_ok' };
  }

  return { ...base, phase: 'under_target', allow: true, fallback: null, reason: 'within_target' };
}

function phaseOf(spent: number, target: number, ceiling: number): BudgetPhase {
  if (spent >= ceiling) return 'at_ceiling';
  if (spent > target) return 'over_target';
  return 'under_target';
}

/** Next tier strictly cheaper than `tier` in the fallback order (or the cheapest). */
export function cheaperThan(tier: RoutingTier): RoutingTier {
  const i = FALLBACK_ORDER.indexOf(tier);
  if (i <= 0) return 'deterministic';
  return FALLBACK_ORDER[i - 1]!;
}

/**
 * Guardrail (§10.9): simulate a retry/escalation loop and prove total metered
 * spend can never exceed the ceiling. Returns the final spend; throws if a step
 * was ever allowed that crossed the ceiling.
 */
export function simulateEscalationLoop(params: {
  plan: Plan;
  startSpentVnd: number;
  attempts: readonly { tier: RoutingTier; estimatedCostVnd: number }[];
}): { finalSpentVnd: number; allowedAttempts: number; blockedAttempts: number } {
  const ceiling = PLAN_COMMERCIALS[params.plan].aiCeilingVnd;
  let spent = params.startSpentVnd;
  let allowed = 0;
  let blocked = 0;
  for (const a of params.attempts) {
    const state: BudgetState = {
      plan: params.plan,
      billingMonth: '2026-09',
      aiSpentVnd: spent,
      scanPagesUsed: 0,
      worksheetsUsed: 0,
    };
    const v = checkBudget({ plan: params.plan, state, estimatedCostVnd: a.estimatedCostVnd, requestedTier: a.tier });
    if (v.allow && !FREE_ALWAYS_OK.has(a.tier)) {
      spent += Math.max(0, a.estimatedCostVnd);
      allowed += 1;
      if (spent > ceiling) throw new Error(`ceiling bypassed: spent ${spent} > ceiling ${ceiling}`);
    } else if (v.allow) {
      allowed += 1; // non-metered, no spend
    } else {
      blocked += 1;
    }
  }
  return { finalSpentVnd: spent, allowedAttempts: allowed, blockedAttempts: blocked };
}
