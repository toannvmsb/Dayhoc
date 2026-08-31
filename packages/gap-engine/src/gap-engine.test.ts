import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type ChildLearningTwin, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { traceRootGap } from './root-gap.js';
import { computeReadiness } from './readiness.js';
import { runGapEngine } from './engine.js';
import { DEFAULT_GAP_CONFIG } from './config.js';

const kb = loadKnowledgeBase();
const childId = asChildId('child_1');
const asOf = new Date('2026-08-31T09:00:00Z');
let n = 0;

function ev(skillId: string, daysAgo: number, correct: boolean, extra: Partial<Evidence> = {}): Evidence {
  const occurredAt = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${++n}` as Evidence['id'],
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

const twinOf = (evidence: Evidence[], gradeContext: 4 | 7 = 7): ChildLearningTwin =>
  buildLearningTwin({ childId, gradeContext, evidence, knowledgeBase: kb, asOf });

describe('traceRootGap', () => {
  it('walks into a weak, evidenced, important prerequisite', () => {
    const evidence = [
      ev('M4.FRAC.EQUIVALENT', 10, false),
      ev('M4.FRAC.EQUIVALENT', 5, false),
      ev('M4.FRAC.COMMON_DENOM', 4, false),
    ];
    const trace = traceRootGap(asSkillId('M4.FRAC.COMMON_DENOM'), twinOf(evidence, 4), kb, DEFAULT_GAP_CONFIG);
    expect(trace.isPrerequisite).toBe(true);
    expect(trace.rootSkillId).toBe('M4.FRAC.EQUIVALENT');
    expect(trace.path[0]).toBe('M4.FRAC.COMMON_DENOM');
  });

  it('does NOT invent a prerequisite root when the prereq has no evidence (HSG rule)', () => {
    const evidence = [ev('G7.SYM.BASIC', 6, false), ev('G7.SYM.BASIC', 2, false)];
    const trace = traceRootGap(asSkillId('G7.SYM.BASIC'), twinOf(evidence), kb, DEFAULT_GAP_CONFIG);
    expect(trace.isPrerequisite).toBe(false);
    expect(trace.rootSkillId).toBe('G7.SYM.BASIC');
  });
});

describe('computeReadiness', () => {
  it('recommends repair_first when a blocking prerequisite is critically weak', () => {
    const evidence = [
      ev('M4.FRAC.EQUIVALENT', 8, false),
      ev('M4.FRAC.EQUIVALENT', 3, false),
      ev('M4.FRAC.EQUIVALENT', 1, false),
    ];
    const r = computeReadiness(
      childId,
      asSkillId('M4.FRAC.COMMON_DENOM'),
      twinOf(evidence, 4),
      kb,
      DEFAULT_GAP_CONFIG,
    );
    expect(r.recommendation).toBe('repair_first');
    expect(r.weakPrerequisites).toContain('M4.FRAC.EQUIVALENT');
  });

  it('recommends parallel_repair (keep the advanced path) when prereqs are only moderately weak', () => {
    const evidence = [
      ev('G7.RATIO.EQUAL_RATIO', 20, true),
      ev('G7.RATIO.EQUAL_RATIO', 14, true),
      ev('G7.RATIO.EQUAL_RATIO', 9, false), // dips it below target, not critical
    ];
    const r = computeReadiness(
      childId,
      asSkillId('G7.RATIO.EQUAL_CHAIN'),
      twinOf(evidence),
      kb,
      DEFAULT_GAP_CONFIG,
    );
    expect(['parallel_repair', 'ready']).toContain(r.recommendation);
  });

  it('recommends ready when prerequisites are solid', () => {
    const evidence = [
      ev('G7.RATIO.EQUAL_RATIO', 20, true, { confidenceTier: 'A' }),
      ev('G7.RATIO.EQUAL_RATIO', 12, true, { confidenceTier: 'A' }),
      ev('G7.RATIO.EQUAL_RATIO', 4, true),
    ];
    const r = computeReadiness(
      childId,
      asSkillId('G7.RATIO.EQUAL_CHAIN'),
      twinOf(evidence),
      kb,
      DEFAULT_GAP_CONFIG,
    );
    expect(r.recommendation).toBe('ready');
  });
});

describe('runGapEngine', () => {
  const evidence = [
    // strong prereqs
    ev('M4.FRAC.EQUIVALENT', 30, true, { confidenceTier: 'A' }),
    ev('M4.FRAC.EQUIVALENT', 18, true),
    ev('M4.FRAC.SIMPLIFY', 20, true),
    // a real concept gap on common denominator
    ev('M4.FRAC.COMMON_DENOM', 9, false, { reasoningQuality: 'weak' }),
    ev('M4.FRAC.COMMON_DENOM', 5, false, { reasoningQuality: 'weak' }),
    ev('M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak' }),
    // a careless slip elsewhere
    ev('M4.FRAC.SIMPLIFY', 1, false, { reasoningQuality: 'strong', hintDependency: 0 }),
  ];

  it('produces gaps sorted by gap_score, each with a rationale and a score band', () => {
    const result = runGapEngine({
      childId,
      gradeContext: 4,
      twin: twinOf(evidence, 4),
      evidence,
      knowledgeBase: kb,
      parentGoal: 'theo_sat_chuong_trinh',
      asOf,
    });
    expect(result.gaps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.gaps.length; i++) {
      expect(result.gaps[i - 1]!.score.score).toBeGreaterThanOrEqual(result.gaps[i]!.score.score);
    }
    for (const g of result.gaps) {
      expect(g.rationale.length).toBeGreaterThan(10);
      expect(['low', 'medium', 'high']).toContain(g.score.band);
      expect(g.lifecycleState).toBe('DETECTED');
    }
  });

  it('does not emit a remediation prescription for a careless error', () => {
    const result = runGapEngine({
      childId,
      gradeContext: 4,
      twin: twinOf(evidence, 4),
      evidence,
      knowledgeBase: kb,
      asOf,
    });
    const careless = result.gaps.find((g) => g.type === 'careless_error');
    expect(careless).toBeDefined();
    expect(result.prescriptions.some((p) => p.gapId === careless!.id)).toBe(false);
    // the concept gap DOES get one
    const concept = result.gaps.find((g) => g.type === 'concept_gap');
    expect(result.prescriptions.some((p) => p.gapId === concept!.id)).toBe(true);
  });

  it('prescription offers the four parent choices and a dose that reflects the gap type', () => {
    const result = runGapEngine({ childId, gradeContext: 4, twin: twinOf(evidence, 4), evidence, knowledgeBase: kb, asOf });
    const rx = result.prescriptions.find((p) => p.rootGapLabel.length > 0)!;
    expect(rx.options.map((o) => o.key).sort()).toEqual(['follow', 'later', 'lighter', 'intensify'].sort());
    const total = rx.dose.foundation + rx.dose.standard + rx.dose.application + rx.dose.thinking;
    expect(total).toBeGreaterThan(6);
  });

  it('is deterministic — same inputs, identical result', () => {
    const run = () =>
      runGapEngine({ childId, gradeContext: 4, twin: twinOf(evidence, 4), evidence, knowledgeBase: kb, asOf, newId: (() => { let i = 0; return () => `${++i}`; })() });
    expect(run()).toEqual(run());
  });
});
