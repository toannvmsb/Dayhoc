import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_MARGIN_FLOOR,
  contributionMargin,
  marginLight,
  marginTable,
  minimumPriceForFloor,
  PLAN_COMMERCIALS,
} from './margin.js';

/**
 * Reproduces the tables in Pricing + AI Cost Guardrails v1.0 §6. If the model
 * or the constants drift, these break.
 */
describe('commercial margin model (§6)', () => {
  it('matches the published "at target AI COGS" table', () => {
    const t = Object.fromEntries(marginTable().atTarget.map((r) => [r.plan, r]));
    expect(t.basic!.contributionVnd).toBe(90_750);
    expect(t.plus!.contributionVnd).toBe(127_750);
    expect(t.pro!.contributionVnd).toBe(188_750);
    expect(t.basic!.marginPct).toBeCloseTo(0.537, 3);
    expect(t.plus!.marginPct).toBeCloseTo(0.558, 3);
    expect(t.pro!.marginPct).toBeCloseTo(0.574, 3);
  });

  it('matches the published "at AI hard ceiling" table', () => {
    const t = Object.fromEntries(marginTable().atCeiling.map((r) => [r.plan, r]));
    expect(t.basic!.contributionVnd).toBe(88_750);
    expect(t.plus!.contributionVnd).toBe(123_750);
    expect(t.pro!.contributionVnd).toBe(181_750);
    expect(t.basic!.marginPct).toBeCloseTo(0.525, 3);
    expect(t.plus!.marginPct).toBeCloseTo(0.54, 2);
    expect(t.pro!.marginPct).toBeCloseTo(0.552, 3);
  });

  it('every paid plan stays above the 50% floor even at the AI hard ceiling', () => {
    for (const r of marginTable().atCeiling) {
      expect(r.marginPct, r.plan).toBeGreaterThanOrEqual(CONTRIBUTION_MARGIN_FLOOR);
      expect(r.meetsFloor).toBe(true);
    }
  });

  it('traffic light thresholds: GREEN > 55%, YELLOW 50–55%, RED < 50%', () => {
    expect(marginLight(0.56)).toBe('GREEN');
    expect(marginLight(0.55)).toBe('YELLOW');
    expect(marginLight(0.5)).toBe('YELLOW');
    expect(marginLight(0.4999)).toBe('RED');
  });

  it('minimum price formula = 4 × (30K + AI_COGS)', () => {
    expect(minimumPriceForFloor(6_000)).toBe(144_000);
    expect(minimumPriceForFloor(28_000)).toBe(232_000);
    // the locked prices clear their own minimum at target COGS
    for (const p of ['basic', 'plus', 'pro'] as const) {
      const c = PLAN_COMMERCIALS[p];
      expect(c.priceVnd!).toBeGreaterThanOrEqual(minimumPriceForFloor(c.aiTargetVnd));
    }
  });

  it('FREE has no margin — it is judged against its AI ceiling instead', () => {
    expect(PLAN_COMMERCIALS.free.priceVnd).toBeNull();
    expect(() => contributionMargin('free', 1_000)).toThrow(/FREE/);
    expect(PLAN_COMMERCIALS.free.aiCeilingVnd).toBe(2_000);
  });

  it('a plan breaching its ceiling would drop below the floor (why the ceiling exists)', () => {
    // basic at ~2× ceiling
    const blown = contributionMargin('basic', 16_000);
    expect(blown.meetsFloor).toBe(false);
    expect(blown.light).toBe('RED');
  });
});
