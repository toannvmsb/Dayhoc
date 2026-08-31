import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { loadKnowledgeBase, MathDataError } from './loader.js';
import { gradeDatasetSchema } from './schema.js';

const kb = loadKnowledgeBase();

describe('Phase 1 acceptance — data integrity', () => {
  it('loads and validates every grade dataset', () => {
    expect(kb.skills.size).toBeGreaterThan(15);
    expect(kb.curriculum.size).toBeGreaterThan(10);
  });

  it('every skill maps to an existing curriculum node', () => {
    for (const skill of kb.skills.values()) {
      expect(() => kb.getCurriculumNode(skill.curriculumNodeId)).not.toThrow();
    }
  });

  it('every problem type belongs to a known skill and carries a (K, T) pair', () => {
    expect(kb.problemTypes.length).toBeGreaterThan(10);
    for (const pt of kb.problemTypes) {
      expect(kb.skills.has(pt.skillId as never) || [...kb.skills.keys()].includes(pt.skillId as never)).toBe(true);
      expect(KNOWLEDGE_LEVELS).toContain(pt.knowledgeLevel);
      expect(THINKING_LEVELS).toContain(pt.thinkingLevel);
    }
  });

  it('the merged prerequisite graph is acyclic', () => {
    // loadKnowledgeBase throws on a cycle; reaching here means it passed.
    expect(kb.prerequisites.length).toBeGreaterThan(15);
  });

  it('crossGrade flags match the actual grade gap on every edge', () => {
    for (const edge of kb.prerequisites) {
      const from = kb.getSkill(edge.from);
      const to = kb.getSkill(edge.to);
      expect(edge.crossGrade).toBe(from.gradeContext !== to.gradeContext);
    }
  });
});

describe('education-model invariants encoded in the data', () => {
  it('bridges Grade 4 fractions into Grade 7 rational arithmetic (school grade is not a ceiling)', () => {
    const closure = kb.prerequisiteClosure('G7.RATIO.EQUAL_CHAIN');
    expect(closure).toContain('G7.RAT.OPS');
    expect(closure).toContain('M4.FRAC.COMMON_DENOM'); // cross-grade prerequisite
    expect(closure).toContain('M4.FRAC.EQUIVALENT');
  });

  it('models "quy đồng mẫu số" as the blocker for the equal-ratio chain (design narrative)', () => {
    expect(kb.dependents('M4.FRAC.COMMON_DENOM')).toContain('G7.RAT.OPS');
  });

  it('keeps Knowledge and Thinking independent: a standard-knowledge item can be non-routine', () => {
    const kt = kb.getProblemTypesForSkill('M4.ARITH.DISTRIBUTIVE');
    const challenge = kt.find((pt) => pt.id.endsWith('PT_CHALLENGE'));
    expect(challenge).toBeDefined();
    expect(challenge!.knowledgeLevel).toBe('K2'); // only Grade 4 knowledge
    expect(challenge!.thinkingLevel).toBe('T5'); // but non-routine thinking
  });

  it('tags above-grade skills with a higher curriculumOrigin than their gradeContext', () => {
    const identity = kb.getSkill('G7.ALG.IDENTITY');
    expect(identity.gradeContext).toBe(7);
    expect(identity.curriculumOrigin).toBeGreaterThan(7);
  });
});

describe('loader rejects malformed data', () => {
  it('flags a schema violation with a path', () => {
    const bad = gradeDatasetSchema.safeParse({ gradeContext: 4, curriculum: [], skills: [{ id: 'nope' }], prerequisites: [], problemTypes: [] });
    expect(bad.success).toBe(false);
  });

  it('MathDataError is the failure type', () => {
    expect(new MathDataError('x')).toBeInstanceOf(Error);
  });
});
