import type { LlmProvider, LlmRequest, LlmResponse, VisionProvider, VisionRequest } from '../provider.js';

/**
 * Deterministic mock provider for tests + local dev + CI (golden tests keep AI
 * decoupled). Returns canned JSON keyed by `responseSchemaName`, or a fixed
 * response supplied at construction.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';
  #responses: Map<string, string>;
  #default: string;

  constructor(opts?: { responses?: Record<string, string>; fallback?: string }) {
    this.#responses = new Map(Object.entries(opts?.responses ?? {}));
    this.#default = opts?.fallback ?? '{}';
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    const text = request.responseSchemaName
      ? (this.#responses.get(request.responseSchemaName) ?? this.#default)
      : this.#default;
    return Promise.resolve({
      text,
      usage: {
        inputTokens: estimateTokens(request.system ?? '') + estimateTokens(request.prompt),
        outputTokens: estimateTokens(text),
      },
    });
  }
}

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock-vision';
  #response: string;
  constructor(response = '{}') {
    this.#response = response;
  }
  recognize(request: VisionRequest): Promise<LlmResponse> {
    return Promise.resolve({
      text: this.#response,
      usage: { inputTokens: 900 * request.imageRefs.length, outputTokens: estimateTokens(this.#response) },
    });
  }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4);
