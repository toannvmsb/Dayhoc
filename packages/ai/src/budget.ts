/**
 * AI budget enforcement (Pricing/AI Cost/Routing **v1.1** §6, §9, §11,
 * `ai_budget_guardrails_v1.1.yaml`). See docs/implementation/15_AI_COST_AND_MODEL_ROUTING.md.
 *
 * Two layers:
 *  - `checkBudget(...)` — per-call gate. Graceful: degrades to cheaper paths,
 *    never bricks the product. A retry/escalation loop can NEVER push spend past
 *    the operational ceiling (checked before every call, re-checked on escalation).
 *  - `AIBudgetGuardrail` — monthly projection → GREEN / YELLOW / RED / BLOCKER.
 *
 * Safety-critical work (privacy, deletion, correctness validation) never consults
 * the budget. RED never lowers core educational quality — it targets routing,
 * retry loops and abuse first (v1.1 §11).
 */

import type { Plan } from '@copilot/domain';
import { absoluteBoundaryVnd, PLAN_COMMERCIALS } from './margin.js';
import type { RoutingTier } from './routing.js';

export interface PlanScanLimits {
  readonly scanPagesPerMonth: number;
  readonly worksheetsPerWeek: number;
  readonly worksheetsPerMonth: number;
  /** v1.1 §6 FREE: planning assumption ~10 AI-generated practice days/month. */
  readonly aiPracticeDaysPerMonth: number | 'unbounded';
}

/** v1.1 §6 plan behaviour. */
export const PLAN_SCAN_LIMITS: Readonly<Record<Plan, PlanScanLimits>> = {
  free: { scanPagesPerMonth: 2, worksheetsPerWeek: 0, worksheetsPerMonth: 0, aiPracticeDaysPerMonth: 10 },
  basic: { scanPagesPerMonth: 8, worksheetsPerWeek: 2, worksheetsPerMonth: 8, aiPracticeDaysPerMonth: 'unbounded' },
  plus: { scanPagesPerMonth: 28, worksheetsPerWeek: 7, worksheetsPerMonth: 28, aiPracticeDaysPerMonth: 'unbounded' },
  pro: { scanPagesPerMonth: 60, worksheetsPerWeek: 15, worksheetsPerMonth: 60, aiPracticeDaysPerMonth: 'unbounded' },
};

export interface BudgetState {
  readonly plan: Plan;
  readonly billingMonth: string; // YYYY-MM
  readonly aiSpentVnd: number;
  readonly scanPagesUsed: number;
  readonly worksheetsUsed: number;
}

/** Persisted rollup port (table `plan_budget_ledger`). Immutable history is `ai_usage_events`. */
export interface BudgetLedger {
  get(userId: string, billingMonth: string): Promise<BudgetState | null>;
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
  readonly operationalCeilingVnd: number;
  readonly remainingToCeilingVnd: number;
  readonly allow: boolean;
  readonly fallback: RoutingTier | null;
  readonly reason: string;
}

/** Graceful fallback order (v1.1 §9). Non-metered paths are always available. */
export const FALLBACK_ORDER: readonly RoutingTier[] = [
  'deterministic',
  'cache',
  'luna',
  'ocr_assist',
  'advanced',
];

const FREE_ALWAYS_OK = new Set<RoutingTier>(['deterministic', 'cache']);

export interface BudgetCheckInput {
  readonly plan: Plan;
  readonly state: BudgetState | null;
  readonly estimatedCostVnd: number;
  readonly requestedTier: RoutingTier;
  /** Privacy / deletion / correctness validation — bypasses the budget (v1.1 §11). Never inferred. */
  readonly safetyCritical?: boolean;
}

