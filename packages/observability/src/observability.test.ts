import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';
import { createAiCostTracker } from './ai-cost.js';

describe('structured logger', () => {
  it('emits JSON lines and respects level threshold', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => lines.push(l) });
    log.debug('hidden');
    log.info('visible', { skillId: 'M4.FRAC.EQUIVALENT' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.msg).toBe('visible');
    expect(parsed.skillId).toBe('M4.FRAC.EQUIVALENT');
    expect(parsed.level).toBe('info');
  });

  it('child loggers inherit bindings', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) }).child({ childId: 'c1' });
    log.info('x');
    expect(JSON.parse(lines[0]!).childId).toBe('c1');
  });
});

describe('AI cost tracker', () => {
  it('records latency + token metrics around a tracked call', async () => {
    const sink = vi.fn();
    const tracker = createAiCostTracker(sink);
    const value = await tracker.track(
      { provider: 'anthropic', model: 'claude-sonnet-5', operation: 'classify' },
      async () => ({ value: 'ok', tokenIn: 100, tokenOut: 20, schemaValid: true }),
    );
    expect(value).toBe('ok');
    expect(sink).toHaveBeenCalledOnce();
    const metrics = sink.mock.calls[0]![0];
    expect(metrics.tokenIn).toBe(100);
    expect(metrics.schemaValid).toBe(true);
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
