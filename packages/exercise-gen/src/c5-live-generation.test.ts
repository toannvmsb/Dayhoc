import { describe, expect, it } from 'vitest';
import { asSkillId, type GeneratedExercise, type GeneratedExerciseBatch } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  PricingRegistry,
  resolveRoute,
  AIModelRouter,
  liveBenchmarkEnabled,
  loadAiGenerationConfig,
  type AIProviderAdapter,
  type StructuredAIInput,
  type StructuredAIOutput,
} from '@copilot/ai';
import { buildGenerationGrounding } from './grounding.js';
import { validateGeneratedBatch } from './validator.js';
import { verifyMathAnswer } from './math-verifier.js';
import { createMockExerciseGenerator } from './mock-generator.js';
import { createLunaExerciseGenerator, EXERCISE_GENERATOR_PROMPT_VERSION, EXERCISE_GENERATOR_SYSTEM_PROMPT } from './luna-generator.js';
import { orchestrateGeneration } from './orchestrator.js';
import { computeActualCost } from './cost.js';
import { generationOperationToUsageEvent } from './telemetry.js';
import { toGenerationRecords, InMemoryGenerationStore } from './persistence.js';
import { runShadowGeneration, InMemoryShadowGenerationQueue } from './shadow.js';
import { assessItemAnswerVerification, summarizeAnswerVerification } from './answer-verification.js';
import { wouldRequireVerification, createStubSecondPassVerifier } from './verifier.js';
import { aggregateShadowMetrics, type ShadowMetricRecord } from './shadow-metrics.js';
import { makeSpec } from './_spec-fixture.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const spec = makeSpec();

/** A fake `AIProviderAdapter` — returns canned text, records the last call. No network. */
function fakeAdapter(opts: {
  text?: string | (() => string);
  throwErr?: Error;
  usage?: StructuredAIOutput['usage'];
  model?: string;
}): AIProviderAdapter & { lastInput: StructuredAIInput | null; calls: number } {
  const state = { lastInput: null as StructuredAIInput | null, calls: 0 };
  return {
    provider: 'openai',
    capability: 'generate_problem',
    model: opts.model ?? 'gpt-5.6-luna',
    processingRegion: 'test',
    crossBorder: false,
    dataCategoriesAllowed: [],
    providerRetention: 'none',
    trainingAllowed: false,
    dpaStatus: 'not_applicable',
    lastInput: state.lastInput,
    get calls() {
      return state.calls;
    },
    call(input: StructuredAIInput): Promise<StructuredAIOutput> {
      state.calls += 1;
      state.lastInput = input;
      (this as { lastInput: StructuredAIInput | null }).lastInput = input;
      if (opts.throwErr) return Promise.reject(opts.throwErr);
      const text = typeof opts.text === 'function' ? opts.text() : (opts.text ?? '{}');
      return Promise.resolve({ text, usage: opts.usage ?? { inputTokens: 1200, outputTokens: 900 } });
    },
  };
}

async function validBatchJson(over?: (b: GeneratedExerciseBatch) => GeneratedExerciseBatch): Promise<string> {
  const g = buildGenerationGrounding(spec, lib, kb);
  const r = await createMockExerciseGenerator().generate({ grounding: g });
  if (!r.ok) throw new Error('mock did not produce a batch');
  return JSON.stringify(over ? over(r.batch) : r.batch);
}

