import { describe, expect, it } from 'vitest';
import { CORE_DISCRIMINATION_TARGETS, type GapType } from '@copilot/domain';
import { KB, runScenario, type GoldenScenario } from './harness.js';

/**
 * The Golden Discrimination Matrix (Golden Test Plan §1.1).
 * Each scenario is engineered so the engine MUST land on one gap type and rule
 * out its confusable neighbours. Deterministic — AI is not in the loop.
 *
 * `ruledOut` accumulates the gap types the classifier evaluated and rejected
 * *before* reaching its verdict (priority order:
 *   retention → careless → prerequisite → reasoning → recognition/application
 *   → method → procedural → concept[fallback]).
 * So `mustRuleOut` lists only the confusables that precede the expected type.
 */

const strongPrereqFractions = [
  { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 30, correct: true, confidenceTier: 'A' as const },
  { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 24, correct: true },
  { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 12, correct: true },
  { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 22, correct: true },
  { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 9, correct: true },
];

const cases: Array<{
  scenario: GoldenScenario;
  expectType: GapType;
  mustRuleOut: GapType[];
  rootSkillId?: string;
}> = [
  {
    // CONCEPT: consistent failure on the skill, prerequisites are solid.
    scenario: {
      id: 'concept',
      description: 'Consistent failure on common-denominator with strong prerequisites',
      gradeContext: 4,
      evidence: [
        ...strongPrereqFractions,
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 10, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 6, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 2, correct: false, reasoningQuality: 'weak' },
      ],
    },
    expectType: 'concept_gap',
    mustRuleOut: ['retention_gap', 'careless_error', 'prerequisite_gap', 'reasoning_gap', 'recognition_gap', 'application_gap', 'method_gap', 'procedural_gap'],
    rootSkillId: 'M4.FRAC.COMMON_DENOM',
  },
  {
    // PREREQUISITE: same visible failure, but the prerequisite is the weak one.
    scenario: {
      id: 'prereq',
      description: 'Common-denominator fails because equivalent fractions is weak',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 14, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 9, correct: false, reasoningQuality: 'weak' },
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 4, correct: false },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 7, correct: false },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false },
      ],
    },
    expectType: 'prerequisite_gap',
    mustRuleOut: ['retention_gap', 'careless_error'],
    rootSkillId: 'M4.FRAC.EQUIVALENT',
  },
  {
    // CARELESS: high mastery, one recent slip, strong reasoning, no hints.
    scenario: {
      id: 'careless',
      description: 'Strong on simplify, one careless slip',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 20, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 15, correct: true },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 10, correct: true },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 6, correct: true },
        { skillId: 'M4.FRAC.SIMPLIFY', daysAgo: 1, correct: false, reasoningQuality: 'strong', hintDependency: 0 },
      ],
    },
    expectType: 'careless_error',
    mustRuleOut: ['retention_gap'],
  },
  {
    // RETENTION: verified long ago, now slipping after a gap.
    scenario: {
      id: 'retention',
      description: 'Compare fractions was solid 100 days ago, now failing',
      gradeContext: 4,
      asOf: '2026-08-31T09:00:00Z',
      evidence: [
        { skillId: 'M4.FRAC.COMPARE', daysAgo: 110, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMPARE', daysAgo: 100, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMPARE', daysAgo: 3, correct: false, reasoningQuality: 'adequate' },
      ],
    },
    expectType: 'retention_gap',
    mustRuleOut: [],
    rootSkillId: 'M4.FRAC.COMPARE',
  },
  {
    // METHOD: one problem type weak (leaning on hints), its siblings are fine.
    scenario: {
      id: 'method',
      description: 'Common-denominator: PT2 weak with heavy hint use, PT1 and PT3 fine',
      gradeContext: 4,
      evidence: [
        ...strongPrereqFractions,
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 14, correct: true, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT1' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 11, correct: true, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT1' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 9, correct: true, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT3' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 6, correct: true, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT3' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 4, correct: false, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT2', hintDependency: 0.8 },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 1, correct: false, problemTypeId: 'M4.FRAC.COMMON_DENOM.PT2', hintDependency: 0.7 },
      ],
    },
    expectType: 'method_gap',
    mustRuleOut: ['retention_gap', 'careless_error', 'prerequisite_gap', 'reasoning_gap', 'recognition_gap', 'application_gap'],
  },
  {
    // RECOGNITION: direct problem types strong, a "hidden structure" type weak.
    scenario: {
      id: 'recognition',
      description: 'Distributive: direct use fine, hidden common factor fails',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 16, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT1' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 12, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT1' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 9, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT2' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 6, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT2' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 4, correct: false, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT4' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 2, correct: false, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT4' },
      ],
    },
    expectType: 'recognition_gap',
    mustRuleOut: ['retention_gap', 'careless_error', 'prerequisite_gap', 'reasoning_gap'],
  },
  {
    // APPLICATION: direct sum-difference fine, worded/hidden version fails.
    scenario: {
      id: 'application',
      description: 'Sum-difference: direct fine, hidden-difference word problem fails',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.WORD.SUM_DIFF', daysAgo: 15, correct: true, problemTypeId: 'M4.WORD.SUM_DIFF.PT1' },
        { skillId: 'M4.WORD.SUM_DIFF', daysAgo: 11, correct: true, problemTypeId: 'M4.WORD.SUM_DIFF.PT1' },
        { skillId: 'M4.WORD.SUM_DIFF', daysAgo: 8, correct: true, problemTypeId: 'M4.WORD.SUM_DIFF.PT1' },
        { skillId: 'M4.WORD.SUM_DIFF', daysAgo: 5, correct: false, problemTypeId: 'M4.WORD.SUM_DIFF.PT2' },
        { skillId: 'M4.WORD.SUM_DIFF', daysAgo: 2, correct: false, problemTypeId: 'M4.WORD.SUM_DIFF.PT2' },
      ],
    },
    expectType: 'application_gap',
    mustRuleOut: ['retention_gap', 'careless_error', 'prerequisite_gap', 'reasoning_gap'],
  },
  {
    // REASONING: knowledge is strong, a high-thinking item fails — do NOT tank knowledge.
    scenario: {
      id: 'reasoning',
      description: 'Equal-ratio chain: routine items solid, non-routine T5 item fails',
      gradeContext: 7,
      evidence: [
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 20, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1', confidenceTier: 'A' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 15, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 11, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 7, correct: true, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT1' },
        { skillId: 'G7.RATIO.EQUAL_CHAIN', daysAgo: 3, correct: false, problemTypeId: 'G7.RATIO.EQUAL_CHAIN.PT_HSG', reasoningQuality: 'adequate' },
      ],
    },
    expectType: 'reasoning_gap',
    mustRuleOut: ['retention_gap', 'careless_error', 'prerequisite_gap'],
  },
];

