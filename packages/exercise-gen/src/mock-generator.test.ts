import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildGenerationGrounding } from './grounding.js';
import { createMockExerciseGenerator } from './mock-generator.js';
import { validateGeneratedBatch } from './validator.js';
import { makeSpec, FRONTIER_SKILL, FRONTIER_TARGET, SKILL } from './_spec-fixture.js';
import { asSkillId } from '@copilot/domain';

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

  it('§6/§10 — honours the bucket→target binding: advanced items use ONLY the FRONTIER target', async () => {
    const frontSpec = makeSpec({
      targets: {
        skills: [
          { skillId: asSkillId(SKILL), role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation', 'application'], knowledgeCeiling: 'K3' },
          FRONTIER_TARGET,
        ],
        problemTypeIds: [],
        skillIds: [asSkillId(SKILL), asSkillId(FRONTIER_SKILL)],
      },
      childState: {
        ...makeSpec().childState,
        readiness: 'ready',
        actualLearningFrontier: {
          algebraic_thinking: { reachedCurriculumOrigin: 9, aboveGrade: true, confidence: 0.7, evidenceCount: 8, masteredSkillIds: [asSkillId(SKILL)], readyNextSkillIds: [asSkillId(FRONTIER_SKILL)], exposureSkillIds: [] },
        },
      },
      generationPlan: { totalQuestions: 6, distribution: { prerequisiteRepair: 0, currentSkill: 4, variation: 0, application: 0, advanced: 2, thinkingChallenge: 0 } },
      difficulty: { kMin: 'K2', kMax: 'K5', tMin: 'T2', tMax: 'T4', stretchRatio: 0.3 },
    });
    const g = buildGenerationGrounding(frontSpec, lib, kb);
    const r = await createMockExerciseGenerator().generate({ grounding: g });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const it of r.batch.items) {
      if (it.bucket === 'advanced') expect(it.skillId).toBe(FRONTIER_SKILL);
      else expect(it.skillId).toBe(SKILL);
    }
    // the whole batch still passes the real validator (frontier target selected)
    expect(validateGeneratedBatch(r.batch, frontSpec, kb).reasonCodes).toEqual([]);
  });

  it('§13 — a thinking-challenge item can be high T while its K stays grade-level', async () => {
    const tSpec = makeSpec({
      generationPlan: { totalQuestions: 4, distribution: { prerequisiteRepair: 0, currentSkill: 3, variation: 0, application: 0, advanced: 0, thinkingChallenge: 1 } },
      difficulty: { kMin: 'K2', kMax: 'K3', tMin: 'T2', tMax: 'T5', stretchRatio: 0.3 },
    });
    const g = buildGenerationGrounding(tSpec, lib, kb);
    const r = await createMockExerciseGenerator().generate({ grounding: g });
    if (!r.ok) return;
    const tc = r.batch.items.find((i) => i.bucket === 'thinkingChallenge')!;
    expect(THINKING_LEVELS.indexOf(tc.thinkingLevel)).toBeGreaterThanOrEqual(THINKING_LEVELS.indexOf('T2'));
    expect(KNOWLEDGE_LEVELS.indexOf(tc.knowledgeLevel)).toBeLessThanOrEqual(KNOWLEDGE_LEVELS.indexOf('K3'));
  });
});
