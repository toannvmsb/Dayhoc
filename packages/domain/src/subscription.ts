/**
 * Subscription plans (Pricing + AI Cost Guardrails v1.0 §1).
 *
 * These names are a stable vocabulary shared by billing, the AI budget engine
 * and cost telemetry. Prices and AI budgets live in configuration
 * (`@copilot/ai` pricing/budget registries), NOT here — this file is only the
 * enum so pure code can be plan-aware without importing money constants.
 */
export const PLANS = ['free', 'basic', 'plus', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export const PAID_PLANS = ['basic', 'plus', 'pro'] as const satisfies readonly Plan[];

export function isPaidPlan(plan: Plan): boolean {
  return plan !== 'free';
}