describe('Golden Discrimination Matrix — 8 core gap types', () => {
  it('covers every core discrimination target', () => {
    const covered = new Set(cases.map((c) => c.expectType));
    for (const target of CORE_DISCRIMINATION_TARGETS) {
      expect(covered.has(target), `no scenario for ${target}`).toBe(true);
    }
  });

  for (const { scenario, expectType, mustRuleOut, rootSkillId } of cases) {
    it(`${scenario.id} → ${expectType}`, () => {
      const { topGap } = runScenario(scenario);
      expect(topGap, `${scenario.id}: no gap detected`).toBeDefined();
      expect(topGap!.type).toBe(expectType);
      for (const ruled of mustRuleOut) {
        expect(topGap!.ruledOut, `${scenario.id} should have ruled out ${ruled}`).toContain(ruled);
      }
      if (rootSkillId) expect(topGap!.rootSkillId).toBe(rootSkillId);
    });
  }
});

describe('Knowledge Level vs Thinking Level are independent', () => {
  it('a Grade-4-knowledge item that needs T5 thinking → reasoning gap, not "needs higher grade"', () => {
    const { twin, topGap } = runScenario({
      id: 'kt-k2t5',
      description: 'K2 knowledge, T5 thinking — distributive challenge',
      gradeContext: 4,
      evidence: [
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 18, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT1', confidenceTier: 'A' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 13, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT1' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 9, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT2' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 5, correct: true, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT2' },
        { skillId: 'M4.ARITH.DISTRIBUTIVE', daysAgo: 2, correct: false, problemTypeId: 'M4.ARITH.DISTRIBUTIVE.PT_CHALLENGE', reasoningQuality: 'adequate' },
      ],
    });
    expect(topGap?.type).toBe('reasoning_gap');
    // knowledge mastery on the skill is NOT tanked by the one hard miss
    expect(twin.skillMastery.get('M4.ARITH.DISTRIBUTIVE' as never)!.mastery).toBeGreaterThan(60);
    // and the frontier for arithmetic is NOT "above grade" — this is grade-4 knowledge
    const arith = twin.frontier.find((f) => f.domain === 'arithmetic');
    expect(arith?.aboveGrade).toBe(false);
  });

  it('the knowledge base carries items where K and T vary independently', () => {
    // K2/T5 and K4/T1 both exist → the axes are not collapsed into one "difficulty"
    expect(KB.problemTypes.some((p) => p.knowledgeLevel === 'K2' && p.thinkingLevel === 'T5')).toBe(true);
    expect(KB.problemTypes.some((p) => p.knowledgeLevel === 'K4' && p.thinkingLevel === 'T1')).toBe(true);
  });
});
