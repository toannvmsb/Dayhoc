import { describe, expect, it } from 'vitest';
import { buildUsageEvent, cogsPerUser, rollup, type AiUsageEvent } from './usage-event.js';

const at = () => new Date('2026-09-01T10:00:00Z');

describe('AI usage telemetry (§7)', () => {
  it('builds an event with every required field and a VND estimate', () => {
    const e = buildUsageEvent({
      userRef: 'u_ab12',
      childRef: 'c_cd34',
      plan: 'plus',
      operationType: 'vision_extract',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      inputTokens: 1_200,
      outputTokens: 300,
      imageCount: 1,
      estimatedCostUsd: 0.0006,
      latencyMs: 820,
      confidence: 0.74,
      schemaValid: true,
      requestId: 'req_1',
      now: at,
    });
    expect(e.estimatedCostVnd).toBe(Math.round(0.0006 * 26_000));
    expect(e.childRef).toBe('c_cd34');
    expect(e.ocrPages).toBeNull();
    expect(e.escalationReason).toBeNull();
    expect(e.createdAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('never carries a raw id — refs are caller-supplied pseudonyms', () => {
    const e = buildUsageEvent({
      userRef: 'u_hash',
      plan: 'free',
      operationType: 'parent_summary',
      provider: 'mock',
      model: 'mock-1',
      estimatedCostUsd: 0,
      latencyMs: 1,
      schemaValid: true,
      requestId: 'r',
    });
    expect(e.userRef).toBe('u_hash');
    expect(e.childRef).toBeNull();
  });

  it('rollup separates cheap-path vs advanced-model share and escalation rate', () => {
    const mk = (model: string, escalated: boolean, ocrPages = 0): AiUsageEvent =>
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
        ...(escalated ? { escalationReason: 'ambiguous_candidates' } : {}),
        ...(ocrPages ? { ocrPages } : {}),
      });
    const events = [
      ...Array.from({ length: 90 }, () => mk('gpt-5.6-luna', false)),
      ...Array.from({ length: 6 }, () => mk('gpt-5.6-luna', true, 2)),
      ...Array.from({ length: 4 }, () => mk('claude-sonnet-5', true)),
    ];
    const r = rollup(events);
    expect(r.events).toBe(100);
    expect(r.cheapPathShare).toBeCloseTo(0.96, 2);
    expect(r.advancedShare).toBeCloseTo(0.04, 2);
    expect(r.escalationRate).toBeCloseTo(0.1, 2);
    expect(r.ocrFallbackRate).toBeCloseTo(0.06, 2);
    expect(r.schemaValidRate).toBe(1);
  });

  it('cogsPerUser divides plan spend by active users', () => {
    const events = Array.from({ length: 10 }, () =>
      buildUsageEvent({
        userRef: 'u',
        plan: 'basic',
        operationType: 'explain',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        estimatedCostUsd: 0.01,
        latencyMs: 10,
        schemaValid: true,
        requestId: Math.random().toString(),
      }),
    );
    // 10 events × round(0.01 × 26000)=260 VND = 2600, over 5 users = 520
    expect(cogsPerUser(events, 'basic', 5)).toBe(520);
    expect(cogsPerUser(events, 'plus', 5)).toBe(0);
  });
});
