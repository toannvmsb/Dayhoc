import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { loadKnowledgeBase, MathDataError } from './loader.js';
import { gradeDatasetSchema } from './schema.js';

const kb = loadKnowledgeBase();

describe('Math Dev Core v1.0 — data integrity', () => {
  it('loads all Grade 4 + Grade 7 skills (52 + 37 standard + 5 above-grade families)', () => {
    expect(kb.skills.size).toBe(94);
    expect([...kb.skills.values()].filter((s) => s.gradeContext === 4)).toHaveLength(52);
    expect([...kb.skills.values()].filter((s) => s.gradeContext === 7)).toHaveLength(42);
    expect(kb.curriculum.size).toBeGreaterThan(100);
  });

  it('marks the 5 above-grade Grade 7 skill families with curriculumOrigin > 7', () => {
    const aboveGrade = [...kb.skills.values()].filter((s) => s.gradeContext === 7 && s.curriculumOrigin > 7);
    expect(aboveGrade).toHaveLength(5);
    expect(aboveGrade.map((s) => s.id)).toContain('M7.ALG.IDENTITY');
  });

  it('every skill maps to an existing curriculum node', () => {
    for (const skill of kb.skills.values()) {
      expect(() => kb.getCurriculumNode(skill.curriculumNodeId)).not.toThrow();
    }
  });

  it('every problem type belongs to a known skill and carries a (K, T) pair', () => {
    expect(kb.problemTypes.length).toBeGreaterThan(50);
    for (const pt of kb.problemTypes) {
      expect(kb.skills.has(pt.skillId as never)).toBe(true);
      expect(KNOWLEDGE_LEVELS).toContain(pt.knowledgeLevel);
      expect(THINKING_LEVELS).toContain(pt.thinkingLevel);
    }
  });

  it('the merged prerequisite graph is acyclic (loader throws on a cycle)', () => {
    expect(kb.prerequisites.length).toBeGreaterThan(40);
  });

  it('crossGrade flags match the actual grade gap on every edge', () => {
    for (const edge of kb.prerequisites) {
      const from = kb.getSkill(edge.from);
      const to = kb.getSkill(edge.to);
      expect(edge.crossGrade).toBe(from.gradeContext !== to.gradeContext);
    }
  });

  it('exposes provenance — a human revision tag and a deterministic content hash (doc 14 C3.1 §D)', () => {
    const p = kb.provenance;
    expect(p.datasetRevision).toBe('math-dev-core-1.0');
    expect(p.source).toBe('math-dev-core');
    expect(p.contentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(p.skillCount).toBe(kb.skills.size);
    expect(p.prerequisiteCount).toBe(kb.prerequisites.length);
    // stable across reloads (cache) and deterministic
    expect(loadKnowledgeBase().provenance.contentHash).toBe(p.contentHash);
  });
});

describe('education-model invariants encoded in the data', () => {
  it('bridges Grade 4 fractions into Grade 7 rational arithmetic (school grade is not a ceiling)', () => {
    const closure = kb.prerequisiteClosure('M7.RATIO.EQUAL_CHAIN');
    expect(closure).toContain('M7.RATIO.PROPORTION');
    expect(closure).toContain('M4.FRAC.EQUIVALENT'); // cross-grade bridge (data/bridges.yaml)
  });

  it('models a cross-grade bridge from M4.FRAC.COMMON_DENOM into Grade 7', () => {
    expect(kb.dependents('M4.FRAC.COMMON_DENOM')).toContain('M7.QNUM.OPERATIONS');
  });

  it('keeps Knowledge and Thinking independent: problem types vary on both axes', () => {
    const ks = new Set(kb.problemTypes.map((p) => p.knowledgeLevel));
    const ts = new Set(kb.problemTypes.map((p) => p.thinkingLevel));
    expect(ks.size).toBeGreaterThan(1);
    expect(ts.size).toBeGreaterThan(1);
  });
});

describe('loader rejects malformed data', () => {
  it('flags a schema violation with a path', () => {
    const bad = gradeDatasetSchema.safeParse({
      gradeContext: 4,
      curriculum: [],
      skills: [{ id: 'nope' }],
      prerequisites: [],
      problemTypes: [],
    });
    expect(bad.success).toBe(false);
  });

  it('MathDataError is the failure type', () => {
    expect(new MathDataError('x')).toBeInstanceOf(Error);
  });
});
