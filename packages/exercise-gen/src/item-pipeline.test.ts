import { describe, expect, it } from 'vitest';
import { asSkillId, type GeneratedItemContent } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { makeSpec } from './_spec-fixture.js';
import { buildItemGenerationSpecs } from './item-spec.js';
import { buildProblemDNA } from './problem-dna.js';
import { checkItemSimilarity } from './similarity-gate.js';
import { composeExercise } from './compose.js';
import { acceptItem } from './item-validator.js';
import { createMockItemContentGenerator } from './mock-item-generator.js';
import { orchestrateItemGeneration } from './item-orchestrator.js';
import type { ItemContentGenerator } from './item-generator.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();

describe('doc 56 §1/§4 — buildItemGenerationSpecs (deterministic)', () => {
  it('produces exactly totalQuestions item specs, buckets matching the distribution', () => {
    const spec = makeSpec();
    const specs = buildItemGenerationSpecs(spec, kb);
    expect(specs).toHaveLength(spec.generationPlan.totalQuestions);
    const byBucket: Record<string, number> = {};
    for (const s of specs) byBucket[s.bucket] = (byBucket[s.bucket] ?? 0) + 1;
    for (const [b, n] of Object.entries(spec.generationPlan.distribution)) {
      if (n > 0) expect(byBucket[b] ?? 0).toBe(n);
    }
  });

  it('pins EXACT K/T inside the spec range — never leaves it to the model', () => {
    const specs = buildItemGenerationSpecs(makeSpec(), kb);
    const spec = makeSpec();
    for (const s of specs) {
      expect(['K0', 'K1', 'K2', 'K3', 'K4', 'K5']).toContain(s.knowledgeLevel);
      expect(s.knowledgeLevel >= spec.difficulty.kMin && s.knowledgeLevel <= spec.difficulty.kMax).toBe(true);
      expect(s.thinkingLevel >= spec.difficulty.tMin && s.thinkingLevel <= spec.difficulty.tMax).toBe(true);
    }
  });

  it('every requiredSkillId is a real KB skill and a spec target', () => {
    const spec = makeSpec();
    const specs = buildItemGenerationSpecs(spec, kb);
    for (const s of specs) {
      for (const r of s.requiredSkillIds) expect(kb.skills.has(r)).toBe(true);
      expect(spec.targets.skillIds).toContain(s.skillId);
    }
  });

  it('is deterministic — identical input → identical itemIds and levels', () => {
    const a = buildItemGenerationSpecs(makeSpec(), kb);
    const b = buildItemGenerationSpecs(makeSpec(), kb);
    expect(a.map((x) => `${x.itemId}|${x.knowledgeLevel}|${x.thinkingLevel}|${x.answerKind}`)).toEqual(
      b.map((x) => `${x.itemId}|${x.knowledgeLevel}|${x.thinkingLevel}|${x.answerKind}`),
    );
  });

  it('prerequisiteRepair items stay at the K floor; reasoning items get an AI-crosscheck policy', () => {
    const specs = buildItemGenerationSpecs(makeSpec(), kb);
    for (const s of specs) {
      if (s.bucket === 'prerequisiteRepair') expect(s.knowledgeLevel).toBe(makeSpec().difficulty.kMin);
      if (s.answerKind === 'reasoning') expect(s.answerVerificationPolicy).toBe('AI_OR_HUMAN_CROSSCHECK');
    }
  });
});

describe('doc 56 §5 — buildProblemDNA (de-anchoring)', () => {
  const spec = makeSpec();
  const itemSpecs = buildItemGenerationSpecs(spec, kb);
  const withRefs =
    itemSpecs.find((s) => lib.some((r) => r.skillId === s.skillId)) ?? itemSpecs[0]!;

  it('never carries a raw reference prompt by default', () => {
    const dna = buildProblemDNA(withRefs, kb, lib);
    expect(dna.rawReference).toBeNull();
  });

  it('carries structure, difficulty semantics, a number range and forbidden similarities', () => {
    const dna = buildProblemDNA(withRefs, kb, lib);
    expect(dna.problemStructure).toBe(withRefs.problemStructure);
    expect(dna.difficulty.knowledgeLevel).toBe(withRefs.knowledgeLevel);
    expect(dna.constraints.numberRange).toBeDefined();
    expect(Array.isArray(dna.forbiddenSimilarities.templateSkeletons)).toBe(true);
  });

  it('only attaches raw reference text with an explicit justification', () => {
    const refs = lib.filter((r) => r.skillId === withRefs.skillId);
    if (refs.length === 0) return;
    const dna = buildProblemDNA(withRefs, kb, lib, {
      rawReferenceJustification: () => 'find_the_error needs a concrete flawed solution',
    });
    expect(dna.rawReference?.leakageRisk).toBe('ELEVATED');
    expect(dna.rawReference?.justification).toMatch(/flawed solution/);
  });

  it('is deterministic (stable dnaHash)', () => {
    expect(buildProblemDNA(withRefs, kb, lib).dnaHash).toBe(buildProblemDNA(withRefs, kb, lib).dnaHash);
  });
});

