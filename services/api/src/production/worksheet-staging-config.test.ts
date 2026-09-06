import { describe, expect, it } from 'vitest';
import { validateWorksheetStagingConfig } from './worksheet-staging-config.js';

/** doc 66 §2 — staging config validation. */

describe('validateWorksheetStagingConfig', () => {
  it('OFF by default', () => {
    const r = validateWorksheetStagingConfig({});
    expect(r.mode).toBe('OFF');
    expect(r.willRun).toBe(false);
    expect(r.blocking).toHaveLength(0);
  });

  it('SHADOW without a key is blocking', () => {
    const r = validateWorksheetStagingConfig({ AI_GENERATION_MODE: 'SHADOW' });
    expect(r.mode).toBe('SHADOW');
    expect(r.willRun).toBe(false);
    expect(r.blocking.join(' ')).toMatch(/OPENAI_API_KEY/);
  });

  it('SHADOW + key → willRun, locked models', () => {
    const r = validateWorksheetStagingConfig({ AI_GENERATION_MODE: 'SHADOW', OPENAI_API_KEY: 'k' });
    expect(r.willRun).toBe(true);
    expect(r.defaultModel).toBe('gpt-4.1-mini');
    expect(r.highComplexityModel).toBe('gpt-5-mini');
    expect(r.blocking).toHaveLength(0);
  });

  it('LIVE is blocking', () => {
    const r = validateWorksheetStagingConfig({ AI_GENERATION_MODE: 'LIVE', OPENAI_API_KEY: 'k' });
    expect(r.blocking.join(' ')).toMatch(/LIVE/);
    expect(r.willRun).toBe(false);
  });

  it('a forbidden model is blocking', () => {
    const r = validateWorksheetStagingConfig({
      AI_GENERATION_MODE: 'SHADOW', OPENAI_API_KEY: 'k', WORKSHEET_DEFAULT_MODEL: 'gpt-4o-mini',
    });
    expect(r.blocking.join(' ')).toMatch(/gpt-4o/);
  });

  it('honours cost-cap env overrides', () => {
    const r = validateWorksheetStagingConfig({
      AI_GENERATION_MODE: 'SHADOW', OPENAI_API_KEY: 'k',
      WORKSHEET_PER_WORKSHEET_CAP_USD: '0.03', WORKSHEET_DAILY_CAP_USD: '1.5',
    });
    expect(r.costCaps).toEqual({ perWorksheetUsd: 0.03, perDayUsd: 1.5 });
  });

  it('AI_CROSSCHECK_MODE=LIVE is a warning, not blocking', () => {
    const r = validateWorksheetStagingConfig({
      AI_GENERATION_MODE: 'SHADOW', OPENAI_API_KEY: 'k', AI_CROSSCHECK_MODE: 'LIVE',
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings.join(' ')).toMatch(/crosscheck/i);
  });
});