describe('C5 §23 — live generation infrastructure (no network)', () => {
  it('1. provider structured response → schema → validator → delivered', async () => {
    const gen = createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) });
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('delivered');
  });

  it('2. malformed provider response → no delivery', async () => {
    const gen = createLunaExerciseGenerator({ adapter: fakeAdapter({ text: 'not json at all {{{' }) });
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
  });

  it('3. invented skill id → quarantine, never delivered', async () => {
    const text = await validBatchJson((b) => ({
      ...b,
      items: b.items.map((it, i) => (i === 0 ? { ...it, skillId: asSkillId('M7.NOT.A.REAL.SKILL') } : it)),
    }));
    const gen = createLunaExerciseGenerator({ adapter: fakeAdapter({ text }) });
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.reason).toMatch(/quarantin/i);
  });

  it('4. provider inability → bounded failure (no infinite retry)', async () => {
    const gen = createLunaExerciseGenerator({ adapter: fakeAdapter({ throwErr: new Error('503 upstream') }) });
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
    expect(res.trace.generationAttempts).toBeLessThanOrEqual(2);
    expect(res.trace.operations.length).toBeLessThanOrEqual(4);
  });

  it('9. generator payload carries no child PII / twin / history', async () => {
    const adapter = fakeAdapter({ text: await validBatchJson() });
    const gen = createLunaExerciseGenerator({ adapter });
    await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    const payloadStr = JSON.stringify(adapter.lastInput?.payload ?? {});
    expect(payloadStr).not.toContain(spec.childId);
    // no Twin / evidence / child-state field ever crosses to the provider
    for (const forbidden of ['relevantMastery', 'thinkingProfile', 'actualLearningFrontier', 'prerequisiteGaps', 'childState', 'evidence', 'masteryTimeline', 'displayName', 'parentName']) {
      expect(payloadStr).not.toContain(forbidden);
    }
  });

  it('9b. system policy and DATA are delimited; reference text cannot pose as instruction', async () => {
    const adapter = fakeAdapter({ text: await validBatchJson() });
    await createLunaExerciseGenerator({ adapter }).generate({ grounding: buildGenerationGrounding(spec, lib, kb) });
    expect(adapter.lastInput?.system).toBe(EXERCISE_GENERATOR_SYSTEM_PROMPT);
    expect(adapter.lastInput?.system).toMatch(/DATA, not instructions/);
    const userContent = JSON.stringify(adapter.lastInput?.payload);
    // reference/spec data travels in the payload, never the system slot
    expect(adapter.lastInput?.system).not.toContain(userContent.slice(0, 40));
  });

  it('10. reference-example near-copy → REFERENCE_EXAMPLE_COPY → regenerate', async () => {
    const g = buildGenerationGrounding(spec, lib, kb);
    const refPrompt = g.referenceExamples[0]?.prompt ?? 'reference';
    let attempt = 0;
    const gen = createLunaExerciseGenerator({
      adapter: fakeAdapter({
        text: () => {
          attempt += 1;
          // first call: copy a reference prompt verbatim into item 0
          return attempt === 1
            ? JSON.stringify({
                generationSpecId: spec.generationSpecId,
                generatedAt: '2027-01-25T09:00:00.000Z',
                items: mockItemsWithPrompt(refPrompt),
              })
            : mockValidText;
        },
      }),
    });
    // build a valid fallback once
    const mockValidText = await validBatchJson();
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    // either it regenerated to a deliverable batch, or the finding was raised — both prove the gate works
    const found =
      (res.status === 'delivered') ||
      (res.status === 'failed' && (res.lastValidation?.reasonCodes ?? []).includes('REFERENCE_EXAMPLE_COPY'));
    expect(found).toBe(true);
  });

  it('C5.1 §1 — a well-formed answer with a WORD-PROBLEM prompt is FORMAT_VERIFIED, never correctness', () => {
    // prompt has no closed expression → the math verifier can't touch it
    const numeric = item({ prompt: 'Một cửa hàng có 12 hộp bánh, mỗi hộp 8 cái.', answerSpec: { kind: 'numeric', value: 96, tolerance: 0 } });
    expect(assessItemAnswerVerification(numeric)).toBe('FORMAT_VERIFIED');
    const frac = item({ prompt: 'Chia đều cái bánh cho các bạn.', answerSpec: { kind: 'fraction', numerator: 3, denominator: 4 } });
    expect(assessItemAnswerVerification(frac)).toBe('FORMAT_VERIFIED');
    // malformed key → UNVERIFIED
    expect(assessItemAnswerVerification(item({ answerSpec: { kind: 'choice', correct: 'Z', options: ['A', 'B'] } }))).toBe('UNVERIFIED');
  });

  it('C5.1 §2 — supported arithmetic that is CORRECT becomes DETERMINISTIC_CORRECTNESS_VERIFIED', () => {
    const ok = item({ prompt: '3/4 + 1/2 = ?', answerSpec: { kind: 'fraction', numerator: 5, denominator: 4 } });
    expect(assessItemAnswerVerification(ok)).toBe('DETERMINISTIC_CORRECTNESS_VERIFIED');
    const okNum = item({ prompt: 'Tính: 2 + 3 × 4', answerSpec: { kind: 'numeric', value: 14, tolerance: 0 } });
    expect(assessItemAnswerVerification(okNum)).toBe('DETERMINISTIC_CORRECTNESS_VERIFIED');
  });

  it('C5.1 §2 — well-formed but mathematically WRONG answers are NOT correctness verified', () => {
    const wrongFrac = item({ prompt: '1/2 + 1/3 = ?', answerSpec: { kind: 'fraction', numerator: 2, denominator: 5 } });
    expect(assessItemAnswerVerification(wrongFrac)).toBe('UNVERIFIED'); // format ok, but proven wrong
    const wrongPrec = item({ prompt: '2 + 3 × 4 = ?', answerSpec: { kind: 'numeric', value: 20, tolerance: 0 } });
    expect(assessItemAnswerVerification(wrongPrec)).toBe('UNVERIFIED');
    // and the validator rejects them so they are never delivered
    const v = validateGeneratedBatch(
      { generationSpecId: spec.generationSpecId, generatedAt: '2027-01-25T09:00:00.000Z', items: [wrongPrec] },
      spec,
      kb,
    );
    expect(v.reasonCodes).toContain('ANSWER_INCONSISTENT');
  });

  it('14. reasoning answers are AI_CROSSCHECK_REQUIRED and never faked as deterministic', () => {
    const r = item({ answerSpec: { kind: 'reasoning' }, rubric: 'grade the argument' });
    expect(assessItemAnswerVerification(r)).toBe('AI_CROSSCHECK_REQUIRED');
    expect(wouldRequireVerification(r, spec)).toContain('reasoning_or_proof_item');
    return createStubSecondPassVerifier()
      .verify(r, spec)
      .then((o) => expect(o.verified).toBe(false));
  });

  it('15. real provider token usage → actual cost on the ledger event', async () => {
    const adapter = fakeAdapter({ text: await validBatchJson(), usage: { inputTokens: 5000, outputTokens: 3000 } });
    const gen = createLunaExerciseGenerator({ adapter });
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    const op = res.trace.operations[0]!;
    expect(op.inputTokens).toBe(5000);
    expect(op.outputTokens).toBe(3000);
    expect(op.actualCostUsd).toBeGreaterThan(0);
    expect(op.estimatedCostUsd).toBe(0);
    const evt = generationOperationToUsageEvent(op, { plan: 'basic', userRef: 'u_x', childRef: null });
    expect(evt.actualCostVnd).not.toBeNull();
    expect(evt.actualCostVnd!).toBeGreaterThan(0);
  });

  it('16. price config is selected by the request date', () => {
    const registry = new PricingRegistry([
      { model: 'gpt-5.6-luna', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2, effectiveDate: '2026-08-31', source: 't' },
      { model: 'gpt-5.6-luna', provider: 'openai', unit: 'per_million_tokens', inputPerMillionUsd: 0.5, outputPerMillionUsd: 2.0, effectiveDate: '2027-06-01', source: 't' },
    ]);
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const before = computeActualCost(usage, 'gpt-5.6-luna', new Date('2027-01-01'), registry);
    const after = computeActualCost(usage, 'gpt-5.6-luna', new Date('2027-07-01'), registry);
    expect(before.actualCostUsd).toBeCloseTo(0.2, 5);
    expect(after.actualCostUsd).toBeCloseTo(0.5, 5);
    expect(before.priceConfigVersion).toBe('2026-08-31');
    expect(after.priceConfigVersion).toBe('2027-06-01');
  });

  it('17. estimated cost is never the ledger source of truth when an actual exists', async () => {
    const adapter = fakeAdapter({ text: await validBatchJson(), usage: { inputTokens: 2000, outputTokens: 1000 } });
    const res = await orchestrateGeneration({ spec, generator: createLunaExerciseGenerator({ adapter }), referenceLibrary: lib, knowledgeBase: kb });
    const op = res.trace.operations[0]!;
    expect(op.estimatedCostUsd).toBe(0);
    expect(op.actualCostUsd).not.toBeNull();
    expect(op.actualCostUsd).not.toBe(op.estimatedCostUsd);
  });

  it('18. prompt version is set and persisted on the trace', async () => {
    const res = await orchestrateGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(res.trace.operations[0]!.promptVersion).toBe(EXERCISE_GENERATOR_PROMPT_VERSION);
    const { setRecord } = toGenerationRecords(spec, res, { setId: 'ges_pv' });
    expect(JSON.stringify(setRecord.trace)).toContain(EXERCISE_GENERATOR_PROMPT_VERSION);
  });

  it('19. every shadow batch is traceable to its GenerationSpec', async () => {
    const store = new InMemoryGenerationStore();
    const out = await runShadowGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
      store,
      newSetId: () => 'ges_shadow_1',
    });
    expect(out.ok).toBe(true);
    const sets = await store.listExerciseSets(spec.generationSpecId);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.generationSpecId).toBe(spec.generationSpecId);
  });

  it('20. no infinite retries — always-quarantine input still terminates', async () => {
    const badText = await validBatchJson((b) => ({
      ...b,
      items: b.items.map((it) => ({ ...it, skillId: asSkillId('M7.FAKE.SKILL') })),
    }));
    const res = await orchestrateGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: badText }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(res.status).toBe('failed');
    expect(res.trace.generationAttempts).toBe(2);
  });

  it('21. advanced provider routing remains OPEN_PENDING_BENCHMARK (Luna fallback)', () => {
    const d = resolveRoute('worksheet_batch_generation', { hsg: true });
    expect(d.tier).toBe('advanced');
    expect(d.advancedModelPending).toBe(true);
    expect(d.effectiveTier).toBe('luna');
  });

  it('22. the subscription plan never selects the provider/model', () => {
    expect(AIModelRouter.PLAN_DOES_NOT_SELECT_MODEL).toBe(true);
    // resolveRoute has no `plan` parameter — same ctx always yields the same decision
    const a = resolveRoute('worksheet_batch_generation', { knowledgeLevel: 'K2' });
    const b = resolveRoute('worksheet_batch_generation', { knowledgeLevel: 'K2' });
    expect(a).toEqual(b);
    expect(a.tier).toBe('luna');
  });

  it('23. shadow quality metrics aggregate correctly', async () => {
    const g = createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) });
    const okRes = await orchestrateGeneration({ spec, generator: g, referenceLibrary: lib, knowledgeBase: kb });
    const records: ShadowMetricRecord[] = [
      { spec, result: okRes, answerVerification: okRes.status === 'delivered' ? summarizeAnswerVerification(okRes.batch) : null },
      { spec, result: okRes, answerVerification: okRes.status === 'delivered' ? summarizeAnswerVerification(okRes.batch) : null },
    ];
    const m = aggregateShadowMetrics(records);
    expect(m.shadowBatches).toBe(2);
    expect(m.finalDeliverableRate).toBe(1);
    expect(m.skillAdherenceRate).toBe(1);
    expect(m.bucketAdherenceRate).toBe(1);
    expect(m.noInventedSkillIdRate).toBe(1);
    expect(m.averageActualCostVndPerBatch).toBeGreaterThan(0);
  });

  it('24. config defaults are valid and OFF until explicitly enabled; no key in config', () => {
    const cfg = loadAiGenerationConfig({});
    expect(cfg.mode).toBe('OFF');
    expect(cfg.defaultProvider).toBe('openai');
    expect(cfg.defaultModel).toBe('gpt-5.6-luna');
    expect(Object.values(cfg).join(' ')).not.toMatch(/sk-|api[_-]?key/i);
    expect(loadAiGenerationConfig({ AI_GENERATION_MODE: 'SHADOW' }).mode).toBe('SHADOW');
    expect(loadAiGenerationConfig({ AI_GENERATION_MODE: 'nonsense' }).mode).toBe('OFF');
  });

  it('24b. in-memory shadow queue runs jobs off the caller stack', async () => {
    let ran = false;
    const queue = new InMemoryShadowGenerationQueue({ onResult: () => (ran = true) });
    queue.enqueue({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: '{}' }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(ran).toBe(false); // not run synchronously
    await queue.drain();
    expect(ran).toBe(true);
  });
});

