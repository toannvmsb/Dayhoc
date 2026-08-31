import { describe, expect, it } from 'vitest';
import { KB, runScenario } from './harness.js';

const skillOrigin = (skillId: string): number => KB.getSkill(skillId).curriculumOrigin;

/**
 * GOLDEN REGISTRY (Golden Test Plan §2) — the GT-G4-* / GT-G7-* educational cases.
 *
 * These run the full deterministic pipeline and gate UI expansion (Phase 4.5).
 * Cases that need curriculum domains outside the current data slice (Pending
 * D-01) are `it.todo` and listed in docs/implementation/PENDING_APPROVAL.md §C.
 */

describe('Golden registry — Grade 4', () => {
  it('GT-G4-01 · standard student: occasional slips are not over-diagnosed', () => {
    const { engine } = runScenario({
      id: 'gt-g4-01',
      description: 'On textbook pace, mostly correct with a couple of arithmetic slips',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 24, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 16, correct: true },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 12, correct: true },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 8, correct: true },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'strong', hintDependency: 0 },
      ],
    });
    // no high-severity gap; at most a careless flag with no remediation
    expect(engine.gaps.every((g) => g.type === 'careless_error' || g.score.band === 'low')).toBe(true);
    expect(engine.prescriptions).toHaveLength(0);
  });

  it('GT-G4-03 · good knowledge, careless errors: keep the advanced path', () => {
    const { engine, twin } = runScenario({
      id: 'gt-g4-03',
      description: 'Strong simplify, isolated careless slip',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 20, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 14, correct: true },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 8, correct: true },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 2, correct: false, reasoningQuality: 'strong', hintDependency: 0 },
      ],
    });
    expect(engine.gaps[0]?.type).toBe('careless_error');
    expect(engine.prescriptions).toHaveLength(0);
    expect(twin.skillMastery.get('M4.FRAC.SIMPLIFY' as never)!.mastery).toBeGreaterThan(60);
  });

  it('GT-G4-04 · advanced student: solid across the board, no remediation', () => {
    const { engine } = runScenario({
      id: 'gt-g4-04',
      description: 'Consistently correct across the fraction chain and distributive',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 25, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 18, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 10, correct: true },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 12, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT4' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 4, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT4' },
      ],
    });
    expect(engine.prescriptions).toHaveLength(0);
    expect(engine.gaps).toHaveLength(0);
  });

  it('GT-G4-05 · parent reports weakness, evidence thin: hypothesis, not a hard penalty', () => {
    const { engine, twin } = runScenario({
      id: 'gt-g4-05',
      description: 'Only a low-confidence parent observation of difficulty',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 20, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 2, correct: false, confidenceTier: 'D', source: 'parent_feedback', provenance: 'parent' },
      ],
    });
    // mastery is not tanked by one low-confidence signal
    expect(twin.skillMastery.get('M4.FRAC.COMMON_DENOM' as never)!.mastery).toBeGreaterThan(45);
    // any gap raised is only DETECTED (a hypothesis), never auto-confirmed
    for (const g of engine.gaps) expect(g.lifecycleState).toBe('DETECTED');
  });

  it('GT-G4-06 · test reveals a prerequisite root gap; unrelated strengths untouched', () => {
    const { engine, twin } = runScenario({
      id: 'gt-g4-06',
      description: 'Common-denominator fails; equivalent fractions is the weak root',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.MUL', daysAgo: 15, correct: true, confidenceTier: 'A' }, // unrelated strength
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 12, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 6, correct: false },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 8, correct: false, source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 4, correct: false, source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
      ],
    });
    const top = engine.gaps[0]!;
    expect(top.type).toBe('prerequisite_gap');
    expect(top.rootSkillId).toBe('M4.FRAC.EQUIVALENT');
    expect(engine.prescriptions[0]!.rootGapLabel).toContain('bằng nhau');
    // an unrelated skill keeps its mastery
    expect(twin.skillMastery.get('M4.FRAC.MUL' as never)!.mastery).toBeGreaterThan(60);
  });

  it.todo('GT-G4-02 · strong arithmetic, weak word problems (needs full word-problem data — D-01)');
  it.todo('GT-G4-07 · upcoming exam → revision mode (Phase 9)');
  it.todo('GT-G4-08 · mixed-level profile across domains (needs Geometry/Logic data — D-01)');
});

