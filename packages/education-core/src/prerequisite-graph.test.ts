import { describe, expect, it } from 'vitest';
import { asSkillId } from '@copilot/domain';
import { checkAcyclic, type PrerequisiteEdge } from './prerequisite-graph.js';

const edge = (from: string, to: string, crossGrade = false): PrerequisiteEdge => ({
  from: asSkillId(from),
  to: asSkillId(to),
  importance: 1,
  crossGrade,
});

describe('prerequisite DAG invariant', () => {
  it('accepts an acyclic cross-grade chain (G4 → … → G9)', () => {
    const report = checkAcyclic([
      edge('M4.FRAC.EQUIVALENT', 'M4.FRAC.COMMON_DENOM'),
      edge('M4.FRAC.COMMON_DENOM', 'G7.RAT', true),
      edge('G7.RAT', 'G7.ALG.IDENTITY', true),
    ]);
    expect(report.acyclic).toBe(true);
  });

  it('detects a cycle and reports the offending path', () => {
    const report = checkAcyclic([
      edge('A', 'B'),
      edge('B', 'C'),
      edge('C', 'A'),
    ]);
    expect(report.acyclic).toBe(false);
    expect(report.cycle).toBeDefined();
    expect(report.cycle!.length).toBeGreaterThan(0);
  });

  it('treats an empty graph as acyclic', () => {
    expect(checkAcyclic([]).acyclic).toBe(true);
  });
});
