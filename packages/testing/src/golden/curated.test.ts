import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import {
  classifyErrorSignature,
  computeReadiness,
  DEFAULT_GAP_CONFIG,
  runGapEngine,
} from '@copilot/gap-engine';
import { KB } from '../harness.js';
import { loadCuratedScenarios } from './load.js';

/**
 * The 15 curated high-value diagnosis scenarios (Golden Error Dataset).
 * These are the "hard cases" — each pins a distinct engine behaviour.
 */
const childId = asChildId('curated_child');
const asOf = new Date('2026-08-31T09:00:00Z');

function ev(skillId: string, correct: boolean, daysAgo: number, extra: Partial<Evidence> = {}): Evidence {
  const occurredAt = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${skillId}_${daysAgo}` as Evidence['id'],
    childId,
    source: 'app_practice',
    occurredAt,
    recordedAt: occurredAt,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...extra,
  };
}
const twin = (evidence: Evidence[], grade: 4 | 7 = 7) =>
  buildLearningTwin({ childId, gradeContext: grade, evidence, knowledgeBase: KB, asOf });

describe('Golden curated scenarios', () => {
  it('loads all 15 curated scenarios', () => {
    expect(loadCuratedScenarios()).toHaveLength(15);
  });

  it('ERR-S01 — careless ≠ knowledge gap', () => {
    const r = classifyErrorSignature({
      errorSignature: 'careless_error',
      skillId: asSkillId('M4.FRAC.SIMPLIFY'),
      twin: twin([ev('M4.FRAC.SIMPLIFY', true, 12, { confidenceTier: 'A' }), ev('M4.FRAC.SIMPLIFY', false, 2)], 4),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
      corroboratingObservations: 0,
    });
    expect(r.gapType).toBe('careless_error');
    expect(r.masteryUpdate).toBe('minimal_provisional');
    expect(r.confidence).toBe('low');
  });

  it('ERR-S03 — parent observation only → hypothesis, not a confirmed gap', () => {
    const evidence = [
      ev('M4.FRAC.COMMON_DENOM', true, 20, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', false, 2, { source: 'parent_feedback', provenance: 'parent', confidenceTier: 'D' }),
    ];
    const t = twin(evidence, 4);
    const gaps = runGapEngine({ childId, gradeContext: 4, twin: t, evidence, knowledgeBase: KB, asOf });
    for (const g of gaps.gaps) expect(g.lifecycleState).toBe('DETECTED'); // never auto-confirmed
    expect(t.skillMastery.get('M4.FRAC.COMMON_DENOM' as never)!.mastery).toBeGreaterThan(45); // not tanked
  });

  it('ERR-S05 — G7 standard algebra strong, a T5 item fails → reasoning gap, knowledge preserved', () => {
    const evidence = [
      ev('M7.ALG.IDENTITY', true, 18, { confidenceTier: 'A' }),
      ev('M7.ALG.IDENTITY', true, 12, { confidenceTier: 'A' }),
      ev('M7.ALG.IDENTITY', true, 7),
      ev('M7.ALG.IDENTITY', false, 2),
    ];
    const r = classifyErrorSignature({
      errorSignature: 'thinking_strategy_failure',
      skillId: asSkillId('M7.ALG.IDENTITY'),
      thinkingLevel: 'T5',
      twin: twin(evidence),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
      corroboratingObservations: 1,
    });
    expect(r.gapType).toBe('reasoning_gap');
  });

  it('ERR-S06 — above-grade failure does not downgrade grade-7 mastery', () => {
    const evidence = [
      ev('M7.ALG.SYMMETRIC', false, 6), // origin 9, HSG
      ev('M7.ALG.SYMMETRIC', false, 2),
      ev('M7.ALG.POLY_MUL', true, 10, { confidenceTier: 'A' }), // standard grade-7 stays strong
    ];
    const t = twin(evidence);
    // standard grade-7 algebra mastery is NOT downgraded by the HSG failure
    expect(t.skillMastery.get('M7.ALG.POLY_MUL' as never)!.mastery).toBeGreaterThan(70);
    // the HSG skill is tracked separately and low — no traction yet, not "weak grade 7"
    expect(t.skillMastery.get('M7.ALG.SYMMETRIC' as never)!.mastery).toBeLessThan(40);
    // frontier is per-domain, never a single global grade level
    expect(t).not.toHaveProperty('level');
    expect(t).not.toHaveProperty('grade');
    const frontier = t.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    expect(frontier.frontierLabel).toMatch(/^(grade_7|above_grade)/); // skill-specific, not global
  });

  it('ERR-S07 — parallel gap repair: keep the advanced path when the prereq is only moderately weak', () => {
    const evidence = [
      ev('M7.RATIO.EQUAL_CHAIN', true, 10, { confidenceTier: 'A' }),
      ev('M7.RATIO.EQUAL_CHAIN', true, 4),
      ev('M7.ALG.POLY_MUL', true, 12),
      ev('M7.ALG.POLY_MUL', false, 3), // moderate dip, not critical
    ];
    const r = computeReadiness(childId, asSkillId('M7.RATIO.MULTIVAR'), twin(evidence), KB, DEFAULT_GAP_CONFIG);
    expect(['ready', 'parallel_repair']).toContain(r.recommendation);
  });

  it('ERR-S08 — hint dependence lowers independent-mastery confidence', () => {
    const propped = twin(
      Array.from({ length: 4 }, (_, i) => ev('M4.FRAC.ADD', true, 8 - i, { hintDependency: 0.9 })),
      4,
    ).skillMastery.get('M4.FRAC.ADD' as never)!;
    const independent = twin(
      Array.from({ length: 4 }, (_, i) => ev('M4.FRAC.ADD', true, 8 - i, { hintDependency: 0 })),
      4,
    ).skillMastery.get('M4.FRAC.ADD' as never)!;
    expect(independent.mastery).toBeGreaterThan(propped.mastery + 15);
  });

  it('ERR-S09 — retention failure reopens a monitored gap', () => {
    const r = classifyErrorSignature({
      errorSignature: 'conversion_factor_error', // dataset maps this to retention_gap
      skillId: asSkillId('M4.MEAS.CONVERSION'),
      twin: twin([ev('M4.MEAS.CONVERSION', true, 60, { confidenceTier: 'A' }), ev('M4.MEAS.CONVERSION', false, 2)], 4),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
    });
    expect(r.gapType).toBe('retention_gap');
  });

  it('ERR-S10 — presentation-only error carries minimal knowledge penalty', () => {
    const r = classifyErrorSignature({
      errorSignature: 'careless_unit_error',
      skillId: asSkillId('M4.MEAS.MASS'),
      twin: twin([ev('M4.MEAS.MASS', true, 10), ev('M4.MEAS.MASS', false, 2)], 4),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
    });
    expect(r.gapType).toBe('presentation_error');
    expect(r.masteryUpdate).toBe('minimal_provisional');
  });
});
