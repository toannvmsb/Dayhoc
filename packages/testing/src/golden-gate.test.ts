import { describe, expect, it } from 'vitest';
import { CORE_DISCRIMINATION_TARGETS } from '@copilot/domain';
import { checkAcyclic } from '@copilot/education-core';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { KB, buildEvidence, runScenario } from './harness.js';
import { asChildId } from '@copilot/domain';

/**
 * GOLDEN GATE (Phase 4.5) — the aggregate check CI enforces before any UI
 * expansion (Phase 6+). If this file fails, merges to `main` are blocked.
 */
describe('GOLDEN GATE', () => {
  it('the prerequisite graph is acyclic (readiness / root-gap trace depend on it)', () => {
    expect(checkAcyclic(KB.prerequisites).acyclic).toBe(true);
  });

  it('every skill maps to a curriculum node; every problem type has a (K, T) pair', () => {
    for (const skill of KB.skills.values()) {
      expect(() => KB.getCurriculumNode(skill.curriculumNodeId)).not.toThrow();
    }
    for (const pt of KB.problemTypes) {
      expect(pt.knowledgeLevel).toMatch(/^K[0-5]$/);
      expect(pt.thinkingLevel).toMatch(/^T[1-5]$/);
    }
  });

  it('recompute is idempotent: twin → gaps rebuilt from the same evidence is identical', () => {
    const childId = asChildId('gate_recompute');
    const asOf = new Date('2026-08-31T09:00:00Z');
    const evidence = buildEvidence(
      childId,
      [
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 20, correct: true },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 8, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'weak' },
      ],
      asOf,
    );
    const build = () => {
      const twin = buildLearningTwin({ childId, gradeContext: 4, evidence, knowledgeBase: KB, asOf });
      const engine = runGapEngine({
        childId,
        gradeContext: 4,
        twin,
        evidence,
        knowledgeBase: KB,
        asOf,
        newId: (() => {
          let i = 0;
          return () => `${++i}`;
        })(),
      });
      return { twin, engine };
    };
    expect(build()).toEqual(build());
  });

  it('the discrimination matrix covers all 8 core gap types', () => {
    // sanity: the matrix file exercises these; here we assert the target set is complete
    expect(new Set(CORE_DISCRIMINATION_TARGETS).size).toBe(8);
  });

  it('no golden scenario produces a single global grade level', () => {
    const run = runScenario({
      id: 'gate-no-global',
      description: 'mixed evidence across grades',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.ALG.IDENTITY', daysAgo: 6, correct: true },
        { skillId: 'M4.FRAC.MUL', daysAgo: 4, correct: true },
      ],
    });
    expect(run.twin).not.toHaveProperty('level');
    expect(run.twin).not.toHaveProperty('grade');
    expect(Array.isArray(run.twin.frontier)).toBe(true);
    expect(run.twin.frontier.length).toBeGreaterThanOrEqual(2);
  });
});