describe('Golden registry — Grade 7 (cross-grade)', () => {
  it('GT-G7-02 · 15/8 ratio chain: progression is tracked skill-by-skill', () => {
    const { twin } = runScenario({
      id: 'gt-g7-02',
      description: 'Direct proportion → equal ratio → chain, improving over time',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.RATIO.PROPORTION', daysAgo: 24, correct: true, confidenceTier: 'A' },
        { skillId: 'G7.RATIO.EQUAL_RATIO', daysAgo: 16, correct: true },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 8, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 3, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
      ],
    });
    expect(twin.skillMastery.has('G7.RATIO.PROPORTION' as never)).toBe(true);
    expect(twin.skillMastery.has('G7.RATIO.EQUAL_CHAIN' as never)).toBe(true);
    // distinct per-skill mastery, not one merged "ratio" score
    expect(twin.skillMastery.size).toBeGreaterThanOrEqual(3);
  });

  it('GT-G7-03 · ratio + xyz is mapped to the multivariable skill, not "simple proportion"', () => {
    const { twin } = runScenario({
      id: 'gt-g7-03',
      description: 'Work on x/a=y/b=z/c with a linear constraint',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.MULTIVAR.XYZ', daysAgo: 10, correct: true, problemTypeId: 'G7.MULTIVAR.XYZ.PT1' },
        { skillId: 'G7.MULTIVAR.XYZ', daysAgo: 4, correct: false, problemTypeId: 'G7.MULTIVAR.XYZ.PT1' },
      ],
    });
    expect(twin.skillMastery.has('G7.MULTIVAR.XYZ' as never)).toBe(true);
    expect(twin.problemTypeMastery.has('G7.MULTIVAR.XYZ.PT1' as never)).toBe(true);
  });

  it('GT-G7-08 · HSG Grade 9 source: school grade stays 7; readiness governs', () => {
    const { twin, engine } = runScenario({
      id: 'gt-g7-08',
      description: 'Child (grade 7) exposed to symmetric-algebra HSG material (origin 9)',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.ALG.IDENTITY', daysAgo: 20, correct: true, confidenceTier: 'A' },
        { skillId: 'G7.SYM.BASIC', daysAgo: 10, correct: true, problemTypeId: 'G7.SYM.BASIC.PT_RECALL' },
        { skillId: 'G7.SYM.BASIC', daysAgo: 4, correct: false, problemTypeId: 'G7.SYM.BASIC.PT1' },
      ],
    });
    expect(skillOrigin('G7.SYM.BASIC')).toBe(9);
    const algebra = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    expect(algebra.aboveGrade).toBe(true);
    expect(algebra.frontierLabel).toContain('above_grade');
    // the engine reasons via readiness/prereq, it does not just block on "grade 9"
    expect(engine.readiness.every((r) => ['ready', 'parallel_repair', 'repair_first'].includes(r.recommendation))).toBe(true);
  });

  it('GT-G7-09 · failure caused by a prerequisite is diagnosed at the root', () => {
    const { engine } = runScenario({
      id: 'gt-g7-09',
      description: 'Ratio work fails; rational-number operations are the weak root',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.RAT.OPS', daysAgo: 16, correct: false, reasoningQuality: 'weak' },
        { skillId: 'G7.RAT.OPS', daysAgo: 9, correct: false, reasoningQuality: 'weak' },
        { skillId: 'G7.RAT.OPS', daysAgo: 3, correct: false },
        { skillId: 'G7.RATIO.PROPORTION', daysAgo: 11, correct: false, reasoningQuality: 'weak' },
        { skillId: 'G7.RATIO.PROPORTION', daysAgo: 4, correct: false },
        { skillId: 'G7.RATIO.EQUAL_RATIO', daysAgo: 6, correct: false },
        { skillId: 'G7.RATIO.EQUAL_RATIO', daysAgo: 2, correct: false },
      ],
    });
    // Every gap in the chain traces to the true root; downstream skills are
    // flagged as prerequisite gaps, the root itself as a concept gap.
    expect(engine.gaps.every((g) => g.rootSkillId === 'G7.RAT.OPS')).toBe(true);
    expect(engine.gaps.some((g) => g.type === 'prerequisite_gap')).toBe(true);
    expect(engine.prescriptions.some((p) => p.rootGapLabel.includes('hữu tỉ'))).toBe(true);
  });

  it('GT-G7-10 · failure caused by thinking: knowledge mastery stays strong', () => {
    const { engine, twin } = runScenario({
      id: 'gt-g7-10',
      description: 'Routine equal-ratio items solid; the non-routine item fails',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 22, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1', confidenceTier: 'A' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 16, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1', confidenceTier: 'A' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 11, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 6, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 2, correct: false, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT_HSG' },
      ],
    });
    expect(engine.gaps[0]?.type).toBe('reasoning_gap');
    expect(twin.skillMastery.get('G7.RATIO.EQUAL_CHAIN' as never)!.mastery).toBeGreaterThan(65);
  });

  it.todo('GT-G7-01 · 13/8 mixed review across %, geometry, combinatorics (needs data — D-01)');
  it.todo('GT-G7-04 · ratio + quadratic condition (needs deeper problem-type data — D-01)');
  it.todo('GT-G7-05 · identity from a+b and ab (needs symmetric-algebra problem types — D-01)');
  it.todo('GT-G7-06 · x + 1/x higher powers (needs data — D-01)');
  it.todo('GT-G7-07 · factorization classification (needs factorization data — D-01)');
});
