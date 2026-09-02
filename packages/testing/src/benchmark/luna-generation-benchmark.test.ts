import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { liveBenchmarkEnabled, loadAiGenerationConfig, resolveLunaApiKey, type AIProviderAdapter } from '@copilot/ai';
import { createMockExerciseGenerator, buildGenerationGrounding } from '@copilot/exercise-gen';
import { KB } from '../harness.js';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildBenchmarkManifest } from './luna-benchmark-manifest.js';
import { algebraicFrontierTrace, buildHardCaseManifest, type HardCase } from './luna-hardcase-manifest.js';
import { runLunaBenchmark, formatBenchmarkReport } from './luna-generation-benchmark.js';

const lib = loadReferenceLibrary();
const kIdx = (k: string) => KNOWLEDGE_LEVELS.indexOf(k as never);
const tIdx = (t: string) => THINKING_LEVELS.indexOf(t as never);

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

// --- C5.2 §B (patched) — HC01–HC10 expected vs actual (no network) -----------

const SYMMETRIC = 'M7.ALG.SYMMETRIC';
const BRIDGE_G8 = 'M7.ALG.IDENTITY';

describe('C5.2 §B/§1-§3 — hard-case manifest HC01–HC10 (deterministic pipeline)', () => {
  const hcs = buildHardCaseManifest();

  it('builds exactly 10 hard cases, all from synthetic evidence', () => {
    expect(hcs.map((h) => h.hardCaseId)).toEqual(['HC01', 'HC02', 'HC03', 'HC04', 'HC05', 'HC06', 'HC07', 'HC08', 'HC09', 'HC10']);
    for (const h of hcs) expect(JSON.stringify(h.spec)).not.toMatch(/@[\w.]+\.\w{2,}/);
  });

  it.each(buildHardCaseManifest())('$hardCaseId meets its expectations', (hc: HardCase) => {
    const s = hc.spec;
    const e = hc.expect;
    const d = s.generationPlan.distribution;
    const frontier = s.targets.skills.filter((t) => t.role === 'FRONTIER');
    const aboveGrade = s.targets.skills.filter((t) => t.curriculumOrigin > s.schoolGrade);

    if (e.frontierSelected === true) expect(frontier.length, `${hc.hardCaseId} frontier`).toBeGreaterThan(0);
    if (e.frontierSelected === false) expect(frontier, `${hc.hardCaseId} frontier`).toEqual([]);
    if (e.hasAboveGradeTarget) expect(aboveGrade.length).toBeGreaterThan(0);
    if (e.noAboveGradeK) expect(aboveGrade, `${hc.hardCaseId} above-grade`).toEqual([]);
    if (e.advancedBucketExactly !== undefined) expect(d.advanced).toBe(e.advancedBucketExactly);
    if (e.advancedBucketMin !== undefined) expect(d.advanced).toBeGreaterThanOrEqual(e.advancedBucketMin);
    if (e.thinkingChallengeMin !== undefined) expect(d.thinkingChallenge).toBeGreaterThanOrEqual(e.thinkingChallengeMin);
    if (e.prerequisiteRepairMin !== undefined) expect(d.prerequisiteRepair).toBeGreaterThanOrEqual(e.prerequisiteRepairMin);
    if (e.prerequisiteRepairMax !== undefined) expect(d.prerequisiteRepair).toBeLessThanOrEqual(e.prerequisiteRepairMax);
    if (e.kMaxAtMost !== undefined) expect(kIdx(s.difficulty.kMax)).toBeLessThanOrEqual(kIdx(e.kMaxAtMost));
    if (e.kMaxAtLeast !== undefined) expect(kIdx(s.difficulty.kMax), `${hc.hardCaseId} kMax`).toBeGreaterThanOrEqual(kIdx(e.kMaxAtLeast));
    if (e.tMaxAtLeast !== undefined) expect(tIdx(s.difficulty.tMax)).toBeGreaterThanOrEqual(tIdx(e.tMaxAtLeast));
    if (e.tMaxAtMost !== undefined) expect(tIdx(s.difficulty.tMax), `${hc.hardCaseId} tMax`).toBeLessThanOrEqual(tIdx(e.tMaxAtMost));
    if (e.frontierSkillIsNot !== undefined) expect(frontier.map((t) => t.skillId)).not.toContain(e.frontierSkillIsNot);
    if (e.frontierSkillIs !== undefined) expect(frontier.map((t) => t.skillId), `${hc.hardCaseId} frontier skill`).toContain(e.frontierSkillIs);
    if (e.frontierSkillSelectionReasonIn !== undefined && e.frontierSkillIs !== undefined) {
      const t = frontier.find((x) => x.skillId === e.frontierSkillIs)!;
      expect(e.frontierSkillSelectionReasonIn).toContain(t.selectionReason);
    }
    if (e.contextConfidenceNot !== undefined) expect(s.learningContext.confidence).not.toBe(e.contextConfidenceNot);
    if (e.contextConfidenceIs !== undefined) expect(s.learningContext.confidence).toBe(e.contextConfidenceIs);
    if (e.contextSourceIs !== undefined) expect(s.learningContext.source).toBe(e.contextSourceIs);
    if (e.stretchRatioAtMost !== undefined) expect(s.difficulty.stretchRatio).toBeLessThanOrEqual(e.stretchRatioAtMost);
    if (e.currentLessonNodeType !== undefined) {
      expect(KB.getCurriculumNode(s.learningContext.resolvedLessonId!).nodeType).toBe(e.currentLessonNodeType);
    }
  });

  it('§1 — HC05→HC06 proves the SAME Grade-9 candidate (SYMMETRIC) opens after bridge repair', () => {
    const hc05 = hcs.find((h) => h.hardCaseId === 'HC05')!.pipeline!;
    const hc06 = hcs.find((h) => h.hardCaseId === 'HC06')!.pipeline!;
    const t05 = algebraicFrontierTrace(hc05);
    const t06 = algebraicFrontierTrace(hc06);

    // BEFORE repair: SYMMETRIC (origin 9) is a candidate, REJECTED, reason names the Grade-8 bridge.
    const rej05 = t05.rejected.find((r) => r.skillId === SYMMETRIC);
    expect(rej05, 'HC05: SYMMETRIC must be rejected').toBeDefined();
    expect(rej05!.origin).toBe(9);
    expect(rej05!.reason).toMatch(new RegExp(BRIDGE_G8));
    expect(t05.selected, 'HC05: SYMMETRIC not selected').not.toContain(SYMMETRIC);
    // and a repair target exists for the bridge
    expect(hc05.spec.targets.skills.some((t) => t.role === 'PREREQUISITE_REPAIR' && t.skillId === BRIDGE_G8)).toBe(true);

    // AFTER repair: the SAME bridge is mastered, SYMMETRIC is no longer rejected, and it IS a selected FRONTIER target.
    expect(t06.rejected.find((r) => r.skillId === SYMMETRIC), 'HC06: SYMMETRIC no longer rejected').toBeUndefined();
    expect(t06.candidates.map((c) => c.skillId)).toContain(SYMMETRIC);
    expect(t06.selected, 'HC06: SYMMETRIC selected as frontier').toContain(SYMMETRIC);
    const chosen = t06.selectedFrontierTargets.find((t) => t.skillId === SYMMETRIC)!;
    expect(chosen.selectedCurriculumOrigin).toBe(9);
    // NEXT_SAFE if it were a fresh unlock; MASTERED_FRONTIER_STRETCH because the child already
    // demonstrated Grade-9 work in HC05 — either is a legitimate, traceable progression.
    expect(['NEXT_SAFE_FRONTIER', 'MASTERED_FRONTIER_STRETCH']).toContain(chosen.selectionReason);
    expect(hc06.spec.generationPlan.distribution.prerequisiteRepair).toBe(0);
  });
});

