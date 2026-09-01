import { describe, expect, it } from 'vitest';
import {
  asChildId,
  asSkillId,
  TARGET_SELECTION_REASONS,
  type Evidence,
  type ExpectedLearningContext,
  type LessonConfirmationEvent,
} from '@copilot/domain';
import { resolveLearningContext } from '@copilot/learning-context';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { selectLearningTargets } from '@copilot/planning';
import { KB, buildEvidence } from '../harness.js';

/**
 * C4.2 §7/§8 — LEARNING CONTEXT / FRONTIER SEPARATION + NEXT SAFE FRONTIER.
 *
 * The traceable example from doc 14 C4.2 §7: a Grade-7 child whose current
 * school lesson is the Grade-7 "dãy tỉ số bằng nhau" lesson, who has uploaded
 * Grade-9-equivalent algebra homework (M7.ALG.SYMMETRIC, curriculumOrigin 9,
 * living on the synthetic C.G7.EXT.0 skill-family node), with one Grade-8
 * bridge skill (M7.ALG.IDENTITY, the direct prerequisite of SYMMETRIC) still
 * weak. Every assertion below is traceable to a `selectLearningTargets` /
 * `resolveLearningContext` return value — nothing is asserted from narrative.
 */

const childId = asChildId('c_ctxfrontier');
const asOf = new Date('2027-02-01T09:00:00Z');

// current school lesson (CORE_CURRICULUM, grade 7)
const LESSON = 'C.G7.6.21';
const CURRENT = 'M7.RATIO.EQUAL_CHAIN'; // origin 7, algebraic_thinking, on LESSON
const PREREQ = 'M7.RATIO.PROPORTION';
// the Grade-8 bridge — SYMMETRIC's only direct prerequisite
const BRIDGE_G8 = 'M7.ALG.IDENTITY'; // origin 8, on the synthetic C.G7.EXT.0 node
// the demonstrated Grade-9 skill — lives on the same synthetic node as BRIDGE_G8
const FRONTIER_G9 = 'M7.ALG.SYMMETRIC'; // origin 9
// BRIDGE_G8's own direct prerequisite — mastering it makes BRIDGE_G8 "ready next"
const BRIDGE_UNLOCK = 'M7.ALG.POLY_MUL'; // origin 7, algebraic_thinking
// same synthetic node, same domain, but graph-DISCONNECTED from the evidence below
const UNRELATED_ABOVE_GRADE = 'M7.ALG.FACTOR'; // origin 8, direct prereq = BRIDGE_G8

const EXT_NODE = 'C.G7.EXT.0';

function ev(skillId: string, daysAgo: number, correct: boolean, over: Partial<Evidence> = {}): Evidence {
  return buildEvidence(childId, [{ skillId, daysAgo, correct, ...over }], asOf)[0]!;
}

const clock: ExpectedLearningContext = {
  curriculum: 'KET_NOI_TRI_THUC',
  chapterId: 6,
  lessonId: LESSON,
  alsoPlausibleLessonIds: [],
  window: { fromLessonId: LESSON, toLessonId: LESSON, widthLessons: 0, lessonIds: [LESSON] },
  source: 'CURRICULUM_TIMELINE',
  confidence: 'ESTIMATED',
  asOfDate: '2027-02-01',
  paceDeltaApplied: 0,
  calendar: { calendarId: 'cal.KNTT.G7.2026-2027.v1', version: 1, status: 'PROVISIONAL', source: 'test', academicYear: '2026-2027' },
};

