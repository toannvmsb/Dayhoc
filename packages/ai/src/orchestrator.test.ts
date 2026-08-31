import { describe, expect, it, vi } from 'vitest';
import { classificationSchemaV1 } from '@copilot/schemas';
import { AiOrchestrator } from './orchestrator.js';
import { MockLlmProvider } from './providers/mock.js';

const pricing = { inputPerMillion: 3, outputPerMillion: 15 };

describe('AiOrchestrator', () => {
  it('validates provider output against a schema and records cost + provenance', async () => {
    const valid = JSON.stringify({
      schema_version: 'classify.v1',
      candidate_skill_ids: ['M4.FRAC.COMMON_DENOM'],
      knowledge_level: 'K2',
      thinking_level: 'T2',
      confidence: 0.71,
      explanation: 'ok',
    });
    const costSink = vi.fn();
    const recordSink = vi.fn();
    const orch = new AiOrchestrator({
      provider: new MockLlmProvider({ responses: { 'classify.v1': valid } }),
      pricing,
      costSink,
      recordSink,
      newId: () => 'abc',
    });

    const result = await orch.runStructured({
      operation: 'classify',
      request: { prompt: 'classify this', responseSchemaName: 'classify.v1' },
      schema: classificationSchemaV1,
      schemaVersion: 'classify.v1',
    });

    expect(result.ok).toBe(true);
    expect(costSink).toHaveBeenCalledOnce();
    const metrics = costSink.mock.calls[0]![0];
    expect(metrics.schemaValid).toBe(true);
    expect(metrics.costUsd).toBeGreaterThan(0);
    expect(metrics.confidence).toBe(0.71);
    expect(recordSink.mock.calls[0]![0].id).toBe('ai_abc');
  });

  it('never surfaces invalid model output as a value — returns issues instead', async () => {
    const costSink = vi.fn();
    const orch = new AiOrchestrator({
      provider: new MockLlmProvider({ fallback: '{"garbage": true}' }),
      pricing,
      costSink,
      recordSink: vi.fn(),
    });
    const result = await orch.runStructured({
      operation: 'classify',
      request: { prompt: 'x' },
      schema: classificationSchemaV1,
      schemaVersion: 'classify.v1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(costSink.mock.calls[0]![0].schemaValid).toBe(false); // still tracked
  });

  it('handles unparseable text without throwing', async () => {
    const orch = new AiOrchestrator({
      provider: new MockLlmProvider({ fallback: 'not json at all' }),
      pricing,
      costSink: vi.fn(),
      recordSink: vi.fn(),
    });
    const result = await orch.runStructured({
      operation: 'generate',
      request: { prompt: 'x' },
      schema: classificationSchemaV1,
      schemaVersion: 'classify.v1',
    });
    expect(result.ok).toBe(false);
  });
});
