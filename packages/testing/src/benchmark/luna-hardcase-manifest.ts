import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type Evidence,
  type ExerciseGenerationSpec,
  type ExpectedLearningContext,
  type ParentGoal,
} from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildExerciseGenerationSpec, selectLearningTargets, type LearningTargets } from '@copilot/planning';
import { KB } from '../harness.js';

/**
 * HARD-CASE benchmark manifest (doc 14 C5.2 §B, patched §1-§3). A SEPARATE set
 * of 10 synthetic cases (HC01–HC10) that exercise DạyZi's educational
 * differentiators the golden twin/planner dataset does not: grade-level T4/T5,
 * real above-grade FRONTIER (incl. K5), Parallel Gap Repair with a proven
 * frontier progression, no-frontier HSG, and both weak-context and true
 * ESTIMATED (curriculum-clock-only) behaviour. Every spec is built through the
 * REAL deterministic pipeline; the `expect` block is machine-checkable.
 */
export const HARDCASE_MANIFEST_VERSION = 'luna-generation-benchmark.hardcase.v2';

const AS_OF = new Date('2027-02-01T09:00:00Z');

// --- grade-4 skills (grade-level knowledge, T4/T5 problem types authored) ---
const G4_DIST = 'M4.ARITH.DISTRIBUTIVE'; // origin 4, node C.G4.8.5 CORE_CURRICULUM, has T4 (K2) + T5 (K3)
const G4_DIST_T4 = 'M4.PT.DIST.MULTI_TERM'; // K2 / T4
const G4_DIST_T5 = 'M4.PT.DIST.CREATE'; // K3 / T5
const G4_SUMDIFF = 'M4.WORD.SUM_DIFF';
const G4_SUMDIFF_T4 = 'M4.PT.SD.TRANSFER'; // K2 / T4

// --- grade-7 algebra chain (from C4.2) ---
const G7_CURRENT = 'M7.RATIO.EQUAL_CHAIN'; // origin 7, node C.G7.6.21 CORE_CURRICULUM, has T4/T5
const G7_PREREQ = 'M7.RATIO.PROPORTION';
const G7_UNLOCK = 'M7.ALG.POLY_MUL'; // origin 7
const G7_BRIDGE_G8 = 'M7.ALG.IDENTITY'; // origin 8
const G7_FRONTIER_G9 = 'M7.ALG.SYMMETRIC'; // origin 9

let evSeq = 0;
function ev(childId: string, skillId: string, daysAgo: number, correct: boolean, over: Partial<Evidence> = {}): Evidence {
  const at = new Date(AS_OF.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `hcev_${++evSeq}` as Evidence['id'],
    childId: asChildId(childId),
    source: 'app_practice',
    occurredAt: at,
    recordedAt: at,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...over,
  };
}

interface Pipeline {
  readonly spec: ExerciseGenerationSpec;
  /** The deterministic target selection (carries the candidate/rejection trace). */
  readonly targets: LearningTargets;
}

function pipeline(
  childId: string,
  grade: 4 | 7,
  evidence: Evidence[],
  parentGoal: ParentGoal,
  opts: { resolvedLessonId?: string; activeSkillIds?: string[]; expectedContext?: ExpectedLearningContext | null } = {},
): Pipeline {
  const cid = asChildId(childId);
  const twin = buildLearningTwin({ childId: cid, gradeContext: grade, evidence, knowledgeBase: KB, asOf: AS_OF });
  const gaps = runGapEngine({ childId: cid, gradeContext: grade, twin, evidence, knowledgeBase: KB, parentGoal, asOf: AS_OF });
  const context = buildLearningContext({
    childId: cid,
    gradeContext: grade,
    evidence,
    teacherContributions: [],
    knowledgeBase: KB,
    asOf: AS_OF,
    ...(opts.expectedContext !== undefined ? { expectedContext: opts.expectedContext } : {}),
  });
  let i = 0;
  const spec = buildExerciseGenerationSpec({
    childId: cid,
    gradeContext: grade,
    twin,
    gaps,
    context,
    knowledgeBase: KB,
    parentGoal,
    availableMinutes: 25,
    asOf: AS_OF,
    newId: () => `${childId}_${i++}`,
  });
  const resolvedLessonId = opts.resolvedLessonId ?? context.resolved.lessonId;
  const activeSkillIds = (opts.activeSkillIds ?? [...context.resolved.activeSkillIds]).map((s) => asSkillId(s));
  const readiness =
    gaps.readiness.find((r) => activeSkillIds.includes(r.targetSkillId))?.recommendation ?? 'ready';
  const targets = selectLearningTargets({
    resolvedLessonId,
    activeSkillIds,
    gradeContext: grade,
    twin,
    gaps,
    knowledgeBase: KB,
    parentGoal,
    readiness,
  });
  return { spec, targets };
}

