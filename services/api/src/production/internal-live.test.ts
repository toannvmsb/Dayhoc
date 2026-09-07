import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  envKillSwitch,
  loadInternalLiveBudgets,
  resolveEffectiveGenerationMode,
  familyRef,
} from './internal-live.js';
import { qaRetentionDays, qaSampleRate } from './internal-live-observability.js';
import { servableItemsOf } from './internal-live-serving.js';
import type { WorksheetResult } from '@copilot/exercise-gen';

/** doc 69 — Controlled Internal LIVE control-plane unit tests (no DB). */

const fakePool = (over: {
  runtime?: { kill_switch: boolean; kill_reason?: string | null };
  cohort?: string[]; // family_refs in the cohort
} = {}): Pool => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (sql: string, params?: any[]) => {
      if (sql.includes('ai_generation_runtime')) {
        return { rows: over.runtime ? [{ kill_switch: over.runtime.kill_switch, kill_reason: over.runtime.kill_reason ?? null, killed_at: null }] : [{ kill_switch: false, kill_reason: null, killed_at: null }] };
      }
      if (sql.includes('internal_live_cohort')) {
        const ref = params?.[0];
        return { rows: (over.cohort ?? []).includes(ref) ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
};

describe('kill switch', () => {
  it('env AI_GENERATION_KILL_SWITCH=true is honoured', () => {
    expect(envKillSwitch({ AI_GENERATION_KILL_SWITCH: 'true' })).toBe(true);
    expect(envKillSwitch({ AI_GENERATION_KILL_SWITCH: 'TRUE' })).toBe(true);
    expect(envKillSwitch({ AI_GENERATION_KILL_SWITCH: 'false' })).toBe(false);
    expect(envKillSwitch({})).toBe(false);
  });
});

describe('INTERNAL LIVE budgets', () => {
  it('defaults are $2.00 gen / $0.50 xcheck', () => {
    expect(loadInternalLiveBudgets({})).toEqual({ genDailyCapUsd: 2.0, xcheckDailyCapUsd: 0.5 });
  });
  it('env overrides', () => {
    expect(loadInternalLiveBudgets({ INTERNAL_LIVE_GEN_DAILY_CAP_USD: '3.5', INTERNAL_LIVE_XCHECK_DAILY_CAP_USD: '0.9' })).toEqual({
      genDailyCapUsd: 3.5,
      xcheckDailyCapUsd: 0.9,
    });
  });
  it('a bad value falls back to the default', () => {
    expect(loadInternalLiveBudgets({ INTERNAL_LIVE_GEN_DAILY_CAP_USD: 'oops' }).genDailyCapUsd).toBe(2.0);
  });
});

describe('QA sampling config', () => {
  it('retention is SHORT by default (7d), capped at 30d', () => {
    expect(qaRetentionDays({})).toBe(7);
    expect(qaRetentionDays({ INTERNAL_LIVE_QA_RETENTION_DAYS: '3' })).toBe(3);
    expect(qaRetentionDays({ INTERNAL_LIVE_QA_RETENTION_DAYS: '999' })).toBe(30);
  });
  it('sample rate default 1-in-5, 0 = disabled', () => {
    expect(qaSampleRate({})).toBe(5);
    expect(qaSampleRate({ INTERNAL_LIVE_QA_SAMPLE_ONE_IN: '10' })).toBe(10);
  });
});

describe('resolveEffectiveGenerationMode', () => {
  const CFG_LIVE = { AI_GENERATION_MODE: 'LIVE' };
  const ref = familyRef('fam-1');

  it('OFF stays OFF regardless of cohort', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool({ cohort: [ref] }), { AI_GENERATION_MODE: 'OFF' }, ref);
    expect(r.mode).toBe('OFF');
  });

  it('SHADOW stays SHADOW', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool(), { AI_GENERATION_MODE: 'SHADOW' }, ref);
    expect(r.mode).toBe('SHADOW');
  });

  it('LIVE + family in cohort + no kill switch → LIVE', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool({ cohort: [ref] }), CFG_LIVE, ref);
    expect(r.mode).toBe('LIVE');
  });

  it('LIVE configured but family NOT in cohort → SHADOW', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool({ cohort: [] }), CFG_LIVE, ref);
    expect(r.mode).toBe('SHADOW');
    expect(r.reason).toMatch(/not in INTERNAL_LIVE cohort/);
  });

  it('LIVE + cohort but env kill switch active → SHADOW', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool({ cohort: [ref] }), { ...CFG_LIVE, AI_GENERATION_KILL_SWITCH: 'true' }, ref);
    expect(r.mode).toBe('SHADOW');
    expect(r.killSwitch.active).toBe(true);
    expect(r.killSwitch.source).toBe('env');
  });

  it('LIVE + cohort but DB kill switch active → SHADOW', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool({ cohort: [ref], runtime: { kill_switch: true, kill_reason: 'AUTO-STOP: x' } }), CFG_LIVE, ref);
    expect(r.mode).toBe('SHADOW');
    expect(r.killSwitch.source).toBe('db');
  });

  it('LIVE configured but no owning family → SHADOW (never LIVE without a family)', async () => {
    const r = await resolveEffectiveGenerationMode(fakePool(), CFG_LIVE, null);
    expect(r.mode).toBe('SHADOW');
  });
});

describe('servableItemsOf — only verified READY items reach the child', () => {
  const mkResult = (): WorksheetResult => {
    const perSlot = [
      { itemId: 's::item-01', index: 0, finalState: 'READY', answerStatus: 'DETERMINISTIC_CORRECT', crosscheckVerdict: null, criticality: 'REQUIRED_CORE' },
      { itemId: 's::item-02', index: 1, finalState: 'READY', answerStatus: 'CROSSCHECK_REQUIRED', crosscheckVerdict: 'PASS', criticality: 'REQUIRED_CORE' },
      { itemId: 's::item-03', index: 2, finalState: 'READY', answerStatus: 'CROSSCHECK_REQUIRED', crosscheckVerdict: 'UNCERTAIN', criticality: 'OPTIONAL_REASONING' }, // NOT verified
      { itemId: 's::item-04', index: 3, finalState: 'OMITTED', answerStatus: null, crosscheckVerdict: null, criticality: 'OPTIONAL_STRETCH' },
    ];
    const items = [
      { id: 'ulid-1', skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 'K2', thinkingLevel: 'T2', prompt: 'p1', answerSpec: { kind: 'numeric', value: 6 }, hints: ['a', 'b', 'c', 'd', 'e', 'f'], workedSolution: 'ws1' },
      { id: 'ulid-2', skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 'K2', thinkingLevel: 'T2', prompt: 'p2', answerSpec: { kind: 'numeric', value: 8 }, hints: ['a', 'b', 'c', 'd', 'e', 'f'], workedSolution: 'ws2' },
      { id: 'ulid-3', skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 'K2', thinkingLevel: 'T3', prompt: 'p3', answerSpec: { kind: 'reasoning' }, hints: ['a', 'b', 'c', 'd', 'e', 'f'], workedSolution: 'ws3' },
    ];
    return { items, trace: { perSlot } } as unknown as WorksheetResult;
  };

  it('drops UNCERTAIN-crosscheck and omitted items — keeps deterministic + crosscheck-PASS', () => {
    const out = servableItemsOf(mkResult());
    expect(out.map((i) => i.questionRef)).toEqual(['ulid-1', 'ulid-2']);
    expect(out[0]!.knowledgeLevel).toBe(2);
    expect(out[0]!.prompt).toEqual({ text: 'p1' });
  });
});
