import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildGenerationGrounding, GROUNDING_SCHEMA_NAME } from './grounding.js';
import { makeSpec, PREREQ, SKILL } from './_spec-fixture.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();

describe('buildGenerationGrounding (doc 14 C4 §H)', () => {
  const spec = makeSpec();
  const g = buildGenerationGrounding(spec, lib, kb);

  it('is deterministic and carries a stable hash', () => {
    const again = buildGenerationGrounding(spec, lib, kb);
    expect(again).toEqual(g);
    expect(g.groundingHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('§12 — contains ONLY the target skills, their problem types, prereq context, K/T semantics, schema', () => {
    expect(g.targetSkills.map((s) => s.skillId).sort()).toEqual([SKILL, PREREQ].sort());
    for (const ts of g.targetSkills) {
      expect(kb.skills.has(ts.skillId)).toBe(true);
      for (const pt of ts.problemTypes) expect(kb.getProblemTypesForSkill(ts.skillId).some((p) => p.id === pt.id)).toBe(true);
    }
    expect(Object.keys(g.knowledgeLevels)).toContain('K2');
    expect(Object.keys(g.thinkingLevels)).toContain('T4');
    expect(g.outputSchemaName).toBe(GROUNDING_SCHEMA_NAME);
    expect(g.plan).toEqual(spec.generationPlan);
    expect(g.difficulty).toEqual(spec.difficulty);
  });

  it('§11 — carries NO child PII / twin / learning history', () => {
    const json = JSON.stringify(g);
    expect(json).not.toContain('c4_child'); // childId
    expect(g).not.toHaveProperty('childId');
    expect(g).not.toHaveProperty('twin');
    expect(g).not.toHaveProperty('relevantMastery');
    expect(g).not.toHaveProperty('evidence');
    // it DOES carry the pseudonymous spec id for correlation
    expect(g.generationSpecId).toBe(spec.generationSpecId);
  });

  it('§13 — reference examples are grounding metadata only (prompt text, no full item to copy)', () => {
    for (const ex of g.referenceExamples) {
      expect(kb.skills.has(ex.skillId)).toBe(true);
      expect(ex).not.toHaveProperty('workedSolution');
      expect(ex).not.toHaveProperty('hints');
      expect(ex).not.toHaveProperty('answerSpec');
      expect(typeof ex.hintRungs).toBe('number');
    }
    expect(g.referenceExamples.length).toBeLessThanOrEqual(3 * spec.targets.skillIds.length);
  });

  it('marks blocking prerequisites + unsupported above-grade skills as forbidden-required', () => {
    const blocked = makeSpec({
      childState: {
        ...makeSpec().childState,
        prerequisiteGaps: [{ skillId: PREREQ as never, severity: 0.8, blocking: true }],
      },
    });
    const gb = buildGenerationGrounding(blocked, lib, kb);
    expect(gb.forbiddenRequiredSkillIds).toContain(PREREQ);
    // an above-grade algebra skill is forbidden when the frontier does not support it
    expect(gb.forbiddenRequiredSkillIds).toContain('M7.ALG.SYMMETRIC');
  });
});