function specFor(childId: string, grade: 4 | 7, evidence: Evidence[], parentGoal: ParentGoal): ExerciseGenerationSpec {
  return pipeline(childId, grade, evidence, parentGoal).spec;
}

/** For a G7 case: pull the algebraic_thinking domain's frontier trace + selected frontier skills. */
export function algebraicFrontierTrace(p: Pipeline): {
  candidates: { skillId: string; origin: number; kind: string }[];
  rejected: { skillId: string; origin: number; reason: string }[];
  selected: string[];
  selectedFrontierTargets: { skillId: string; selectionReason: string; selectedCurriculumOrigin: number }[];
} {
  const d = p.targets.trace.domains.find((x) => x.domain === 'algebraic_thinking');
  return {
    candidates: (d?.candidates ?? []).map((c) => ({ skillId: c.skillId, origin: c.origin, kind: c.kind })),
    rejected: (d?.rejected ?? []).map((r) => ({ skillId: r.skillId, origin: r.origin, reason: r.reason })),
    selected: [...(d?.selected ?? [])],
    selectedFrontierTargets: p.targets.frontier.map((t) => ({
      skillId: t.skillId,
      selectionReason: t.selectionReason,
      selectedCurriculumOrigin: t.selectedCurriculumOrigin,
    })),
  };
}

/** Machine-checkable expectations for one hard case. `undefined` = not asserted. */
export interface HardCaseExpect {
  readonly frontierSelected?: boolean;
  readonly advancedBucketMin?: number;
  readonly advancedBucketExactly?: number;
  readonly thinkingChallengeMin?: number;
  readonly prerequisiteRepairMin?: number;
  readonly prerequisiteRepairMax?: number;
  readonly kMaxAtMost?: string;
  readonly kMaxAtLeast?: string;
  readonly tMaxAtLeast?: string;
  readonly tMaxAtMost?: string;
  readonly currentLessonNodeType?: string;
  readonly frontierSkillIsNot?: string;
  readonly frontierSkillIs?: string;
  readonly frontierSkillSelectionReasonIn?: readonly string[];
  readonly contextConfidenceNot?: string;
  readonly contextConfidenceIs?: string;
  readonly contextSourceIs?: string;
  readonly stretchRatioAtMost?: number;
  /** No target skill originates above the school grade. */
  readonly noAboveGradeK?: boolean;
  /** ≥1 target skill originates above the school grade. */
  readonly hasAboveGradeTarget?: boolean;
}

export interface HardCase {
  readonly hardCaseId: string;
  readonly label: string;
  readonly grade: 4 | 7;
  readonly expect: HardCaseExpect;
  readonly spec: ExerciseGenerationSpec;
  /** Present for cases whose proof needs the target-selection candidate/rejection trace (HC05/HC06). */
  readonly pipeline?: Pipeline;
}

