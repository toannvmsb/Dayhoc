import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type Evidence,
  type ExerciseGenerationSpec,
  type ParentGoal,
} from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildExerciseGenerationSpec } from '@copilot/planning';
import { KB } from '../harness.js';

/**
 * HARD-CASE benchmark manifest (doc 14 C5.2 §B). A SEPARATE set of 8 synthetic
 * cases (HC01–HC08) that exercise DạyZi's educational differentiators the
 * golden twin/planner dataset does not: grade-level T4/T5, real above-grade
 * FRONTIER, Parallel Gap Repair, safe frontier progression, no-frontier HSG,
 * and conservative behaviour under uncertain context. Every spec is built
 * through the REAL deterministic pipeline (evidence → twin → gaps → context →
 * `buildExerciseGenerationSpec`); the `expect` block is machine-checkable.
 */
export const HARDCASE_MANIFEST_VERSION = 'luna-generation-benchmark.hardcase.v1';

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

function specFor(childId: string, grade: 4 | 7, evidence: Evidence[], parentGoal: ParentGoal): ExerciseGenerationSpec {
  const cid = asChildId(childId);
  const twin = buildLearningTwin({ childId: cid, gradeContext: grade, evidence, knowledgeBase: KB, asOf: AS_OF });
  const gaps = runGapEngine({ childId: cid, gradeContext: grade, twin, evidence, knowledgeBase: KB, parentGoal, asOf: AS_OF });
  const context = buildLearningContext({ childId: cid, gradeContext: grade, evidence, teacherContributions: [], knowledgeBase: KB, asOf: AS_OF });
  let i = 0;
  return buildExerciseGenerationSpec({
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
  readonly contextConfidenceNot?: string;
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
  cases.push({
    hardCaseId: 'HC05',
    label: 'G7 Grade-9 traction + blocking Grade-8 bridge → Parallel Gap Repair, unsafe G9 not selected',
    grade: 7,
    expect: {
      prerequisiteRepairMin: 1,
      frontierSkillIsNot: G7_FRONTIER_G9, // the unsafe Grade-9 skill must NOT be a frontier target
    },
    spec: specFor('hc05', 7, hc05Evidence('hc05'), 'hsg_thi_chuyen'),
  });

  // HC06 — HC05 child AFTER the Grade-8 bridge is mastered → next-safe frontier advances.
  cases.push({
    hardCaseId: 'HC06',
    label: 'HC05 child, Grade-8 bridge now mastered → next-safe frontier eligible, advances deterministically',
    grade: 7,
    expect: { frontierSelected: true, hasAboveGradeTarget: true, prerequisiteRepairMax: 0 },
    spec: specFor(
      'hc06',
      7,
      [
        ...hc05Evidence('hc06').filter((e) => e.skillId !== asSkillId(G7_BRIDGE_G8)),
        ev('hc06', G7_BRIDGE_G8, 7, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
        ev('hc06', G7_BRIDGE_G8, 3, true, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ],
      'hsg_thi_chuyen',
    ),
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

  return cases;
}
