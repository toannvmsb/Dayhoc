import { validate, type ValidationResult } from '@copilot/schemas';
import type { AiCallMetrics, AiCostSink } from '@copilot/observability';
import type { z } from 'zod';
import {
  estimateCostUsd,
  type LlmProvider,
  type LlmRequest,
  type ProviderPricing,
} from './provider.js';

export interface AiInferenceRecord {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly operation: AiCallMetrics['operation'];
  readonly schemaVersion: string;
  readonly schemaValid: boolean;
  readonly confidence?: number;
  readonly rawOutput: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly createdAt: string;
}

export interface OrchestratorOptions {
  readonly provider: LlmProvider;
  readonly pricing: ProviderPricing;
  readonly costSink: AiCostSink;
  readonly recordSink: (record: AiInferenceRecord) => void;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T; readonly inferenceId: string }
  | { readonly ok: false; readonly issues: readonly string[]; readonly inferenceId: string };

/**
 * Run one AI operation: call the provider, time it, parse the JSON, validate it
 * against a schema, and record provenance + cost/latency. The engine only ever
 * sees the validated `value` — never raw model text (Engineering rule: no LLM
 * output trusted without validation).
 */
export class AiOrchestrator {
  readonly #o: OrchestratorOptions;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: OrchestratorOptions) {
    this.#o = options;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => Math.random().toString(36).slice(2));
  }

  async runStructured<T>(params: {
    operation: AiCallMetrics['operation'];
    request: LlmRequest;
    schema: z.ZodType<T>;
    schemaVersion: string;
  }): Promise<StructuredResult<T>> {
    const start = Date.now();
    const response = await this.#o.provider.complete(params.request);
    const latencyMs = Date.now() - start;
    const costUsd = estimateCostUsd(response.usage, this.#o.pricing);
    const inferenceId = `ai_${this.#newId()}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      parsed = { _unparseable: response.text.slice(0, 500) };
    }

    const result: ValidationResult<T> = validate(params.schema, parsed);
    const schemaValid = result.ok;
    const confidence =
      parsed && typeof parsed === 'object' && 'confidence' in parsed
        ? Number((parsed as Record<string, unknown>).confidence)
        : undefined;

    this.#o.costSink({
      provider: this.#o.provider.name,
      model: this.#o.provider.model,
      operation: params.operation,
      tokenIn: response.usage.inputTokens,
      tokenOut: response.usage.outputTokens,
      latencyMs,
      costUsd,
      ...(confidence !== undefined && !Number.isNaN(confidence) ? { confidence } : {}),
      schemaValid,
    });

    this.#o.recordSink({
      id: inferenceId,
      provider: this.#o.provider.name,
      model: this.#o.provider.model,
      operation: params.operation,
      schemaVersion: params.schemaVersion,
      schemaValid,
      ...(confidence !== undefined && !Number.isNaN(confidence) ? { confidence } : {}),
      rawOutput: parsed,
      usage: response.usage,
      latencyMs,
      costUsd,
      createdAt: this.#now().toISOString(),
    });

    return result.ok
      ? { ok: true, value: result.value, inferenceId }
      : { ok: false, issues: result.issues, inferenceId };
  }
}