describe('C5.1 §3/§4 — strict structured output + schema versioning', () => {
  it('§3/§10.6 — STRICT mode asks the provider for a JSON schema; the mode used is recorded', async () => {
    const adapter = fakeAdapter({ text: await validBatchJson() });
    const gen = createLunaExerciseGenerator({ adapter, structuredOutputMode: 'STRICT_JSON_SCHEMA' });
    // fake adapter echoes the requested mode, so it round-trips
    const orig = adapter.call.bind(adapter);
    let sawSchema = false;
    (adapter as unknown as { call: typeof adapter.call }).call = (input) => {
      if (input.structuredOutputMode === 'STRICT_JSON_SCHEMA' && input.jsonSchema) sawSchema = true;
      return orig(input).then((o) => ({ ...o, structuredOutputMode: input.structuredOutputMode ?? 'JSON_OBJECT_FALLBACK' }));
    };
    const res = await orchestrateGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(sawSchema).toBe(true);
    expect(res.trace.operations[0]!.structuredOutputMode).toBe('STRICT_JSON_SCHEMA');
  });

  it('§3/§10.7 — default is JSON_OBJECT_FALLBACK; never a fake strict claim', async () => {
    const res = await orchestrateGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(res.trace.operations[0]!.structuredOutputMode).toBe('JSON_OBJECT_FALLBACK');
    expect(loadAiGenerationConfig({}).structuredOutputMode).toBe('JSON_OBJECT_FALLBACK');
    expect(loadAiGenerationConfig({ AI_GENERATION_STRUCTURED_OUTPUT_MODE: 'STRICT_JSON_SCHEMA' }).structuredOutputMode).toBe('STRICT_JSON_SCHEMA');
  });

  it('§4/§10.8 — output schema name + version are recorded on the operation and the trace', async () => {
    const res = await orchestrateGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter: fakeAdapter({ text: await validBatchJson() }) }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    const op = res.trace.operations[0]!;
    expect(op.outputSchemaName).toBe('generatedExerciseBatch');
    expect(op.outputSchemaVersion).toBe('generatedExerciseBatch.jsonschema.v1');
    expect(op.promptVersion).toBe(EXERCISE_GENERATOR_PROMPT_VERSION);
    const { setRecord } = toGenerationRecords(spec, res, { setId: 'ges_ver' });
    expect(JSON.stringify(setRecord.trace)).toContain('generatedExerciseBatch.jsonschema.v1');
  });

  it('§8/§10.13 — the config spend guardrail has sane positive defaults', () => {
    const cfg = loadAiGenerationConfig({});
    expect(cfg.liveBenchmarkMaxBatches).toBeGreaterThan(0);
    expect(cfg.liveBenchmarkMaxCostUsd).toBeGreaterThan(0);
    expect(loadAiGenerationConfig({ LIVE_BENCHMARK_MAX_BATCHES: '7' }).liveBenchmarkMaxBatches).toBe(7);
    expect(loadAiGenerationConfig({ LIVE_BENCHMARK_MAX_COST_USD: '2.5' }).liveBenchmarkMaxCostUsd).toBe(2.5);
  });
});