/** Base evidence: current lesson practiced normally + strong Grade-9 traction + a weak Grade-8 bridge. */
function baseEvidence(): Evidence[] {
  return [
    ev(CURRENT, 10, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ev(CURRENT, 6, true, { confidenceTier: 'B' }),
    ev(PREREQ, 9, true, { confidenceTier: 'B' }),
    // deliberately not tier A: this is background traction on a CORE_CURRICULUM
    // lesson of its own — it must not out-rank the actual current lesson above.
    ev(BRIDGE_UNLOCK, 12, true, { confidenceTier: 'B' }),
    ev(BRIDGE_UNLOCK, 8, true, { confidenceTier: 'B' }),
    // Grade-8 bridge: uploaded homework, but got it WRONG twice — a real weakness, not yet mastered
    ev(BRIDGE_G8, 5, false, { reasoningQuality: 'weak', confidenceTier: 'B' }),
    ev(BRIDGE_G8, 2, false, { reasoningQuality: 'weak', confidenceTier: 'B' }),
    // Grade-9 evidence: HSG-style homework scan, strong and repeated
    ev(FRONTIER_G9, 14, true, { confidenceTier: 'A' }),
    ev(FRONTIER_G9, 4, true, { confidenceTier: 'A' }),
  ];
}

function run(evidence: Evidence[], parentGoal: 'kha_gioi' | 'hsg_thi_chuyen' | 'theo_sat_chuong_trinh' = 'kha_gioi') {
  const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
  const gaps = runGapEngine({ childId, gradeContext: 7, twin, evidence, knowledgeBase: KB, parentGoal, asOf });
  const context = resolveLearningContext({ expected: clock, contributions: [], evidence, knowledgeBase: KB, asOf, gradeContext: 7 });
  const readiness = gaps.readiness.find((r) => r.targetSkillId === asSkillId(CURRENT))?.recommendation ?? 'ready';
  const targets = selectLearningTargets({
    resolvedLessonId: context.resolved.lessonId,
    activeSkillIds: [asSkillId(CURRENT)],
    gradeContext: 7,
    twin,
    gaps,
    knowledgeBase: KB,
    parentGoal,
    readiness,
  });
  return { twin, gaps, context, targets };
}

describe('C4.2 §7 — the full traceable example (Grade-7 current lesson, Grade-9 evidence, Grade-8 bridge)', () => {
  const { context, twin, targets } = run(baseEvidence());

  it('§8.1 / §8.4 — Grade-9/HSG evidence on the synthetic EXT node never becomes the resolved current lesson', () => {
    expect(context.resolved.lessonId).toBe(LESSON);
    expect(context.resolved.lessonId).not.toBe(EXT_NODE);
    // and it is provably not eligible in the first place
    expect(KB.getCurriculumNode(EXT_NODE).nodeType).toBe('ADVANCED');
  });

  it('§8.2 — the same advanced evidence DOES move the domain frontier upward', () => {
    const alg = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    expect(alg.reachedCurriculumOrigin).toBe(9);
    expect(alg.aboveGrade).toBe(true);
    expect(alg.masteredSkillIds).toContain(asSkillId(FRONTIER_G9));
    // ... yet the resolved current lesson is untouched by that same evidence
    expect(context.resolved.lessonId).toBe(LESSON);
  });

  it('§8.5 — reachedCurriculumOrigin=9 does not unlock every Grade-8/9 skill in the domain', () => {
    const alg = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    // FACTOR is above-grade, same domain, same reached origin band — but graph-disconnected
    // (its only prerequisite, the Grade-8 bridge, is still weak) so it is neither mastered nor ready-next.
    expect(alg.masteredSkillIds).not.toContain(asSkillId(UNRELATED_ABOVE_GRADE));
    expect(alg.readyNextSkillIds).not.toContain(asSkillId(UNRELATED_ABOVE_GRADE));
    expect(targets.frontier.some((f) => f.skillId === asSkillId(UNRELATED_ABOVE_GRADE))).toBe(false);
  });

  it('§8.6 / §7 — the NEXT SAFE Grade-8 bridge is selected ahead of the demonstrated Grade-9 skill', () => {
    expect(targets.frontier.length).toBeGreaterThanOrEqual(1);
    const picked = targets.frontier[0]!;
    expect(picked.skillId).toBe(asSkillId(BRIDGE_G8));
    expect(picked.selectionReason).toBe('NEXT_SAFE_FRONTIER');
    expect(picked.selectedCurriculumOrigin).toBe(8);
    expect(picked.frontierEvidenceOrigin).toBe(9); // the evidence that justified looking above grade at all
  });

  it('§8.9 — the selection is fully traceable: candidates, rejections, and reasons are exposed', () => {
    const alg = targets.trace.domains.find((d) => d.domain === 'algebraic_thinking')!;
    expect(alg.frontierEvidenceOrigin).toBe(9);
    expect(alg.candidates.some((c) => c.skillId === asSkillId(BRIDGE_G8) && c.kind === 'NEXT_SAFE')).toBe(true);
    // SYMMETRIC (mastered directly) is NOT silently offered either — it is explicitly
    // REJECTED, because its own bridge prerequisite (IDENTITY) is a blocking weakness.
    // That rejection, with its reason, is exactly what makes the pick traceable.
    const rejectedSymmetric = alg.rejected.find((r) => r.skillId === asSkillId(FRONTIER_G9));
    expect(rejectedSymmetric).toBeDefined();
    expect(rejectedSymmetric!.reason).toMatch(/blocking/i);
    expect(alg.selected).toEqual([asSkillId(BRIDGE_G8)]);
    for (const t of targets.all) {
      expect(TARGET_SELECTION_REASONS).toContain(t.selectionReason);
      expect(t.selectedCurriculumOrigin).toBeGreaterThan(0);
      expect(t.selectionConfidence).toBeGreaterThanOrEqual(0);
      expect(t.selectionConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('§8.12 — Context and Frontier are independently computable/testable objects', () => {
    // resolveLearningContext never received `twin`; buildLearningTwin never received `context`.
    // Re-deriving each alone from the same raw evidence reproduces the same result.
    const evidence = baseEvidence();
    const contextOnly = resolveLearningContext({ expected: clock, contributions: [], evidence, knowledgeBase: KB, asOf, gradeContext: 7 });
    const twinOnly = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
    expect(contextOnly.resolved).toEqual(context.resolved);
    expect(twinOnly.frontier).toEqual(twin.frontier);
  });
});

describe('C4.2 §8 — remaining required tests', () => {
  it('§8.3 — an explicit teacher confirmation of a legitimate CORE_CURRICULUM lesson wins', () => {
    const otherLesson = KB.getSkill(BRIDGE_UNLOCK).curriculumNodeId; // C.G7.7.27, also CORE_CURRICULUM
    expect(KB.getCurriculumNode(otherLesson).nodeType).toBe('CORE_CURRICULUM');
    const confirmation: LessonConfirmationEvent = {
      id: 'lc_teacher',
      childId,
      lessonId: otherLesson,
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      confirmedBy: 'teacher_u',
      confirmedAt: new Date(asOf.getTime() - 86_400_000).toISOString(),
    };
    const r = resolveLearningContext({
      expected: clock,
      contributions: [],
      lessonConfirmations: [confirmation],
      evidence: baseEvidence(),
      knowledgeBase: KB,
      asOf,
      gradeContext: 7,
    });
    expect(r.resolved.lessonId).toBe(otherLesson);
    expect(r.resolved.source).toBe('TEACHER_UPDATE');
    expect(r.resolved.confidence).toBe('VERIFIED');
  });

  it('§8.4 — a confirmation attempting to name the synthetic EXT node as the current lesson is rejected', () => {
    const confirmation: LessonConfirmationEvent = {
      id: 'lc_bad',
      childId,
      lessonId: EXT_NODE,
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      confirmedBy: 'teacher_u',
      confirmedAt: new Date(asOf.getTime() - 86_400_000).toISOString(),
    };
    const r = resolveLearningContext({
      expected: clock,
      contributions: [],
      lessonConfirmations: [confirmation],
      evidence: [],
      knowledgeBase: KB,
      asOf,
      gradeContext: 7,
    });
    expect(r.resolved.lessonId).not.toBe(EXT_NODE);
    // with no other signal, the confirmation is simply dropped — the clock estimate stands
    expect(r.resolved.lessonId).toBe(LESSON);
    expect(r.resolved.guardrailApplied).toBe('no_observed_evidence_estimate_only');
  });

  it('§8.7 — when the Grade-8 bridge IS mastered, a Grade-9 NEXT SAFE frontier target can be selected', () => {
    // Self-contained: only the bridge unlock + the bridge itself are mastered — the
    // current-lesson skill is deliberately left out of this evidence set so its own
    // dependent (MULTIVAR, unrelated to this bridge) never competes for the frontier slot.
    const evidence = [
      ev(BRIDGE_UNLOCK, 12, true, { confidenceTier: 'A' }),
      ev(BRIDGE_UNLOCK, 8, true, { confidenceTier: 'A' }),
      // the bridge is now solidly mastered
      ev(BRIDGE_G8, 7, true, { confidenceTier: 'A' }),
      ev(BRIDGE_G8, 3, true, { confidenceTier: 'A' }),
      // NOTE: deliberately NO direct evidence on SYMMETRIC itself — it becomes a
      // "ready next" purely from the prerequisite graph (mastered bridge), not
      // from having been demonstrated. That is exactly what "prerequisites
      // support a Grade-9 next skill" means.
    ];
    const { twin, targets } = run(evidence, 'hsg_thi_chuyen');
    const alg = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    expect(alg.masteredSkillIds).toContain(asSkillId(BRIDGE_G8));
    expect(alg.readyNextSkillIds).toContain(asSkillId(FRONTIER_G9));
    const picked = targets.frontier.find((f) => f.skillId === asSkillId(FRONTIER_G9));
    expect(picked).toBeDefined();
    expect(picked!.selectionReason).toBe('NEXT_SAFE_FRONTIER');
    expect(picked!.selectedCurriculumOrigin).toBe(9);
  });

  it('§8.8 — a blocking prerequisite gap rejects the candidate with an explicit traced reason', () => {
    const evidence = [
      ...baseEvidence(),
      // hammer the bridge's own prerequisite until the gap engine flags it as blocking
      ev(BRIDGE_UNLOCK, 6, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev(BRIDGE_UNLOCK, 3, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev(CURRENT, 4, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ];
    const { targets } = run(evidence, 'hsg_thi_chuyen');
    expect(targets.frontier.some((f) => f.skillId === asSkillId(BRIDGE_G8))).toBe(false);
    const alg = targets.trace.domains.find((d) => d.domain === 'algebraic_thinking');
    if (alg) {
      const rejection = alg.rejected.find((r) => r.skillId === asSkillId(BRIDGE_G8) || r.skillId === asSkillId(FRONTIER_G9));
      expect(rejection?.reason).toMatch(/blocking/i);
    }
  });
});

describe('C4.2 §6 — Thinking target fallback (safe adjacent skill, never fabricated)', () => {
  // M7.GEO.EUCLID_PARALLEL has NO T4/T5 problem types of its own; M7.GEO.PARALLEL_CRITERIA
  // (its direct dependent) does. Both are grade-7 geometry — no above-grade knowledge involved.
  const CURRENT_NO_HIGH_T = 'M7.GEO.EUCLID_PARALLEL';
  const ADJACENT_HIGH_T = 'M7.GEO.PARALLEL_CRITERIA';
  const T4_PROBLEM_TYPE = 'M7.PT.GEO.PRACTICAL_SOLIDS';
  const BRIDGE_PREREQ_A = 'M7.GEO.ANGLE_SPECIAL_BISECTOR';
  const BRIDGE_PREREQ_B = 'M4.GEO.PARALLEL';

  function selectFor(masterAdjacentPrereqs: boolean) {
    const evidence: Evidence[] = [
      ev(CURRENT_NO_HIGH_T, 10, true, { confidenceTier: 'A' }),
      ev(CURRENT_NO_HIGH_T, 6, true, { confidenceTier: 'A' }),
      // strong-thinking evidence: a positive T4 observation on a skill sharing thinkingDimensions
      ev(ADJACENT_HIGH_T, 5, true, { confidenceTier: 'A', problemTypeId: T4_PROBLEM_TYPE }),
      ...(masterAdjacentPrereqs
        ? [
            ev(BRIDGE_PREREQ_A, 9, true, { confidenceTier: 'A' }),
            ev(BRIDGE_PREREQ_B, 9, true, { confidenceTier: 'A' }),
          ]
        : []),
    ];
    const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
    const gaps = runGapEngine({ childId, gradeContext: 7, twin, evidence, knowledgeBase: KB, parentGoal: 'kha_gioi', asOf });
    return selectLearningTargets({
      resolvedLessonId: KB.getSkill(CURRENT_NO_HIGH_T).curriculumNodeId,
      activeSkillIds: [asSkillId(CURRENT_NO_HIGH_T)],
      gradeContext: 7,
      twin,
      gaps,
      knowledgeBase: KB,
      parentGoal: 'kha_gioi',
      readiness: 'ready',
    });
  }

  it('§8.10 — strong-thinking child, no T4/T5 on the current skill → a safe adjacent thinking target is used', () => {
    expect(KB.getProblemTypesForSkill(CURRENT_NO_HIGH_T).some((pt) => pt.thinkingLevel === 'T4' || pt.thinkingLevel === 'T5')).toBe(false);
    const targets = selectFor(true);
    expect(targets.trace.thinkingFallbackUsed).toBe(true);
    expect(targets.thinking.length).toBe(1);
    expect(targets.thinking[0]!.skillId).toBe(asSkillId(ADJACENT_HIGH_T));
    expect(targets.thinking[0]!.selectionReason).toBe('THINKING_ADJACENT_FALLBACK');
    expect(targets.thinking[0]!.knowledgeCeiling).toBe('K3'); // grade-level K — above-grade knowledge not required for T4/T5
  });

  it('§8.11 — no safe adjacent target available → no thinking target is fabricated', () => {
    const targets = selectFor(false); // adjacent skill's own prerequisites are NOT satisfied
    expect(targets.thinking).toEqual([]);
    expect(targets.trace.thinkingFallbackUsed).toBe(false);
  });
});