describe('doc 56 §6 — similarity / leakage gate (model-independent)', () => {
  const ref = { id: 'R1', prompt: 'An có 5 quả táo, cho Bình 2 quả. Hỏi An còn lại mấy quả táo?' };

  it('flags a verbatim copy as COPY', () => {
    const r = checkItemSimilarity({ prompt: ref.prompt, references: [ref], worksheetSiblings: [] });
    expect(r.verdict).toBe('COPY');
  });

  it('flags a numbers-only mutation as COPY', () => {
    const r = checkItemSimilarity({
      prompt: 'An có 8 quả táo, cho Bình 3 quả. Hỏi An còn lại mấy quả táo?',
      references: [ref],
      worksheetSiblings: [],
    });
    expect(r.verdict).toBe('COPY');
  });

  it('flags a name/number swap of the same template as COPY (template_match)', () => {
    const r = checkItemSimilarity({
      prompt: 'Lan có 8 quả cam, cho Hoa 3 quả. Hỏi Lan còn lại mấy quả cam?',
      references: [ref],
      worksheetSiblings: [],
    });
    expect(r.verdict).toBe('COPY');
  });

  it('passes a genuinely different scenario', () => {
    const r = checkItemSimilarity({
      prompt: 'Một bể chứa 40 lít nước, mỗi phút chảy ra 3 lít. Sau 6 phút bể còn bao nhiêu lít?',
      references: [ref],
      worksheetSiblings: [],
    });
    expect(r.verdict).toBe('PASS');
  });

  it('rejects a prohibited number tuple regardless of wording', () => {
    const r = checkItemSimilarity({
      prompt: 'Chia 5 chiếc bút cho 2 nhóm học sinh trong lớp, mỗi nhóm mấy chiếc?',
      references: [],
      worksheetSiblings: [],
      prohibitedNumberTuples: [[2, 5]],
    });
    expect(r.verdict).toBe('COPY');
  });
});

describe('doc 56 §1/§2 — composeExercise (deterministic answer coercion)', () => {
  const spec = makeSpec();
  const [numericSpec] = buildItemGenerationSpecs(spec, kb).filter((s) => s.answerKind === 'numeric');

  const base: GeneratedItemContent = {
    itemId: numericSpec!.itemId,
    prompt: 'Tính: 12 + 7 = ?',
    answer: '19',
    hints: ['a', 'b', 'c', 'd', 'e', 'Lời giải: 19'],
    workedSolution: '12 + 7 = 19',
  };

  it('coerces a numeric answer string to an AnswerSpec and keeps every authority field from the itemSpec', () => {
    const r = composeExercise(numericSpec!, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exercise.answerSpec).toEqual({ kind: 'numeric', value: 19, tolerance: 0 });
    expect(r.exercise.skillId).toBe(numericSpec!.skillId);
    expect(r.exercise.knowledgeLevel).toBe(numericSpec!.knowledgeLevel);
    expect(r.exercise.bucket).toBe(numericSpec!.bucket);
    expect(r.exercise.origin).toBe('ai_generated');
  });

  it('fails a numeric item whose answer is not a number', () => {
    const r = composeExercise(numericSpec!, { ...base, answer: 'mười chín' });
    expect(r.ok).toBe(false);
  });

  it('fails when the hint ladder is not 6 non-empty rungs', () => {
    const r = composeExercise(numericSpec!, { ...base, hints: ['a', 'b'] });
    expect(r.ok).toBe(false);
  });
});