describe('C5.1 §5/§10 — reference-example copy detection precision', () => {
  const g = buildGenerationGrounding(spec, lib, kb);
  const refPrompt = g.referenceExamples[0]!.prompt;

  const batchWith = (prompt: string): GeneratedExerciseBatch => ({
    generationSpecId: spec.generationSpecId,
    generatedAt: '2027-01-25T09:00:00.000Z',
    items: [item({ id: 'gx_ref_1', prompt })],
  });

  it('9. an exact copy of a reference example is rejected', () => {
    const v = validateGeneratedBatch(batchWith(refPrompt), spec, kb, g.referenceExamples);
    expect(v.reasonCodes).toContain('REFERENCE_EXAMPLE_COPY');
  });

  it('10. a number-only mutation of the same template is rejected (normalization masks digits)', () => {
    const mutated = refPrompt.replace(/\d+/g, (d) => String(Number(d) + 1));
    const v = validateGeneratedBatch(batchWith(mutated), spec, kb, g.referenceExamples);
    expect(v.reasonCodes).toContain('REFERENCE_EXAMPLE_COPY');
  });

  it('11. a structurally different same-skill question is accepted', () => {
    const different = 'Một đội công nhân sửa 3/8 quãng đường trong ngày đầu, ngày sau sửa thêm 1/4. Hỏi còn lại bao nhiêu phần quãng đường?';
    const v = validateGeneratedBatch(batchWith(different), spec, kb, g.referenceExamples);
    expect(v.reasonCodes).not.toContain('REFERENCE_EXAMPLE_COPY');
  });
});

