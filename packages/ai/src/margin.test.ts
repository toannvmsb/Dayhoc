import { describe, expect, it } from 'vitest';
import {
  absoluteBoundaryVnd,
  CONTRIBUTION_MARGIN_FLOOR,
  contributionMargin,
  marginTable,
  minimumPriceForFloor,
  PLAN_COMMERCIALS,
} from './margin.js';

/**
 * Reproduces `pricing_guardrails_v1.1.yaml`. If the model or the constants drift,
 * these break.
 */
describe('commercial margin model (Pricing v1.1 §5)', () => {
  it('matches the published "at target AI COGS" table', () => {
    const t = Object.fromEntries(marginTable().atTarget.map((r) => [r.plan, r]));
    expect(t.basic!.contributionVnd).toBe(88_750);
    expect(t.plus!.contributionVnd).toBe(126_750);
    expect(t.pro!.contributionVnd).toBe(188_750);
    expect(t.basic!.marginPct).toBeCloseTo(0.5251, 4);
    expect(t.plus!.marginPct).toBeCloseTo(0.5535, 4);
    expect(t.pro!.marginPct).toBeCloseTo(0.5737, 4);
  });

  it('matches the published "at operational ceiling" table', () => {
    const t = Object.fromEntries(marginTable().atOperationalCeiling.map((r) => [r.plan, r]));
    expect(t.basic!.contributionVnd).toBe(86_750);
    expect(t.plus!.contributionVnd).toBe(119_750);
    expect(t.pro!.contributionVnd).toBe(176_750);
    expect(t.basic!.marginPct).toBeCloseTo(0.5133, 4);
    expect(t.plus!.marginPct).toBeCloseTo(0.5229, 4);
    expect(t.pro!.marginPct).toBeCloseTo(0.5372, 4);
  });

  it('every paid plan stays above the 50% floor at the operational ceiling', () => {
    for (const r of marginTable().atOperationalCeiling) {
      expect(r.marginPct, r.plan).toBeGreaterThanOrEqual(CONTRIBUTION_MARGIN_FLOOR);
      expect(r.meetsFloor).toBe(true);
    }
  });

  it('the three thresholds are ordered: target < operational ceiling < absolute boundary', () => {
    for (const p of ['basic', 'plus', 'pro'] as const) {
      const c = PLAN_COMMERCIALS[p];
      expect(c.aiTargetVnd).toBeLessThan(c.aiOperationalCeilingVnd);
      expect(c.aiOperationalCeilingVnd).toBeLessThan(c.absoluteBoundaryVnd!);
    }
  });

  it('absolute boundary = Price × 25% − 30K, matching the locked values', () => {
    expect(absoluteBoundaryVnd('basic')).toBe(12_250);
    expect(absoluteBoundaryVnd('plus')).toBe(27_250);
    expect(absoluteBoundaryVnd('pro')).toBe(52_250);
    for (const p of ['basic', 'plus', 'pro'] as const) {
      expect(PLAN_COMMERCIALS[p].absoluteBoundaryVnd).toBe(Math.round(absoluteBoundaryVnd(p)));
    }
    // at the absolute boundary the modeled margin is exactly the 50% floor
    expect(contributionMargin('basic', 12_250).marginPct).toBeCloseTo(0.5, 6);
  });

  it('minimum price formula = 4 × (30K + AI_COGS)', () => {
    expect(minimumPriceForFloor(8_000)).toBe(152_000);
    expect(minimumPriceForFloor(28_000)).toBe(232_000);
    for (const p of ['basic', 'plus', 'pro'] as const) {
      const c = PLAN_COMMERCIALS[p];
      expect(c.priceVnd!).toBeGreaterThanOrEqual(minimumPriceForFloor(c.aiTargetVnd));
    }
  });

  it('FREE has no price — judged against its operational ceiling (3,000đ)', () => {
    expect(PLAN_COMMERCIALS.free.priceVnd).toBeNull();
    expect(() => contributionMargin('free', 1_000)).toThrow(/FREE/);
    expect(PLAN_COMMERCIALS.free.aiTargetVnd).toBe(2_000);
    expect(PLAN_COMMERCIALS.free.aiOperationalCeilingVnd).toBe(3_000);
  });

  it('a plan breaching its absolute boundary drops below the 50% floor', () => {
    const blown = contributionMargin('basic', 16_000);
    expect(blown.meetsFloor).toBe(false);
  });
});
