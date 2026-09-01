import { describe, expect, it } from 'vitest';
import { liveBenchmarkEnabled, loadAiGenerationConfig, resolveLunaApiKey, type AIProviderAdapter } from '@copilot/ai';
import { createMockExerciseGenerator } from '@copilot/exercise-gen';
import { buildGenerationGrounding } from '@copilot/exercise-gen';
import { KB } from '../harness.js';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  buildBenchmarkSpecs,
  evaluateGates,
  formatBenchmarkReport,
  runLunaBenchmark,
} from './luna-generation-benchmark.js';

const lib = loadReferenceLibrary();

/** A fake adapter that returns whatever the deterministic mock would produce for the spec. */
function mockBackedAdapter(): AIProviderAdapter {
  return {
    provider: 'openai',
    capability: 'generate_problem',
    model: 'gpt-5.6-luna',
    processingRegion: 't',
    crossBorder: false,
    dataCategoriesAllowed: [],
    providerRetention: 'none',
    trainingAllowed: false,
    dpaStatus: 'not_applicable',
    async call(input) {
      const grounding = input.payload as ReturnType<typeof buildGenerationGrounding>;
      // reconstruct a spec-shaped stub is hard here; instead the mock generator is
      // driven directly off the grounding the Luna generator forwards.
      const gen = createMockExerciseGenerator();
      const r = await gen.generate({ grounding });
      const text = r.ok ? JSON.stringify(r.batch) : '{"broken":true}';
      return { text, usage: { inputTokens: 1500, outputTokens: 1100 } };
    },
  };
}

describe('C5 §19/§25 — Luna generation benchmark harness (no network)', () => {
  it('builds benchmark specs from SYNTHETIC profiles only — no real child PII', () => {
    const cases = buildBenchmarkSpecs(KB, 12);
    expect(cases.length).toBeGreaterThanOrEqual(8);
    for (const c of cases) {
      // golden profile children are synthetic ids, never a real name / email
      expect(c.spec.childId).toMatch(/^(child_|c_|lt-|LT-|tp_)/i);
      expect(JSON.stringify(c.spec)).not.toMatch(/@[\w.]+\.\w{2,}/); // no email anywhere
    }
  });

  it('runs the full harness against a deterministic adapter and aggregates metrics', async () => {
    const cases = buildBenchmarkSpecs(KB, 6);
    const result = await runLunaBenchmark({ adapter: mockBackedAdapter(), specs: cases, referenceLibrary: lib });
    expect(result.cases).toBe(6);
    expect(result.records).toHaveLength(6);
    // deterministic mock content should be clean on the structural gates
    const gates = Object.fromEntries(evaluateGates(result.metrics).map((g) => [g.name, g.pass]));
    expect(gates.noInventedSkillIdRate).toBe(true);
    expect(gates.skillAdherenceRate).toBe(true);
    expect(typeof formatBenchmarkReport(result)).toBe('string');
  });

  it('never runs a live call unless RUN_LIVE_AI_BENCHMARK=1', () => {
    expect(liveBenchmarkEnabled({})).toBe(false);
    expect(liveBenchmarkEnabled({ RUN_LIVE_AI_BENCHMARK: '1' })).toBe(true);
  });
});

describe.skipIf(!liveBenchmarkEnabled())('C5 — LIVE Luna benchmark (paid)', () => {
  it('runs the small benchmark and prints the report', async () => {
    const { createOpenAiProviderAdapter } = await import('@copilot/ai');
    const apiKey = resolveLunaApiKey();
    if (!apiKey) return;
    const cfg = loadAiGenerationConfig();
    const adapter = createOpenAiProviderAdapter({
      apiKey,
      model: cfg.defaultModel,
      capability: 'generate_problem',
      compliance: { processingRegion: 'us', crossBorder: true, dataCategoriesAllowed: [], providerRetention: '30d', trainingAllowed: false, dpaStatus: 'pending' },
    });
    const cases = buildBenchmarkSpecs(KB, 12);
    const result = await runLunaBenchmark({ adapter, specs: cases, referenceLibrary: lib });
    process.stdout.write(`\n${formatBenchmarkReport(result)}\n`);
    expect(result.cases).toBe(cases.length);
  }, 300_000);
});
