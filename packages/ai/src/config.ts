/**
 * Live-generation runtime configuration (doc 14 C5 §3) — env/config-driven so no
 * literal provider or model name is scattered across source. NEVER put an API
 * key here: `resolveLunaCredentials()` reads it straight from `process.env` at
 * call time and nothing else touches or logs it.
 */
import { AI_GENERATION_MODES, type AiGenerationMode } from '@copilot/domain';

export interface AiGenerationConfig {
  /** e.g. 'openai' — which adapter family `LunaExerciseGenerator` binds to. */
  readonly defaultProvider: string;
  /** e.g. 'gpt-5.6-luna' — the pricing-registry model key too. */
  readonly defaultModel: string;
  /** Which price-config bundle is in effect (informational; the registry does the real lookup). */
  readonly pricingConfigVersion: string;
  readonly mode: AiGenerationMode;
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
  return {
    defaultProvider: env.AI_GENERATION_DEFAULT_PROVIDER ?? 'openai',
    defaultModel: env.AI_GENERATION_DEFAULT_MODEL ?? 'gpt-5.6-luna',
    pricingConfigVersion: env.AI_PRICING_CONFIG_VERSION ?? 'ai-pricing-registry.v1',
    mode: readMode(env.AI_GENERATION_MODE),
  };
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
