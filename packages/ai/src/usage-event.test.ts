import { describe, expect, it } from 'vitest';
import {
  buildUsageEvent,
  cogsPerUser,
  forecastByOperation,
  measuredUnitCosts,
  rollup,
  type AiUsageEvent,
} from './usage-event.js';

const at = () => new Date('2026-09-01T10:00:00Z');

describe('AI cost telemetry — AICostLedger (Pricing v1.1 §10)', () => {
  it('builds an event with every required v1.1 field', () => {
    const e = buildUsageEvent({
      userRef: 'u_ab12',
      childRef: 'c_cd34',
      plan: 'plus',
      operationType: 'worksheet_batch_generation',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      modelVersion: '2026-08-01',
      priceConfigEffectiveDate: '2026-08-31',
      inputTokens: 1_200,
      outputTokens: 3_000,
      estimatedCostUsd: 0.004,
      latencyMs: 2_100,
      confidence: 0.82,
      retryCount: 0,
      generationSpecId: 'egs_01H',
      learningContextSource: 'CURRICULUM_TIMELINE',
      kTarget: 'K4',
      tTarget: 'T5',
      schemaValid: true,
      requestId: 'req_1',
      now: at,
    });
    expect(e.estimatedCostVnd).toBe(Math.round(0.004 * 26_000));
    expect(e.modelVersion).toBe('2026-08-01');
    expect(e.priceConfigEffectiveDate).toBe('2026-08-31');
    expect(e.generationSpecId).toBe('egs_01H');
    expect(e.learningContextSource).toBe('CURRICULUM_TIMELINE');
    expect(e.kTarget).toBe('K4');
    expect(e.tTarget).toBe('T5');
    expect(e.retryCount).toBe(0);
    expect(e.createdAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('never carries a raw id — refs are caller-supplied pseudonyms; K/T optional', () => {
    const e = buildUsageEvent({
      userRef: 'u_hash',
      plan: 'free',
      operationType: 'parent_copilot',
      provider: 'mock',
      model: 'mock-1',
      estimatedCostUsd: 0,
      latencyMs: 1,
      schemaValid: true,
      requestId: 'r',
    });
    expect(e.userRef).toBe('u_hash');
    expect(e.childRef).toBeNull();
    expect(e.kTarget).toBeNull();
    expect(e.generationSpecId).toBeNull();
  });

  it('rollup separates cheap vs advanced share, escalation and retry rate', () => {
    const mk = (model: string, opts: Partial<AiUsageEvent> = {}): AiUsageEvent =>
      buildUsageEvent({
        userRef: 'u',
        plan: 'plus',
        operationType: 'skill_map',
        provider: 'openai',
        model,
        estimatedCostUsd: 0.001,
        latencyMs: 100,
        schemaValid: true,
        requestId: Math.random().toString(),
        ...(opts.escalatedFrom ? { escalatedFrom: opts.escalatedFrom } : {}),
        ...(opts.retryCount ? { retryCount: opts.retryCount } : {}),
        ...(opts.ocrPages ? { ocrPages: opts.ocrPages } : {}),
      });
    const events = [
      ...Array.from({ length: 90 }, () => mk('gpt-5.6-luna')),
      ...Array.from({ length: 6 }, () => mk('gpt-5.6-luna', { escalatedFrom: 'luna', ocrPages: 2 })),
      ...Array.from({ length: 4 }, () => mk('claude-sonnet-5', { retryCount: 1 })),
    ];
    const r = rollup(events);
    expect(r.events).toBe(100);
    expect(r.cheapPathShare).toBeCloseTo(0.96, 2);
    expect(r.advancedShare).toBeCloseTo(0.04, 2);
    expect(r.escalationRate).toBeCloseTo(0.06, 2);
    expect(r.ocrFallbackRate).toBeCloseTo(0.06, 2);
    expect(r.retryRate).toBeCloseTo(0.04, 2);
  });

  it('cogsPerUser divides plan spend by active users', () => {
    const events = Array.from({ length: 10 }, () =>
      buildUsageEvent({
        userRef: 'u',
        plan: 'basic',
        operationType: 'teach_me',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        estimatedCostUsd: 0.01,
        latencyMs: 10,
        schemaValid: true,
        requestId: Math.random().toString(),
      }),
    );
    expect(cogsPerUser(events, 'basic', 5)).toBe(520); // 10 × round(0.01×26000)=260 → 2600 / 5
    expect(cogsPerUser(events, 'plus', 5)).toBe(0);
  });

  it('forecastByOperation = Σ(volume × unit cost × retry factor), NOT tokens/user (§12)', () => {
    const cogs = forecastByOperation([
      { operation: 'worksheet_batch_generation', unitCostVnd: 300, monthlyVolumePerUser: 12, retryEscalationFactor: 1.1 },
      { operation: 'next_best_question', unitCostVnd: 60, monthlyVolumePerUser: 40, retryEscalationFactor: 1.05 },
      { operation: 'vision_extraction', unitCostVnd: 200, monthlyVolumePerUser: 4, retryEscalationFactor: 1.2 },
    ]);
    // 300·12·1.1 + 60·40·1.05 + 200·4·1.2 = 3960 + 2520 + 960 = 7440
    expect(cogs).toBeCloseTo(7_440, 6);
  });

  it('measuredUnitCosts derives per-operation mean cost + retry factor from telemetry', () => {
    const base = { userRef: 'u', plan: 'plus' as const, provider: 'openai' as const, model: 'gpt-5.6-luna', latencyMs: 1, schemaValid: true };
    const events = [
      buildUsageEvent({ ...base, operationType: 'worksheet_batch_generation', estimatedCostUsd: 0.01, requestId: '1' }),
      buildUsageEvent({ ...base, operationType: 'worksheet_batch_generation', estimatedCostUsd: 0.03, requestId: '2', retryCount: 1 }),
    ];
    const m = measuredUnitCosts(events).get('worksheet_batch_generation')!;
    expect(m.unitCostVnd).toBe(Math.round(0.01 * 26_000) / 2 + Math.round(0.03 * 26_000) / 2);
    expect(m.retryEscalationFactor).toBe(1.5); // 1 of 2 retried
  });
});
