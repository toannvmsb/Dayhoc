import { describe, expect, it } from 'vitest';
import { liveBenchmarkEnabled, loadAiGenerationConfig, resolveLunaApiKey, type AIProviderAdapter } from '@copilot/ai';
import { createMockExerciseGenerator, buildGenerationGrounding } from '@copilot/exercise-gen';
import { KB } from '../harness.js';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildBenchmarkManifest, manifestCoverage } from './luna-benchmark-manifest.js';
import { runLunaBenchmark, formatBenchmarkReport } from './luna-generation-benchmark.js';

const lib = loadReferenceLibrary();

/** Fake adapter: returns whatever the deterministic mock would produce for the grounding it is sent. */
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
      const r = await createMockExerciseGenerator().generate({ grounding });
      const text = r.ok ? JSON.stringify(r.batch) : '{"broken":true}';
      return {
        text,
        structuredOutputMode: input.structuredOutputMode ?? 'JSON_OBJECT_FALLBACK',
        usage: { inputTokens: 1500, outputTokens: 1100 },
      };
    },
  };
}

describe('C5.1 §6-§9 / §12 — Luna benchmark manifest + harness (no network)', () => {
  it('§7/§12 — the frozen manifest is built from SYNTHETIC golden profiles only (no real PII)', () => {
    const cases = buildBenchmarkManifest(KB);
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) {
      expect(c.benchmarkCaseId).toMatch(/^BENCH-LT-G[47]-\d+$/);
      expect(c.profileId).toMatch(/^LT-G[47]-\d+$/);
      expect(JSON.stringify(c.spec)).not.toMatch(/@[\w.]+\.\w{2,}/); // no email anywhere
    }
    const cov = manifestCoverage(cases);
    expect(cov.grades).toEqual([4, 7]);
    expect(cov.withPrerequisiteRepair).toBeGreaterThan(0);
  });

  it('§6/§9 — the harness runs the production-like pipeline and emits a machine-readable report', async () => {
    const cases = buildBenchmarkManifest(KB).slice(0, 6);
    const { report } = await runLunaBenchmark({
      adapter: mockBackedAdapter(),
      cases,
      structuredOutputMode: 'JSON_OBJECT_FALLBACK',
      referenceLibrary: lib,
      maxBatches: 20,
      maxCostUsd: 5,
      pricingConfigVersion: 'ai-pricing-registry.v1',
    });
    expect(report.caseCount).toBe(6);
    expect(report.promptVersion).toBe('exercise-generator-prompt.v1');
    expect(report.outputSchemaVersion).toBe('generatedExerciseBatch.jsonschema.v1');
    expect(report.structuredOutputModeUsed).toBe('JSON_OBJECT_FALLBACK');
    // deterministic mock content is clean on the structural gates
    const gates = Object.fromEntries(report.gates.map((g) => [g.name, g.pass]));
    expect(gates.noInventedSkillIdRate).toBe(true);
    expect(gates.skillAdherenceRate).toBe(true);
    expect(gates.roleAdherenceRate).toBe(true);
    // §1: format-valid is reported separately from deterministic correctness
    expect(report.answers).toHaveProperty('formatValidRate');
    expect(report.answers).toHaveProperty('deterministicCorrectnessVerifiedRate');
    expect(typeof formatBenchmarkReport(report)).toBe('string');
  });

  it('§8 — the spend guardrail stops before exceeding maxBatches', async () => {
    const cases = buildBenchmarkManifest(KB);
    const { report } = await runLunaBenchmark({
      adapter: mockBackedAdapter(),
      cases,
      structuredOutputMode: 'JSON_OBJECT_FALLBACK',
      referenceLibrary: lib,
      maxBatches: 3,
      maxCostUsd: 999,
    });
    expect(report.caseCount).toBe(3);
    expect(report.stoppedEarly).toBe(true);
    expect(report.stopReason).toMatch(/maxBatches=3/);
  });

  it('§14 — no paid network call unless RUN_LIVE_AI_BENCHMARK=1', () => {
    expect(liveBenchmarkEnabled({})).toBe(false);
    expect(liveBenchmarkEnabled({ RUN_LIVE_AI_BENCHMARK: '1' })).toBe(true);
  });
});

describe.skipIf(!liveBenchmarkEnabled())('C5.1 — LIVE Luna benchmark (paid)', () => {
  it('runs the frozen manifest under the spend guardrail and prints the report', async () => {
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
    const { report } = await runLunaBenchmark({
      adapter,
      cases: buildBenchmarkManifest(),
      structuredOutputMode: cfg.structuredOutputMode,
      maxBatches: cfg.liveBenchmarkMaxBatches,
      maxCostUsd: cfg.liveBenchmarkMaxCostUsd,
      pricingConfigVersion: cfg.pricingConfigVersion,
    });
    process.stdout.write(`\n${formatBenchmarkReport(report)}\n\n${JSON.stringify(report, null, 2)}\n`);
    expect(report.caseCount).toBeGreaterThan(0);
  }, 600_000);
});
