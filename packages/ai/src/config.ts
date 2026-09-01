/**
 * Live-generation runtime configuration (doc 14 C5 §3) — env/config-driven so no
 * literal provider or model name is scattered across source. NEVER put an API
 * key here: `resolveLunaCredentials()` reads it straight from `process.env` at
 * call time and nothing else touches or logs it.
 */
import { AI_GENERATION_MODES, type AiGenerationMode } from '@copilot/domain';

/**
 * How the provider is asked to return structured output (doc 14 C5.1 §3).
 *   STRICT_JSON_SCHEMA   — provider-native strict JSON-Schema structured output.
 *   JSON_OBJECT_FALLBACK — broad JSON-mode; the Zod parse is the real contract.
 * We NEVER fake strict support — if the configured model can't do it, the
 * adapter downgrades and the benchmark records `JSON_OBJECT_FALLBACK`.
 */
export const STRUCTURED_OUTPUT_MODES = ['STRICT_JSON_SCHEMA', 'JSON_OBJECT_FALLBACK'] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];

export interface AiGenerationConfig {
  /** e.g. 'openai' — which adapter family `LunaExerciseGenerator` binds to. */
  readonly defaultProvider: string;
  /** e.g. 'gpt-5.6-luna' — the pricing-registry model key too. */
  readonly defaultModel: string;
  /** Which price-config bundle is in effect (informational; the registry does the real lookup). */
  readonly pricingConfigVersion: string;
  readonly mode: AiGenerationMode;
  /** Requested structured-output mode; the adapter may downgrade and report the real one. */
  readonly structuredOutputMode: StructuredOutputMode;
  /** Paid-benchmark spend guardrails (doc 14 C5.1 §8). */
  readonly liveBenchmarkMaxBatches: number;
  readonly liveBenchmarkMaxCostUsd: number;
}

function readMode(raw: string | undefined): AiGenerationMode {
  const v = (raw ?? 'OFF').toUpperCase();
  return (AI_GENERATION_MODES as readonly string[]).includes(v) ? (v as AiGenerationMode) : 'OFF';
}

/**
 * Reads `AI_GENERATION_DEFAULT_PROVIDER` / `AI_GENERATION_DEFAULT_MODEL` /
 * `AI_PRICING_CONFIG_VERSION` / `AI_GENERATION_MODE` from `env` (defaults to
 * `process.env`). Defaults match the documented price table (doc 15 §2) so a
 * deployment with no env set still resolves to something valid — it just stays
 * `OFF` until `AI_GENERATION_MODE` is explicitly set.
 */
export function loadAiGenerationConfig(env: Record<string, string | undefined> = process.env): AiGenerationConfig {
  const som = (env.AI_GENERATION_STRUCTURED_OUTPUT_MODE ?? '').toUpperCase();
  return {
    defaultProvider: env.AI_GENERATION_DEFAULT_PROVIDER ?? 'openai',
    defaultModel: env.AI_GENERATION_DEFAULT_MODEL ?? 'gpt-5.6-luna',
    pricingConfigVersion: env.AI_PRICING_CONFIG_VERSION ?? 'ai-pricing-registry.v1',
    mode: readMode(env.AI_GENERATION_MODE),
    structuredOutputMode: (STRUCTURED_OUTPUT_MODES as readonly string[]).includes(som)
      ? (som as StructuredOutputMode)
      : 'JSON_OBJECT_FALLBACK',
    liveBenchmarkMaxBatches: intOr(env.LIVE_BENCHMARK_MAX_BATCHES, 20),
    liveBenchmarkMaxCostUsd: floatOr(env.LIVE_BENCHMARK_MAX_COST_USD, 5),
  };
}

function intOr(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function floatOr(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The API key, read fresh from `env` and never stored on any object this
 * module returns. Absent in dev/CI by design — callers must check for `null`
 * and refuse to construct a live adapter rather than falling back silently.
 */
export function resolveLunaApiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.OPENAI_API_KEY ?? null;
}

/** Explicit opt-in gate for tests that would spend real API budget (doc 14 C5 §24). */
export function liveBenchmarkEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RUN_LIVE_AI_BENCHMARK === '1';
}
