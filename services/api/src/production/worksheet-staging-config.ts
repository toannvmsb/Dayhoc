import { loadAiGenerationConfig } from '@copilot/ai';
import { DEFAULT_STAGING_COST_CAPS, type WorksheetCostCaps } from '@copilot/exercise-gen';

/**
 * Staging config validation for the worksheet SHADOW path (doc 66 §2).
 * Deterministic — no side effects, no network. Call it at boot and log the
 * result; a `blocking` issue means the SHADOW path will silently stay OFF.
 */

export interface WorksheetStagingConfigResult {
  readonly mode: 'OFF' | 'SHADOW' | 'LIVE';
  readonly willRun: boolean; // SHADOW + key present
  readonly defaultModel: string;
  readonly highComplexityModel: string;
  readonly crosscheckMode: string;
  readonly costCaps: WorksheetCostCaps;
  readonly blocking: readonly string[];
  readonly warnings: readonly string[];
}

const LOCKED_DEFAULT = 'gpt-4.1-mini';
const LOCKED_HIGH = 'gpt-5-mini';
const FORBIDDEN = ['gpt-4o-mini', 'gpt-4o'];

export function validateWorksheetStagingConfig(
  env: Record<string, string | undefined> = process.env,
): WorksheetStagingConfigResult {
  const cfg = loadAiGenerationConfig(env);
  const blocking: string[] = [];
  const warnings: string[] = [];

  const defaultModel = env.WORKSHEET_DEFAULT_MODEL ?? LOCKED_DEFAULT;
  const highModel = env.WORKSHEET_HIGH_COMPLEXITY_MODEL ?? LOCKED_HIGH;
  const crosscheckMode = env.AI_CROSSCHECK_MODE ?? 'OFF';

  if (cfg.mode === 'LIVE') {
    blocking.push('AI_GENERATION_MODE=LIVE — LIVE worksheet delivery is not approved; set SHADOW');
  }
  if (cfg.mode === 'SHADOW' && !env.OPENAI_API_KEY) {
    blocking.push('AI_GENERATION_MODE=SHADOW but OPENAI_API_KEY is missing — the path will stay OFF');
  }
  if (FORBIDDEN.includes(defaultModel) || FORBIDDEN.includes(highModel)) {
    blocking.push(`forbidden model in routing (${defaultModel} / ${highModel}) — gpt-4o(-mini) is not in production`);
  }
  if (defaultModel !== LOCKED_DEFAULT) warnings.push(`WORKSHEET_DEFAULT_MODEL overridden to ${defaultModel} (locked = ${LOCKED_DEFAULT})`);
  if (highModel !== LOCKED_HIGH) warnings.push(`WORKSHEET_HIGH_COMPLEXITY_MODEL overridden to ${highModel} (locked = ${LOCKED_HIGH})`);
  if (crosscheckMode === 'LIVE') warnings.push('AI_CROSSCHECK_MODE=LIVE — paid crosscheck will run (must be separately approved)');

  const perWs = Number(env.WORKSHEET_PER_WORKSHEET_CAP_USD ?? DEFAULT_STAGING_COST_CAPS.perWorksheetUsd);
  const perDay = Number(env.WORKSHEET_DAILY_CAP_USD ?? DEFAULT_STAGING_COST_CAPS.perDayUsd);
  if (!(perWs > 0)) blocking.push('WORKSHEET_PER_WORKSHEET_CAP_USD must be > 0');
  if (!(perDay > 0)) blocking.push('WORKSHEET_DAILY_CAP_USD must be > 0');
  if (perDay > 10) warnings.push(`WORKSHEET_DAILY_CAP_USD=${perDay} is unusually high for staging`);

  return {
    mode: cfg.mode,
    willRun: cfg.mode === 'SHADOW' && !!env.OPENAI_API_KEY && blocking.length === 0,
    defaultModel,
    highComplexityModel: highModel,
    crosscheckMode,
    costCaps: { perWorksheetUsd: perWs, perDayUsd: perDay },
    blocking,
    warnings,
  };
}