/** Per-call gate. Pure — the caller records actual spend afterwards. */
export function checkBudget(input: BudgetCheckInput): BudgetVerdict {
  const c = PLAN_COMMERCIALS[input.plan];
  const target = c.aiTargetVnd;
  const ceiling = c.aiOperationalCeilingVnd;
  const spent = input.state?.aiSpentVnd ?? 0;
  const remaining = ceiling - spent;
  const projected = spent + Math.max(0, input.estimatedCostVnd);

  const base = { spentVnd: spent, targetVnd: target, operationalCeilingVnd: ceiling, remainingToCeilingVnd: Math.max(0, remaining) };

  if (input.safetyCritical) {
    return { ...base, phase: phaseOf(spent, target, ceiling), allow: true, fallback: null, reason: 'safety_critical_bypass' };
  }
  if (FREE_ALWAYS_OK.has(input.requestedTier)) {
    return { ...base, phase: phaseOf(spent, target, ceiling), allow: true, fallback: null, reason: 'non_metered_path' };
  }

  // Operational ceiling: the call may not run if it would cross it.
  if (projected > ceiling) {
    return {
      ...base,
      phase: 'at_ceiling',
      allow: false,
      fallback: cheaperThan(input.requestedTier),
      reason: spent >= ceiling ? 'ceiling_reached' : 'call_would_exceed_ceiling',
    };
  }
  // Over target, under ceiling: cheap tiers pass; the advanced tier is downgraded.
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

/** Next tier strictly cheaper than `tier` (or the cheapest). */
export function cheaperThan(tier: RoutingTier): RoutingTier {
  const i = FALLBACK_ORDER.indexOf(tier);
  if (i <= 0) return 'deterministic';
  return FALLBACK_ORDER[i - 1]!;
}

/** Prove a retry/escalation loop can never cross the operational ceiling. */
export function simulateEscalationLoop(params: {
  plan: Plan;
  startSpentVnd: number;
  attempts: readonly { tier: RoutingTier; estimatedCostVnd: number }[];
}): { finalSpentVnd: number; allowedAttempts: number; blockedAttempts: number } {
  const ceiling = PLAN_COMMERCIALS[params.plan].aiOperationalCeilingVnd;
  let spent = params.startSpentVnd;
  let allowed = 0;
  let blocked = 0;
  for (const a of params.attempts) {
    const state: BudgetState = { plan: params.plan, billingMonth: '2026-09', aiSpentVnd: spent, scanPagesUsed: 0, worksheetsUsed: 0 };
    const v = checkBudget({ plan: params.plan, state, estimatedCostVnd: a.estimatedCostVnd, requestedTier: a.tier });
    if (v.allow && !FREE_ALWAYS_OK.has(a.tier)) {
      spent += Math.max(0, a.estimatedCostVnd);
      allowed += 1;
      if (spent > ceiling) throw new Error(`ceiling bypassed: spent ${spent} > ceiling ${ceiling}`);
    } else if (v.allow) {
      allowed += 1;
    } else {
      blocked += 1;
    }
  }
  return { finalSpentVnd: spent, allowedAttempts: allowed, blockedAttempts: blocked };
}

/* ---------------------------------------------------------------- *
 * AIBudgetGuardrail — monthly projection state (v1.1 §11)          *
 * ---------------------------------------------------------------- */

export type GuardrailState = 'GREEN' | 'YELLOW' | 'RED' | 'BLOCKER';

export interface GuardrailVerdict {
  readonly plan: Plan;
  readonly projectedCogsVnd: number;
  readonly targetVnd: number;
  readonly operationalCeilingVnd: number;
  readonly absoluteBoundaryVnd: number | null;
  readonly state: GuardrailState;
  /** Ordered actions to take at this state — quality is never the first lever. */
  readonly actions: readonly string[];
  /** BLOCKER requires product/finance sign-off before rollout. */
  readonly requiresApproval: boolean;
}

const ACTIONS_YELLOW = [
  'inspect_usage',
  'improve_caching_and_batching',
  'reduce_unnecessary_verifier_calls',
  'improve_routing',
  'detect_retry_bugs',
];
const ACTIONS_RED = [
  'identify_abuse_or_anomaly',
  'block_pathological_retry_loops',
  'restrict_non_essential_expensive_ops',
  'force_standard_tasks_to_default_route',
  'preserve_educationally_necessary_advanced_escalation',
];

/**
 * Evaluate a plan's projected monthly AI COGS against the three v1.1 thresholds.
 * `projectedCogsVnd` comes from `AICostLedger.forecastByOperation(...)`.
 */
export function evaluateGuardrail(plan: Plan, projectedCogsVnd: number): GuardrailVerdict {
  const c = PLAN_COMMERCIALS[plan];
  const boundary = c.absoluteBoundaryVnd;
  const base = {
    plan,
    projectedCogsVnd,
    targetVnd: c.aiTargetVnd,
    operationalCeilingVnd: c.aiOperationalCeilingVnd,
    absoluteBoundaryVnd: boundary,
  };
  if (boundary !== null && projectedCogsVnd > boundary) {
    return { ...base, state: 'BLOCKER', actions: ['halt_rollout', 'product_finance_approval_required'], requiresApproval: true };
  }
  if (projectedCogsVnd > c.aiOperationalCeilingVnd) {
    return { ...base, state: 'RED', actions: ACTIONS_RED, requiresApproval: false };
  }
  if (projectedCogsVnd > c.aiTargetVnd) {
    return { ...base, state: 'YELLOW', actions: ACTIONS_YELLOW, requiresApproval: false };
  }
  return { ...base, state: 'GREEN', actions: [], requiresApproval: false };
}

/** Sanity: for every paid plan, target < operational ceiling < absolute boundary. */
export function guardrailThresholdsAreOrdered(): boolean {
  return (['basic', 'plus', 'pro'] as const).every((p) => {
    const c = PLAN_COMMERCIALS[p];
    return (
      c.aiTargetVnd < c.aiOperationalCeilingVnd &&
      c.aiOperationalCeilingVnd < (c.absoluteBoundaryVnd ?? Infinity) &&
      c.absoluteBoundaryVnd === Math.round(absoluteBoundaryVnd(p))
    );
  });
}