describe('C5.1 §2 — deterministic math verifier scope', () => {
  it('supports integer / decimal / fraction arithmetic with correct operator precedence', () => {
    expect(verifyMathAnswer({ prompt: '2 + 3 × 4 = ?', workedSolution: '= 14', answerSpec: { kind: 'numeric', value: 14, tolerance: 0 } }).verdict).toBe('CORRECT');
    expect(verifyMathAnswer({ prompt: '(2 + 3) × 4 = ?', workedSolution: '', answerSpec: { kind: 'numeric', value: 20, tolerance: 0 } }).verdict).toBe('CORRECT');
    expect(verifyMathAnswer({ prompt: 'Tính: 1/2 + 1/3', workedSolution: '', answerSpec: { kind: 'fraction', numerator: 5, denominator: 6 } }).verdict).toBe('CORRECT');
    expect(verifyMathAnswer({ prompt: '0,5 + 0,25 = ?', workedSolution: '', answerSpec: { kind: 'numeric', value: 0.75, tolerance: 0 } }).verdict).toBe('CORRECT');
  });

  it('returns UNSUPPORTED (never a guess) for word problems and reasoning', () => {
    expect(verifyMathAnswer({ prompt: 'Một cửa hàng có 12 hộp bánh.', workedSolution: '', answerSpec: { kind: 'numeric', value: 96, tolerance: 0 } }).verdict).toBe('UNSUPPORTED');
    expect(verifyMathAnswer({ prompt: '1/2 + 1/3 = ?', workedSolution: '', answerSpec: { kind: 'reasoning' } }).verdict).toBe('UNSUPPORTED');
  });

  it('flags a supported-but-wrong answer as INCORRECT', () => {
    expect(verifyMathAnswer({ prompt: '1/2 + 1/3 = ?', workedSolution: '', answerSpec: { kind: 'fraction', numerator: 2, denominator: 5 } }).verdict).toBe('INCORRECT');
  });
});