describe('doc 56 §4/§10 — orchestrateItemGeneration (mock, no network)', () => {
  const gen = createMockItemContentGenerator();

  it('MODE A (1 item/call): delivers a full worksheet, one model call per item', async () => {
    const spec = makeSpec();
    const r = await orchestrateItemGeneration({
      spec,
      generator: gen,
      referenceLibrary: lib,
      knowledgeBase: kb,
      config: { itemsPerCall: 1 },
    });
    expect(r.status).toBe('delivered');
    expect(r.acceptedCount).toBe(spec.generationPlan.totalQuestions);
    expect(r.batch.items).toHaveLength(spec.generationPlan.totalQuestions);
    expect(r.trace.totalModelCalls).toBe(spec.generationPlan.totalQuestions);
    for (const it of r.perItem) expect(it.accepted).toBe(true);
  });

  it('MODE B (2 items/call): delivers, ~half the calls', async () => {
    const spec = makeSpec();
    const r = await orchestrateItemGeneration({
      spec,
      generator: gen,
      referenceLibrary: lib,
      knowledgeBase: kb,
      config: { itemsPerCall: 2 },
    });
    expect(r.status).toBe('delivered');
    expect(r.trace.totalModelCalls).toBe(Math.ceil(spec.generationPlan.totalQuestions / 2));
  });

  it('every accepted item passes the full acceptance gate independently', async () => {
    const spec = makeSpec();
    const itemSpecs = buildItemGenerationSpecs(spec, kb);
    const r = await orchestrateItemGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    for (const ex of r.batch.items) {
      const is = itemSpecs.find((s) => s.itemId === ex.id)!;
      const siblings = r.batch.items.filter((o) => o.id !== ex.id).map((o) => ({ id: o.id, prompt: o.prompt }));
      const acc = acceptItem(ex, is, spec, kb, {
        references: lib.filter((l) => l.skillId === is.skillId).map((l) => ({ id: l.id, prompt: l.prompt })),
        acceptedSiblings: siblings,
      });
      expect(acc.accepted).toBe(true);
    }
  });

  it('is deterministic — same accepted prompts across two runs', async () => {
    const spec = makeSpec();
    const a = await orchestrateItemGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    const b = await orchestrateItemGeneration({ spec, generator: gen, referenceLibrary: lib, knowledgeBase: kb });
    expect(a.batch.items.map((i) => i.prompt)).toEqual(b.batch.items.map((i) => i.prompt));
  });

  it('a copy-happy generator is caught and the run recovers via the stronger fallback (good items kept)', async () => {
    const spec = makeSpec();
    const refPrompt = lib[0]!.prompt;
    // a generator that always returns a verbatim reference copy for item 1, valid content otherwise
    const copyGen: ItemContentGenerator = {
      name: 'copy-gen',
      provider: 'mock',
      model: 'copy',
      modelVersion: null,
      promptVersion: null,
      generate: (req) =>
        Promise.resolve({
          ok: true,
          latencyMs: 1,
          contents: req.problemDNAs.map((d) => ({
            itemId: d.itemId,
            prompt: d.itemId.endsWith('item-01') ? refPrompt : `Bể ${d.itemId} chứa 40 lít, mỗi phút chảy 3 lít, sau 6 phút còn bao nhiêu lít?`,
            answer: '22',
            hints: ['a', 'b', 'c', 'd', 'e', 'Lời giải: 22'],
            workedSolution: '40 - 3 × 6 = 22',
          })),
        }),
    };
    const r = await orchestrateItemGeneration({
      spec,
      generator: copyGen,
      fallbackGenerator: gen, // the good mock
      referenceLibrary: lib,
      knowledgeBase: kb,
      config: { itemsPerCall: 1, maxRetriesPerItem: 2, escalateAfterAttempts: 1 },
    });
    // item-01 either recovered via fallback or stayed out — never a copy in the batch
    for (const ex of r.batch.items) {
      const sim = checkItemSimilarity({
        prompt: ex.prompt,
        references: lib.filter((l) => l.skillId === ex.skillId).map((l) => ({ id: l.id, prompt: l.prompt })),
        worksheetSiblings: [],
      });
      expect(sim.verdict).not.toBe('COPY');
    }
    expect(r.acceptedCount).toBeGreaterThan(0);
  });
});
