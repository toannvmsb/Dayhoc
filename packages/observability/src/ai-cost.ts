/**
 * AI cost/latency tracking hook (Engineering rule: track AI token/cost/latency).
 * Every AI inference must record provenance metrics; sinks are pluggable
 * (log, metrics, DB `ai_inferences`). This is the in-process capture point.
 */

export interface AiCallMetrics {
  readonly provider: string;
  readonly model: string;
  readonly operation: 'classify' | 'generate' | 'hint' | 'explain' | 'vision';
  readonly tokenIn: number;
  readonly tokenOut: number;
  readonly latencyMs: number;
  readonly costUsd?: number;
  readonly confidence?: number;
  readonly schemaValid: boolean;
}

export type AiCostSink = (metrics: AiCallMetrics) => void;

export interface AiCostTracker {
  readonly record: (metrics: AiCallMetrics) => void;
  /** Wrap an async AI call, timing it and recording metrics from its result. */
  readonly track: <T>(
    meta: Omit<AiCallMetrics, 'latencyMs' | 'tokenIn' | 'tokenOut' | 'schemaValid'>,
    fn: () => Promise<{ value: T; tokenIn: number; tokenOut: number; schemaValid: boolean }>,
  ) => Promise<T>;
}

export function createAiCostTracker(sink: AiCostSink): AiCostTracker {
  const record = (metrics: AiCallMetrics): void => sink(metrics);
  return {
    record,
    track: async (meta, fn) => {
      const start = Date.now();
      const { value, tokenIn, tokenOut, schemaValid } = await fn();
      record({ ...meta, latencyMs: Date.now() - start, tokenIn, tokenOut, schemaValid });
      return value;
    },
  };
}
