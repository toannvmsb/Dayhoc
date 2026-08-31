import { describe, expect, it } from 'vitest';
import {
  checkBudget,
  cheaperThan,
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

describe('AI budget enforcement (§5, §8, §10.9)', () => {
  it('under target: a metered call is allowed', () => {
    const v = checkBudget({ plan: 'plus', state: state('plus', 2_000), estimatedCostVnd: 500, requestedTier: 'luna' });
    expect(v.allow).toBe(true);
    expect(v.phase).toBe('under_target');
  });

  it('over target but under ceiling: cheap tiers pass, the advanced tier is downgraded', () => {
    const overTarget = PLAN_COMMERCIALS.plus.aiTargetVnd + 1_000;
    const luna = checkBudget({ plan: 'plus', state: state('plus', overTarget), estimatedCostVnd: 200, requestedTier: 'luna' });
    expect(luna.allow).toBe(true);
    const adv = checkBudget({ plan: 'plus', state: state('plus', overTarget), estimatedCostVnd: 1_500, requestedTier: 'advanced' });
    expect(adv.allow).toBe(false); // downgraded despite headroom to the ceiling
    expect(adv.phase).toBe('over_target');
    expect(adv.fallback).toBe('luna');
  });

  it('hard ceiling: a call that would cross it is refused and degraded', () => {
    const nearCeiling = PLAN_COMMERCIALS.basic.aiCeilingVnd - 100;
    const v = checkBudget({ plan: 'basic', state: state('basic', nearCeiling), estimatedCostVnd: 500, requestedTier: 'luna' });
    expect(v.allow).toBe(false);
    expect(v.phase).toBe('at_ceiling');
    expect(v.fallback).toBe(cheaperThan('luna'));
  });

  it('deterministic / question-bank / cache paths never consult the budget', () => {
    const broke = state('free', PLAN_COMMERCIALS.free.aiCeilingVnd + 10_000);
    for (const tier of ['deterministic', 'question_bank', 'cache'] as const) {
      expect(checkBudget({ plan: 'free', state: broke, estimatedCostVnd: 0, requestedTier: tier }).allow).toBe(true);
    }
  });

  it('safety-critical calls bypass the budget entirely (§8)', () => {
    const broke = state('basic', PLAN_COMMERCIALS.basic.aiCeilingVnd + 5_000);
    const v = checkBudget({ plan: 'basic', state: broke, estimatedCostVnd: 3_000, requestedTier: 'advanced', safetyCritical: true });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('safety_critical_bypass');
  });

  it('GUARDRAIL: no retry / escalation loop can push metered spend past the ceiling (§10.9)', () => {
    for (const plan of ['free', 'basic', 'plus', 'pro'] as const) {
      const ceiling = PLAN_COMMERCIALS[plan].aiCeilingVnd;
      // 200 hammering attempts across every metered tier, starting already near the ceiling
      const attempts = Array.from({ length: 200 }, (_, i) => ({
        tier: (['luna', 'ocr_assist', 'advanced'] as const)[i % 3]!,
        estimatedCostVnd: 300 + (i % 5) * 250,
      }));
      const r = simulateEscalationLoop({ plan, startSpentVnd: Math.floor(ceiling * 0.9), attempts });
      expect(r.finalSpentVnd).toBeLessThanOrEqual(ceiling);
      expect(r.blockedAttempts).toBeGreaterThan(0);
    }
  });

  it('scan-page and worksheet limits follow the plan table (§5)', () => {
    expect(PLAN_SCAN_LIMITS.free.scanPagesPerMonth).toBe(2);
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
