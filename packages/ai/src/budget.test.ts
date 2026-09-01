import { describe, expect, it } from 'vitest';
import {
  checkBudget,
  cheaperThan,
  evaluateGuardrail,
  guardrailThresholdsAreOrdered,
  InMemoryBudgetLedger,
  PLAN_SCAN_LIMITS,
  simulateEscalationLoop,
  type BudgetState,
} from './budget.js';
import { PLAN_COMMERCIALS } from './margin.js';

const month = '2026-09';
const state = (plan: BudgetState['plan'], aiSpentVnd: number): BudgetState => ({
  plan,
  billingMonth: month,
  aiSpentVnd,
  scanPagesUsed: 0,
  worksheetsUsed: 0,
});

describe('per-call budget gate (Pricing v1.1 §9)', () => {
  it('under target: a metered call is allowed', () => {
    const v = checkBudget({ plan: 'plus', state: state('plus', 2_000), estimatedCostVnd: 500, requestedTier: 'luna' });
    expect(v.allow).toBe(true);
    expect(v.phase).toBe('under_target');
  });

  it('over target but under operational ceiling: cheap tiers pass, advanced is downgraded', () => {
    const overTarget = PLAN_COMMERCIALS.plus.aiTargetVnd + 1_000; // 16,000 (< 22,000 ceiling)
    expect(checkBudget({ plan: 'plus', state: state('plus', overTarget), estimatedCostVnd: 200, requestedTier: 'luna' }).allow).toBe(true);
    const adv = checkBudget({ plan: 'plus', state: state('plus', overTarget), estimatedCostVnd: 1_500, requestedTier: 'advanced' });
    expect(adv.allow).toBe(false);
    expect(adv.phase).toBe('over_target');
    expect(adv.fallback).toBe('luna');
  });

  it('operational ceiling: a call that would cross it is refused and degraded', () => {
    const nearCeiling = PLAN_COMMERCIALS.basic.aiOperationalCeilingVnd - 100;
    const v = checkBudget({ plan: 'basic', state: state('basic', nearCeiling), estimatedCostVnd: 500, requestedTier: 'luna' });
    expect(v.allow).toBe(false);
    expect(v.phase).toBe('at_ceiling');
    expect(v.fallback).toBe(cheaperThan('luna'));
  });

  it('deterministic / cache paths never consult the budget', () => {
    const broke = state('free', PLAN_COMMERCIALS.free.aiOperationalCeilingVnd + 10_000);
    for (const tier of ['deterministic', 'cache'] as const) {
      expect(checkBudget({ plan: 'free', state: broke, estimatedCostVnd: 0, requestedTier: tier }).allow).toBe(true);
    }
  });

  it('safety-critical calls bypass the budget entirely (§11)', () => {
    const broke = state('basic', PLAN_COMMERCIALS.basic.aiOperationalCeilingVnd + 5_000);
    const v = checkBudget({ plan: 'basic', state: broke, estimatedCostVnd: 3_000, requestedTier: 'advanced', safetyCritical: true });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('safety_critical_bypass');
  });

  it('GUARDRAIL: no retry / escalation loop pushes metered spend past the operational ceiling', () => {
    for (const plan of ['free', 'basic', 'plus', 'pro'] as const) {
      const ceiling = PLAN_COMMERCIALS[plan].aiOperationalCeilingVnd;
      const attempts = Array.from({ length: 200 }, (_, i) => ({
        tier: (['luna', 'ocr_assist', 'advanced'] as const)[i % 3]!,
        estimatedCostVnd: 300 + (i % 5) * 250,
      }));
      const r = simulateEscalationLoop({ plan, startSpentVnd: Math.floor(ceiling * 0.9), attempts });
      expect(r.finalSpentVnd).toBeLessThanOrEqual(ceiling);
      expect(r.blockedAttempts).toBeGreaterThan(0);
    }
  });

  it('scan / worksheet / free-AI-days limits follow the plan table (§6)', () => {
    expect(PLAN_SCAN_LIMITS.free.scanPagesPerMonth).toBe(2);
    expect(PLAN_SCAN_LIMITS.free.aiPracticeDaysPerMonth).toBe(10);
    expect(PLAN_SCAN_LIMITS.basic.worksheetsPerMonth).toBe(8);
    expect(PLAN_SCAN_LIMITS.plus.worksheetsPerWeek).toBe(7);
    expect(PLAN_SCAN_LIMITS.pro.scanPagesPerMonth).toBe(60);
  });

  it('the in-memory ledger accumulates spend and never loses history', async () => {
    const ledger = new InMemoryBudgetLedger();
    await ledger.record('u1', { billingMonth: month, plan: 'plus', costVnd: 1_200, scanPages: 1 });
    await ledger.record('u1', { billingMonth: month, plan: 'plus', costVnd: 800, scanPages: 2 });
    const s = await ledger.get('u1', month);
    expect(s?.aiSpentVnd).toBe(2_000);
    expect(s?.scanPagesUsed).toBe(3);
    expect(await ledger.get('u1', '2026-10')).toBeNull();
  });
});

describe('AIBudgetGuardrail — 4 states (Pricing v1.1 §11)', () => {
  it('thresholds are ordered and match the margin formula', () => {
    expect(guardrailThresholdsAreOrdered()).toBe(true);
  });

  it('GREEN below target', () => {
    const v = evaluateGuardrail('plus', PLAN_COMMERCIALS.plus.aiTargetVnd - 1);
    expect(v.state).toBe('GREEN');
    expect(v.actions).toEqual([]);
  });

  it('YELLOW between target and operational ceiling — optimize, do not degrade quality', () => {
    const v = evaluateGuardrail('plus', 18_000); // 15K < 18K < 22K
    expect(v.state).toBe('YELLOW');
    expect(v.actions).toContain('improve_caching_and_batching');
    expect(v.requiresApproval).toBe(false);
  });

  it('TEST 12 — RED above the operational ceiling: abuse controls + force default route', () => {
    const v = evaluateGuardrail('basic', PLAN_COMMERCIALS.basic.aiOperationalCeilingVnd + 500); // 10.5K, < 12.25K boundary
    expect(v.state).toBe('RED');
    expect(v.actions).toContain('block_pathological_retry_loops');
    expect(v.actions).toContain('force_standard_tasks_to_default_route');
    // RED preserves educationally necessary escalation — never a quality cut
    expect(v.actions).toContain('preserve_educationally_necessary_advanced_escalation');
  });

  it('TEST 13 — BLOCKER when projected economics cross the absolute 50% boundary', () => {
    const v = evaluateGuardrail('plus', PLAN_COMMERCIALS.plus.absoluteBoundaryVnd! + 1); // > 27,250
    expect(v.state).toBe('BLOCKER');
    expect(v.requiresApproval).toBe(true);
    expect(v.actions).toContain('product_finance_approval_required');
  });

  it('FREE has no absolute boundary — never BLOCKER, RED above its ceiling', () => {
    expect(evaluateGuardrail('free', 10_000).state).toBe('RED');
  });
});
