import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildGenerationGrounding } from './grounding.js';
import { createMockExerciseGenerator } from './mock-generator.js';
import { validateGeneratedBatch } from './validator.js';
import { makeSpec } from './_spec-fixture.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();

describe('MockExerciseGenerator (doc 14 C4 §I)', () => {
  const spec = makeSpec();
  const grounding = buildGenerationGrounding(spec, lib, kb);

  it('produces a deliverable batch that passes the real validator', async () => {
    const r = await createMockExerciseGenerator().generate({ grounding });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = validateGeneratedBatch(r.batch, spec, kb);
    expect(v.deliverable, JSON.stringify(v.reasonCodes)).toBe(true);
    expect(r.batch.items).toHaveLength(spec.generationPlan.totalQuestions);
  });

  it('is deterministic and never calls the network', async () => {
    const a = await createMockExerciseGenerator({ seed: 1 }).generate({ grounding });
    const b = await createMockExerciseGenerator({ seed: 1 }).generate({ grounding });
    expect(a).toEqual(b);
  });

  it('§13 — does not copy a reference example prompt verbatim', async () => {
    const r = await createMockExerciseGenerator().generate({ grounding });
    if (!r.ok) return;
    const refPrompts = new Set(grounding.referenceExamples.map((e) => e.prompt));
    for (const it of r.batch.items) expect(refPrompts.has(it.prompt)).toBe(false);
  });

  it('keeps K/T within the grounding range and uses only target skills', async () => {
    const r = await createMockExerciseGenerator().generate({ grounding });
    if (!r.ok) return;
    const kLo = KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMin);
    const kHi = KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax);
    const tLo = THINKING_LEVELS.indexOf(spec.difficulty.tMin);
    const tHi = THINKING_LEVELS.indexOf(spec.difficulty.tMax);
    const targets = new Set(spec.targets.skillIds);
    for (const it of r.batch.items) {
      expect(KNOWLEDGE_LEVELS.indexOf(it.knowledgeLevel)).toBeGreaterThanOrEqual(kLo);
      expect(KNOWLEDGE_LEVELS.indexOf(it.knowledgeLevel)).toBeLessThanOrEqual(kHi);
      expect(THINKING_LEVELS.indexOf(it.thinkingLevel)).toBeGreaterThanOrEqual(tLo);
      expect(THINKING_LEVELS.indexOf(it.thinkingLevel)).toBeLessThanOrEqual(tHi);
      expect(targets.has(it.skillId)).toBe(true);
      for (const rs of it.requiredSkillIds) expect(kb.skills.has(rs)).toBe(true);
    }
  });

  it('returns a structured inability when the grounding has no target skills', async () => {
    const empty = { ...grounding, targetSkills: [] };
    const r = await createMockExerciseGenerator().generate({ grounding: empty });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.inability.reason).toBe('insufficient_grounding');
  });
});