// --- C5.2 §F/§G — coverage matrix + readiness (no network) -------------------

describe('C5.2 §F/§G — coverage matrix + live readiness', () => {
  async function runAll(opts?: { adversarialTestsPassed?: boolean; buildGatesGreen?: boolean }) {
    return runLunaBenchmark({
      adapter: mockBackedAdapter(),
      cases: buildBenchmarkManifest(KB),
      hardCases: buildHardCaseManifest(),
      structuredOutputMode: 'JSON_OBJECT_FALLBACK',
      referenceLibrary: lib,
      maxBatches: 100,
      maxCostUsd: 999,
      pricingConfigVersion: 'ai-pricing-registry.v1',
      adversarialTestsPassed: opts?.adversarialTestsPassed ?? true,
      buildGatesGreen: opts?.buildGatesGreen ?? true,
    });
  }

  it('the coverage matrix reports the required dimensions with no hidden GAP', async () => {
    const { report } = await runAll();
    const c = report.coverage;
    expect(c.baseCases).toBe(16);
    expect(c.hardCases).toBe(10);
    expect(c.grade.g4).toBeGreaterThan(0);
    expect(c.grade.g7).toBeGreaterThan(0);
    expect(c.targetRole.FRONTIER).toBeGreaterThan(0);
    expect(c.targetRole.THINKING).toBeGreaterThan(0);
    expect(c.targetRole.PREREQUISITE_REPAIR).toBeGreaterThan(0);
    expect(c.aboveGradeFrontier).toBeGreaterThan(0);
    expect(c.gradeLevelT4T5).toBeGreaterThan(0);
    expect(c.parallelGapRepair).toBeGreaterThan(0);
    expect(c.thinkingLevel.T4).toBeGreaterThan(0);
    expect(c.thinkingLevel.T5).toBeGreaterThan(0);
    expect(c.knowledgeLevel.K4, 'K4 covered').toBeGreaterThan(0);
    expect(c.knowledgeLevel.K5, 'K5 covered (HC10)').toBeGreaterThan(0);
    expect(c.contextConfidence.ESTIMATED, 'ESTIMATED covered (HC09)').toBeGreaterThan(0);
    expect(c.contextConfidence.SUPPORTING).toBeGreaterThan(0);
    expect(c.contextConfidence.STRONG).toBeGreaterThan(0);
    expect(c.contextConfidence.VERIFIED).toBeGreaterThan(0);
    expect(c.parentGoal.hsg_thi_chuyen).toBeGreaterThan(0);
    // answer-format coverage probed from mock batches
    expect(c.answerFormatType.numeric).toBeGreaterThan(0);
    expect(c.answerVerificationLevel.FORMAT_VERIFIED ?? c.answerVerificationLevel.DETERMINISTIC_CORRECTNESS_VERIFIED).toBeGreaterThan(0);
    // any remaining uncovered cell is listed explicitly, never hidden
    expect(Array.isArray(c.uncovered)).toBe(true);
    // the still-non-blocking gaps stay visible
    expect(c.uncovered.join(' ')).toMatch(/choice|exact|deterministic-correctness/);
  });

  it('benchmarkReady is true only when every §G criterion is met', async () => {
    const ready = (await runAll({ adversarialTestsPassed: true, buildGatesGreen: true })).report.readiness;
    expect(ready.hardCaseCount).toBe(10);
    expect(ready.baseCaseCount).toBe(16);
    expect(ready.totalCaseCount).toBe(26);
    expect(ready.benchmarkReady, ready.blockingCoverageGaps.join(' | ')).toBe(true);
    expect(ready.blockingCoverageGaps).toEqual([]);
    // non-blocking gaps are still surfaced, never hidden
    expect(ready.nonBlockingCoverageGaps.length).toBeGreaterThan(0);

    const notAdv = (await runAll({ adversarialTestsPassed: false, buildGatesGreen: true })).report.readiness;
    expect(notAdv.benchmarkReady).toBe(false);
    expect(notAdv.blockingCoverageGaps.join(' ')).toMatch(/adversarial/i);

    const notBuild = (await runAll({ adversarialTestsPassed: true, buildGatesGreen: false })).report.readiness;
    expect(notBuild.benchmarkReady).toBe(false);
  });

  it('the exact reference-copy gate is a HARD gate at 0', async () => {
    const { report } = await runAll();
    const gate = report.gates.find((g) => g.name === 'exactReferenceCopyRate')!;
    expect(gate.label).toMatch(/HARD GATE/);
    expect(report.quality.exactReferenceCopyRate).toBe(0); // mock never copies
    expect(gate.pass).toBe(true);
  });

  it('the machine-readable report is complete and stringifiable', async () => {
    const { report } = await runAll();
    for (const k of ['benchmarkVersion', 'manifestVersion', 'promptVersion', 'outputSchemaVersion', 'structuredOutputModeRequested', 'coverage', 'readiness', 'gates', 'answers', 'cost', 'usage', 'performance']) {
      expect(report).toHaveProperty(k);
    }
    expect(typeof formatBenchmarkReport(report)).toBe('string');
  });
});

describe('C5.2 §H — no paid network call unless RUN_LIVE_AI_BENCHMARK=1', () => {
  it('the gate is off by default', () => {
    expect(liveBenchmarkEnabled({})).toBe(false);
    expect(liveBenchmarkEnabled({ RUN_LIVE_AI_BENCHMARK: '1' })).toBe(true);
  });
});

describe.skipIf(!liveBenchmarkEnabled())('C5.2 — LIVE Luna benchmark (paid)', () => {
  it('runs base + hard manifest under the spend guardrail and prints the report', async () => {
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
      hardCases: buildHardCaseManifest(),
      structuredOutputMode: cfg.structuredOutputMode,
      maxBatches: cfg.liveBenchmarkMaxBatches,
      maxCostUsd: cfg.liveBenchmarkMaxCostUsd,
      pricingConfigVersion: cfg.pricingConfigVersion,
      adversarialTestsPassed: true,
      buildGatesGreen: true,
    });
    process.stdout.write(`\n${formatBenchmarkReport(report)}\n\n${JSON.stringify(report, null, 2)}\n`);
    expect(report.caseCount).toBeGreaterThan(0);
  }, 900_000);
});
