import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  ocrCostUsd,
  PLANNING_FX_VND_PER_USD,
  PricingRegistry,
  tokenCostUsd,
  usdToVnd,
} from './pricing.js';

describe('AI pricing registry (§2, §10.6)', () => {
  const reg = new PricingRegistry();

  it('carries the v1.0 published prices', () => {
    expect(reg.priceAt('gpt-5.6-luna').inputPerMillionUsd).toBe(0.2);
    expect(reg.priceAt('gpt-5.6-luna').outputPerMillionUsd).toBe(1.2);
    expect(reg.priceAt('claude-sonnet-5').outputPerMillionUsd).toBe(10);
    expect(reg.priceAt('gpt-5.6-terra').outputPerMillionUsd).toBe(12);
    expect(reg.priceAt('google-document-ai-enterprise-ocr').freeUnits).toBe(1000);
  });

  it('every entry has an effective date and a source (external config, not constants)', () => {
    for (const e of DEFAULT_PRICE_TABLE) {
      expect(e.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.source).toContain('Pricing_AI_Cost_Guardrails');
    }
  });

  it('priceAt resolves the entry effective on a given date, not a future one', () => {
    const reg2 = new PricingRegistry([
      { model: 'm', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 1, outputPerMillionUsd: 1, effectiveDate: '2026-01-01', source: 's' },
      { model: 'm', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 2, outputPerMillionUsd: 2, effectiveDate: '2026-06-01', source: 's' },
    ]);
    expect(reg2.priceAt('m', new Date('2026-03-01')).inputPerMillionUsd).toBe(1);
    expect(reg2.priceAt('m', new Date('2026-09-01')).inputPerMillionUsd).toBe(2);
    expect(() => reg2.priceAt('m', new Date('2025-12-31'))).toThrow();
  });

  it('token cost: Luna is ~an order of magnitude below the advanced candidates', () => {
    const usage = { inputTokens: 2_000, outputTokens: 800 };
    const luna = tokenCostUsd(reg.priceAt('gpt-5.6-luna'), usage);
    const sonnet = tokenCostUsd(reg.priceAt('claude-sonnet-5'), usage);
    const terra = tokenCostUsd(reg.priceAt('gpt-5.6-terra'), usage);
    expect(luna).toBeLessThan(sonnet / 5);
    expect(sonnet).toBeLessThan(terra); // Sonnet 5 output $10/M < Terra $12/M (§1)
  });

  it('OCR cost honours the 1,000-page free tier as a running total', () => {
    const ocr = reg.priceAt('google-document-ai-enterprise-ocr');
    expect(ocrCostUsd(ocr, 500, 0)).toBe(0); // inside free tier
    expect(ocrCostUsd(ocr, 200, 900)).toBeCloseTo((100 / 1000) * 1.5, 6); // 100 of 200 pages billable
    expect(ocrCostUsd(ocr, 1000, 2000)).toBeCloseTo(1.5, 6); // fully past the free tier
  });

  it('VND conversion uses the configurable planning FX, not a hard-coded rate', () => {
    expect(usdToVnd(1)).toBe(PLANNING_FX_VND_PER_USD);
    expect(usdToVnd(1, 25_000)).toBe(25_000);
  });
});