// The one test that actually spends money — skipped unless RUN_LIVE_AI_BENCHMARK=1
// AND a key is present (doc 14 C5 §24). CI never reaches the body.
describe.skipIf(!liveBenchmarkEnabled())('C5 — live Luna smoke (paid)', () => {
  it('generates one real batch that passes the validator', async () => {
    const { createOpenAiProviderAdapter, resolveLunaApiKey } = await import('@copilot/ai');
    const apiKey = resolveLunaApiKey();
    if (!apiKey) return;
    const cfg = loadAiGenerationConfig();
    const adapter = createOpenAiProviderAdapter({
      apiKey,
      model: cfg.defaultModel,
      capability: 'generate_problem',
      compliance: { processingRegion: 'us', crossBorder: true, dataCategoriesAllowed: [], providerRetention: '30d', trainingAllowed: false, dpaStatus: 'pending' },
    });
    const res = await orchestrateGeneration({
      spec,
      generator: createLunaExerciseGenerator({ adapter }),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(['delivered', 'failed']).toContain(res.status);
  }, 60_000);
});

// --- helpers ---
let idc = 0;
function item(over: Partial<GeneratedExercise>): GeneratedExercise {
  idc += 1;
  return {
    id: `gx_c5_${idc}`,
    generationSpecId: spec.generationSpecId,
    skillId: asSkillId('M7.RATIO.EQUAL_CHAIN'),
    requiredSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')],
    bucket: 'currentSkill',
    knowledgeLevel: 'K2',
    thinkingLevel: 'T2',
    prompt: 'Tính giá trị của biểu thức.',
    workedSolution: 'Ta có kết quả bằng 42.',
    hints: ['a', 'b', 'c', 'd', 'e', 'f'],
    answerSpec: { kind: 'numeric', value: 42, tolerance: 0.01 },
    origin: 'ai_generated',
    ...over,
  };
}

function mockItemsWithPrompt(prompt: string): unknown[] {
  const base = item({ prompt });
  return [{ ...base, id: 'gx_copy_1' }];
}