export function buildHardCaseManifest(): HardCase[] {
  const cases: HardCase[] = [];

  // HC01 — G4, grade-level K, strong thinking → T4 possible, K stays grade-level.
  cases.push({
    hardCaseId: 'HC01',
    label: 'G4 grade-level K + strong thinking → T4',
    grade: 4,
    expect: { thinkingChallengeMin: 1, tMaxAtLeast: 'T4', kMaxAtMost: 'K3', noAboveGradeK: true, frontierSelected: false },
    spec: specFor(
      'hc01',
      4,
      [
        ev('hc01', G4_DIST, 20, true, { confidenceTier: 'A' }),
        ev('hc01', G4_DIST, 12, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_DIST_T4) }),
        ev('hc01', G4_DIST, 6, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_DIST_T4) }),
        ev('hc01', G4_SUMDIFF, 9, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_SUMDIFF_T4) }),
      ],
      'phat_trien_tu_duy',
    ),
  });

  // HC02 — G4, repeated strong thinking evidence → T5 without above-grade knowledge.
  cases.push({
    hardCaseId: 'HC02',
    label: 'G4 repeated strong thinking → T5, K grade-level',
    grade: 4,
    expect: { thinkingChallengeMin: 1, tMaxAtLeast: 'T5', kMaxAtMost: 'K3', noAboveGradeK: true, frontierSelected: false },
    spec: specFor(
      'hc02',
      4,
      [
        ev('hc02', G4_DIST, 24, true, { confidenceTier: 'A' }),
        ev('hc02', G4_DIST, 18, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_DIST_T4) }),
        ev('hc02', G4_DIST, 12, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_DIST_T5) }),
        ev('hc02', G4_DIST, 6, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_DIST_T5) }),
        ev('hc02', G4_SUMDIFF, 8, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId(G4_SUMDIFF_T4) }),
      ],
      'phat_trien_tu_duy',
    ),
  });

  // HC03 — G7 HSG + strong thinking, NO above-grade frontier.
  cases.push({
    hardCaseId: 'HC03',
    label: 'G7 HSG + strong thinking, no frontier → thinkingChallenge, T5, K<=K3, advanced=0',
    grade: 7,
    expect: { thinkingChallengeMin: 1, tMaxAtLeast: 'T4', kMaxAtMost: 'K3', advancedBucketExactly: 0, frontierSelected: false, noAboveGradeK: true },
    spec: specFor(
      'hc03',
      7,
      [
        ev('hc03', G7_CURRENT, 20, true, { confidenceTier: 'A' }),
        ev('hc03', G7_CURRENT, 12, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId('M7.PT.RATIO.RATIO_QUADRATIC_CONSTRAINT') }),
        ev('hc03', G7_CURRENT, 6, true, { confidenceTier: 'A', problemTypeId: asProblemTypeId('M7.PT.RATIO.MULTIVARIABLE_NONLINEAR_REASONING') }),
        ev('hc03', G7_PREREQ, 14, true, { confidenceTier: 'B' }),
      ],
      'hsg_thi_chuyen',
    ),
  });

  // HC04 — G7, verified frontier at Grade-8 knowledge, prerequisites satisfied.
  cases.push({
    hardCaseId: 'HC04',
    label: 'G7 verified Grade-8 frontier, prereqs OK → FRONTIER, advanced>0, K4, current context real G7',
    grade: 7,
    expect: { frontierSelected: true, hasAboveGradeTarget: true, advancedBucketMin: 1, kMaxAtLeast: 'K4', currentLessonNodeType: 'CORE_CURRICULUM' },
    spec: specFor(
      'hc04',
      7,
      [
        ev('hc04', G7_CURRENT, 22, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
        ev('hc04', G7_CURRENT, 8, true, { confidenceTier: 'B' }),
        ev('hc04', G7_PREREQ, 20, true, { confidenceTier: 'B' }),
        ev('hc04', G7_UNLOCK, 16, true, { confidenceTier: 'A' }),
        ev('hc04', G7_UNLOCK, 10, true, { confidenceTier: 'A' }),
        ev('hc04', G7_BRIDGE_G8, 12, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
        ev('hc04', G7_BRIDGE_G8, 5, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ],
      'hsg_thi_chuyen',
    ),
  });

  // HC05 — G7, Grade-9 traction, Grade-8 bridge BLOCKING.
  const hc05Evidence = (child: string): Evidence[] => [
    ev(child, G7_CURRENT, 20, true, { confidenceTier: 'A' }),
    ev(child, G7_PREREQ, 18, true, { confidenceTier: 'B' }),
    ev(child, G7_UNLOCK, 16, true, { confidenceTier: 'A' }),
    ev(child, G7_UNLOCK, 10, true, { confidenceTier: 'A' }),
    ev(child, G7_FRONTIER_G9, 14, true, { confidenceTier: 'A' }),
    ev(child, G7_FRONTIER_G9, 4, true, { confidenceTier: 'A' }),
    // the Grade-8 bridge: repeated failing school work → a blocking gap
    ev(child, G7_BRIDGE_G8, 6, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ev(child, G7_BRIDGE_G8, 2, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ];
  const hc05Pipeline = pipeline('hc05', 7, hc05Evidence('hc05'), 'hsg_thi_chuyen', {
    resolvedLessonId: 'C.G7.6.21',
    activeSkillIds: [G7_CURRENT],
  });
  cases.push({
    hardCaseId: 'HC05',
    label: 'G7 Grade-9 traction + blocking Grade-8 bridge → Parallel Gap Repair, SYMMETRIC rejected on the bridge',
    grade: 7,
    expect: {
      prerequisiteRepairMin: 1,
      frontierSkillIsNot: G7_FRONTIER_G9, // the unsafe Grade-9 skill must NOT be a frontier target
    },
    spec: hc05Pipeline.spec,
    pipeline: hc05Pipeline,
  });

  // HC06 — HC05 child AFTER the Grade-8 algebra (bridge included) is mastered →
  // the SAME Grade-9 candidate (SYMMETRIC) becomes the next-safe frontier.
  const G7_FACTOR_G8 = 'M7.ALG.FACTOR'; // origin 8, sibling of SYMMETRIC (also depends on the bridge)
  const G7_MULTIVAR_G8 = 'M7.RATIO.MULTIVAR'; // origin 8
  const hc06Pipeline = pipeline(
    'hc06',
    7,
    [
      ...hc05Evidence('hc06').filter((e) => e.skillId !== asSkillId(G7_BRIDGE_G8)),
      // the SAME bridge, now mastered
      ev('hc06', G7_BRIDGE_G8, 12, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc06', G7_BRIDGE_G8, 8, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc06', G7_BRIDGE_G8, 3, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      // the rest of the Grade-8 algebra is done too → SYMMETRIC is the next safe step
      ev('hc06', G7_FACTOR_G8, 10, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc06', G7_FACTOR_G8, 4, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc06', G7_MULTIVAR_G8, 9, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc06', G7_MULTIVAR_G8, 3, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ],
    'hsg_thi_chuyen',
    { resolvedLessonId: 'C.G7.6.21', activeSkillIds: [G7_CURRENT] },
  );
  cases.push({
    hardCaseId: 'HC06',
    label: 'HC05 child, Grade-8 algebra (bridge included) mastered → the SAME Grade-9 candidate (SYMMETRIC) is now a selected FRONTIER target',
    grade: 7,
    expect: {
      frontierSelected: true,
      hasAboveGradeTarget: true,
      prerequisiteRepairMax: 0,
      frontierSkillIs: G7_FRONTIER_G9, // the SAME candidate rejected in HC05 is now selected
      // SYMMETRIC carried direct Grade-9 evidence into HC05, so once the block clears it
      // is a "revisit harder" MASTERED_FRONTIER_STRETCH, not a newly-unlocked NEXT_SAFE.
      frontierSkillSelectionReasonIn: ['NEXT_SAFE_FRONTIER', 'MASTERED_FRONTIER_STRETCH'],
    },
    spec: hc06Pipeline.spec,
    pipeline: hc06Pipeline,
  });

  // HC07 — G7 HSG goal, NO frontier evidence → HSG alone must not unlock above-grade K.
  cases.push({
    hardCaseId: 'HC07',
    label: 'G7 HSG goal, no frontier evidence → no FRONTIER, advanced=0, K<=K3, no auto T4/T5',
    grade: 7,
    expect: { frontierSelected: false, advancedBucketExactly: 0, kMaxAtMost: 'K3', tMaxAtMost: 'T3', noAboveGradeK: true },
    spec: specFor(
      'hc07',
      7,
      [
        ev('hc07', G7_CURRENT, 16, true, { confidenceTier: 'B' }),
        ev('hc07', G7_CURRENT, 8, true, { confidenceTier: 'B' }),
        ev('hc07', G7_PREREQ, 12, true, { confidenceTier: 'C' }),
      ],
      'hsg_thi_chuyen',
    ),
  });

  // HC08 — estimated context + frontier confidence near the threshold → conservative.
  cases.push({
    hardCaseId: 'HC08',
    label: 'weak/uncertain context + borderline frontier confidence → conservative, no unsafe above-grade jump',
    grade: 7,
    expect: { frontierSelected: false, advancedBucketExactly: 0, noAboveGradeK: true, contextConfidenceNot: 'VERIFIED' },
    spec: specFor(
      'hc08',
      7,
      [
        ev('hc08', G7_CURRENT, 30, true, { confidenceTier: 'C' }),
        // a single shaky above-grade observation — not enough for a trusted frontier
        ev('hc08', G7_FRONTIER_G9, 20, true, { confidenceTier: 'C', reasoningQuality: 'weak' }),
      ],
      'hsg_thi_chuyen',
    ),
  });

  // HC09 — TRUE ESTIMATED context: Curriculum Clock only, zero data (doc 14 C5.2 §2).
  // Brand-new child onboarding — no parent/teacher confirmation, no schoolwork.
  const clockOnly: ExpectedLearningContext = {
    curriculum: 'KET_NOI_TRI_THUC',
    chapterId: 6,
    lessonId: 'C.G7.6.21',
    alsoPlausibleLessonIds: ['C.G7.6.20', 'C.G7.6.22'],
    window: { fromLessonId: 'C.G7.6.19', toLessonId: 'C.G7.6.23', widthLessons: 2, lessonIds: ['C.G7.6.19', 'C.G7.6.20', 'C.G7.6.21', 'C.G7.6.22', 'C.G7.6.23'] },
    source: 'CURRICULUM_TIMELINE',
    confidence: 'ESTIMATED',
    asOfDate: '2027-02-01',
    paceDeltaApplied: 0,
    calendar: { calendarId: 'cal.KNTT.G7.2026-2027.v1', version: 1, status: 'PROVISIONAL', source: 'MOET + SGK KNTT', academicYear: '2026-2027' },
  };
  const hc09 = pipeline('hc09', 7, [], 'theo_sat_chuong_trinh', {
    expectedContext: clockOnly,
    resolvedLessonId: 'C.G7.6.21',
    activeSkillIds: [G7_CURRENT],
  });
  cases.push({
    hardCaseId: 'HC09',
    label: 'brand-new child, Curriculum Clock only (no evidence/confirmation) → ESTIMATED, conservative, pipeline usable',
    grade: 7,
    expect: {
      contextConfidenceIs: 'ESTIMATED',
      contextSourceIs: 'CURRICULUM_TIMELINE',
      frontierSelected: false,
      advancedBucketExactly: 0,
      noAboveGradeK: true,
      kMaxAtMost: 'K3',
      stretchRatioAtMost: 0.2,
    },
    spec: hc09.spec,
  });

  // HC10 — legitimate K5: strong VERIFIED above-grade frontier, prereqs satisfied,
  // frontier confidence past the STRONG threshold (doc 14 C5.2 §3). K5 is NOT a
  // consequence of the HSG goal — it is earned by the evidence. T is independently
  // determined (no strong-thinking problem-type evidence → T stays below T5).
  const strongG9 = (skill: string, child: string): Evidence[] =>
    [26, 20, 15, 10, 5].map((d, k) =>
      ev(child, skill, d, true, { source: k % 2 === 0 ? 'school_test' : 'school_exam', provenance: 'assessment', confidenceTier: 'A' }),
    );
  const hc10 = pipeline(
    'hc10',
    7,
    [
      ev('hc10', G7_CURRENT, 24, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('hc10', G7_PREREQ, 22, true, { confidenceTier: 'A' }),
      ...strongG9(G7_UNLOCK, 'hc10'),
      ...strongG9(G7_BRIDGE_G8, 'hc10'),
      ...strongG9(G7_FRONTIER_G9, 'hc10'),
    ],
    'hsg_thi_chuyen',
    { resolvedLessonId: 'C.G7.6.21', activeSkillIds: [G7_CURRENT] },
  );
  cases.push({
    hardCaseId: 'HC10',
    label: 'G7 strong VERIFIED Grade-9 frontier, prereqs OK, ready → FRONTIER K5, T independently determined',
    grade: 7,
    expect: {
      frontierSelected: true,
      hasAboveGradeTarget: true,
      advancedBucketMin: 1,
      kMaxAtLeast: 'K5',
      tMaxAtMost: 'T4', // K5 must NOT imply T5 — T is determined independently
    },
    spec: hc10.spec,
    pipeline: hc10,
  });

  return cases;
}
