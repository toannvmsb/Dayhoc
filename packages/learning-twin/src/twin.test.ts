import { describe, expect, it } from 'vitest';
import { asChildId, asProblemTypeId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from './twin.js';
import { recomputeTwin } from './recompute.js';

const kb = loadKnowledgeBase();
const childId = asChildId('child_minh_anh');
const asOf = new Date('2026-08-31T09:00:00Z');

let seq = 0;
function ev(p: {
  skillId: string;
  daysAgo: number;
  correct?: boolean;
  score?: number;
  hintDependency?: number;
  reasoningQuality?: Evidence['reasoningQuality'];
  problemTypeId?: string;
  confidenceTier?: Evidence['confidenceTier'];
}): Evidence {
  const occurredAt = new Date(asOf.getTime() - p.daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${String(++seq).padStart(4, '0')}`,
    childId,
    source: 'app_practice',
    occurredAt,
    recordedAt: occurredAt,
    skillId: asSkillId(p.skillId),
    ...(p.problemTypeId ? { problemTypeId: asProblemTypeId(p.problemTypeId) } : {}),
    result: {
      ...(p.correct !== undefined ? { correct: p.correct } : {}),
      ...(p.score !== undefined ? { score: p.score } : {}),
    },
    ...(p.reasoningQuality ? { reasoningQuality: p.reasoningQuality } : {}),
    ...(p.hintDependency !== undefined ? { hintDependency: p.hintDependency } : {}),
    confidenceTier: p.confidenceTier ?? 'B',
    provenance: 'manual',
  };
}

const build = (evidence: readonly Evidence[]) =>
  buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: kb, asOf });

describe('buildLearningTwin — Phase 3 acceptance', () => {
  it('recompute is idempotent: same evidence → identical twin', () => {
    const evidence = [
      ev({ skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 10, correct: true }),
      ev({ skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 5, correct: false, reasoningQuality: 'weak', hintDependency: 0.8 }),
      ev({ skillId: 'M7.RATIO.PROPORTION', daysAgo: 2, correct: true, problemTypeId: 'M7.PT.RATIO.EQUAL_RATIO' }),
    ];
    const a = build(evidence);
    const b = build([...evidence].reverse()); // order of input must not matter
    expect(a.skillMastery).toEqual(b.skillMastery);
    expect(a.problemTypeMastery).toEqual(b.problemTypeMastery);
    expect(a.thinkingProfile).toEqual(b.thinkingProfile);
    expect(a.frontier).toEqual(b.frontier);
    expect(a.computedFromEvidenceCount).toBe(3);
  });

  it('a careless slip (wrong + strong reasoning, no hints) barely moves mastery', () => {
    const priors = Array.from({ length: 4 }, (_, i) =>
      ev({ skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 20 - i * 2, correct: true }),
    );
    const withSlip = build([
      ...priors,
      ev({ skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 1, correct: false, reasoningQuality: 'strong', hintDependency: 0 }),
    ]);
    const withRealGap = build([
      ...priors,
      ev({ skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 1, correct: false, reasoningQuality: 'weak', hintDependency: 0.9 }),
    ]);
    const baseline = build(priors).skillMastery.get(asSkillId('M4.FRAC.SIMPLIFY'))!.mastery;
    const slip = withSlip.skillMastery.get(asSkillId('M4.FRAC.SIMPLIFY'))!.mastery;
    const gap = withRealGap.skillMastery.get(asSkillId('M4.FRAC.SIMPLIFY'))!.mastery;

    expect(baseline - slip).toBeLessThan(15); // cushioned
    expect(baseline - gap).toBeGreaterThan(baseline - slip); // real gap hurts more
  });

  it('keeps the three axes separate', () => {
    const twin = build([
      ev({ skillId: 'M7.ALG.IDENTITY', daysAgo: 3, correct: true, problemTypeId: 'M7.PT.ALG_IDENTITY.SYMMETRIC_EXPRESSION' }),
      ev({ skillId: 'M4.FRAC.MUL', daysAgo: 3, correct: true }), // no problemTypeId
    ]);
    expect(twin.skillMastery.has(asSkillId('M7.ALG.IDENTITY'))).toBe(true);
    expect(twin.skillMastery.has(asSkillId('M4.FRAC.MUL'))).toBe(true);
    // problem-type mastery only for the item that carried a problemTypeId
    expect([...twin.problemTypeMastery.keys()]).toEqual([asProblemTypeId('M7.PT.ALG_IDENTITY.SYMMETRIC_EXPRESSION')]);
    // thinking profile populated from M7.ALG.IDENTITY's dimensions, independent of skill map
    expect(twin.thinkingProfile.size).toBeGreaterThan(0);
    expect(twin.thinkingProfile.has('algebraic_thinking')).toBe(true);
  });

  it('produces a per-domain frontier and never a single global level', () => {
    const twin = build([
      ev({ skillId: 'M7.ALG.IDENTITY', daysAgo: 4, correct: true }), // origin 8 → above grade 7
      ev({ skillId: 'M7.ALG.IDENTITY', daysAgo: 2, correct: true }),
      ev({ skillId: 'M7.RAT.OPERATIONS', daysAgo: 3, correct: true }), // origin 7
    ]);
    expect(twin).not.toHaveProperty('level');
    const algebra = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    const arithmetic = twin.frontier.find((f) => f.domain === 'arithmetic')!;
    expect(algebra.aboveGrade).toBe(true);
    expect(algebra.frontierLabel).toBe('above_grade_G8_exposure');
    expect(arithmetic.aboveGrade).toBe(false);
  });

  it('hint dependency erodes the credit for correct answers', () => {
    const independent = build(
      Array.from({ length: 4 }, (_, i) =>
        ev({ skillId: 'M4.FRAC.ADD', daysAgo: 8 - i, correct: true, hintDependency: 0 }),
      ),
    ).skillMastery.get(asSkillId('M4.FRAC.ADD'))!.mastery;
    const propped = build(
      Array.from({ length: 4 }, (_, i) =>
        ev({ skillId: 'M4.FRAC.ADD', daysAgo: 8 - i, correct: true, hintDependency: 0.9 }),
      ),
    ).skillMastery.get(asSkillId('M4.FRAC.ADD'))!.mastery;
    expect(independent).toBeGreaterThan(propped + 20);
  });

  it('retention decays when a skill has not been verified recently', () => {
    const stale = build([ev({ skillId: 'M4.FRAC.COMPARE', daysAgo: 120, correct: true, confidenceTier: 'A' })])
      .skillMastery.get(asSkillId('M4.FRAC.COMPARE'))!;
    const fresh = build([ev({ skillId: 'M4.FRAC.COMPARE', daysAgo: 2, correct: true, confidenceTier: 'A' })])
      .skillMastery.get(asSkillId('M4.FRAC.COMPARE'))!;
    expect(stale.retention).toBeLessThan(0.3);
    expect(fresh.retention).toBeGreaterThan(0.9);
  });

  it('does not claim a thinking level higher than the items actually attempted', () => {
    // M7.PT.RATIO.EQUAL_RATIO is T2; perfect scores must not imply T5 thinking.
    const twin = build([
      ev({ skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 5, correct: true, problemTypeId: 'M7.PT.RATIO.EQUAL_RATIO' }),
      ev({ skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 3, correct: true, problemTypeId: 'M7.PT.RATIO.EQUAL_RATIO' }),
    ]);
    for (const state of twin.thinkingProfile.values()) {
      expect(['T1', 'T2']).toContain(state.demonstratedLevel);
    }
  });

  it('tracks a trailing error streak for the gap engine', () => {
    const twin = build([
      ev({ skillId: 'M4.FRAC.DIV', daysAgo: 6, correct: true }),
      ev({ skillId: 'M4.FRAC.DIV', daysAgo: 4, correct: false }),
      ev({ skillId: 'M4.FRAC.DIV', daysAgo: 2, correct: false }),
    ]);
    expect(twin.skillMastery.get(asSkillId('M4.FRAC.DIV'))!.recentErrorStreak).toBe(2);
  });
});

describe('recomputeTwin job', () => {
  it('rebuilds from an evidence reader and is idempotent across runs', async () => {
    const evidence = [
      ev({ skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 9, correct: true }),
      ev({ skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 3, correct: false, reasoningQuality: 'adequate' }),
    ];
    const reader = { history: () => Promise.resolve(evidence as readonly Evidence[]) };
    const first = await recomputeTwin({ childId, gradeContext: 4, evidenceReader: reader, knowledgeBase: kb, asOf });
    const second = await recomputeTwin({ childId, gradeContext: 4, evidenceReader: reader, knowledgeBase: kb, asOf });
    expect(first).toEqual(second);
  });
});
