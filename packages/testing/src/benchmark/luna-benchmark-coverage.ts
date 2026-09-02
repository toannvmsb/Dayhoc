import {
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type ExerciseGenerationSpec,
  type GeneratedExerciseBatch,
} from '@copilot/domain';
import { verifyItemAnswer } from '@copilot/exercise-gen';
import { KB } from '../harness.js';

/**
 * Benchmark coverage matrix + live-readiness decision (doc 14 C5.2 §F/§G).
 * Everything here is derived from SYNTHETIC specs / MOCK-generated batches — no
 * paid call. No hidden GAP: any uncovered cell is reported explicitly.
 */

export interface CoverageCase {
  readonly id: string;
  readonly kind: 'base' | 'hardcase';
  readonly spec: ExerciseGenerationSpec;
}

export interface CoverageMatrix {
  readonly totalCases: number;
  readonly baseCases: number;
  readonly hardCases: number;
  readonly grade: Readonly<Record<'g4' | 'g7', number>>;
  readonly targetRole: Readonly<Record<'CURRENT' | 'PREREQUISITE_REPAIR' | 'FRONTIER' | 'THINKING', number>>;
  readonly knowledgeLevel: Readonly<Record<string, number>>; // K1..K5
  readonly thinkingLevel: Readonly<Record<string, number>>; // T1..T5
  readonly contextConfidence: Readonly<Record<string, number>>; // ESTIMATED/SUPPORTING/STRONG/VERIFIED
  readonly parentGoal: Readonly<Record<string, number>>;
  readonly parallelGapRepair: number;
  readonly aboveGradeFrontier: number;
  readonly gradeLevelT4T5: number;
  /** Filled by `probeAnswerCoverage` from mock-generated batches. */
  readonly answerFormatType: Readonly<Record<string, number>>;
  readonly answerVerificationLevel: Readonly<Record<string, number>>;
  /** Human-readable list of dimensions that have ZERO cases. */
  readonly uncovered: readonly string[];
}

const kIdx = (k: string) => KNOWLEDGE_LEVELS.indexOf(k as never);
const tIdx = (t: string) => THINKING_LEVELS.indexOf(t as never);

export function computeCoverageMatrix(cases: readonly CoverageCase[]): CoverageMatrix {
  const grade = { g4: 0, g7: 0 };
  const targetRole = { CURRENT: 0, PREREQUISITE_REPAIR: 0, FRONTIER: 0, THINKING: 0 };
  const knowledgeLevel: Record<string, number> = { K1: 0, K2: 0, K3: 0, K4: 0, K5: 0 };
  const thinkingLevel: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 };
  const contextConfidence: Record<string, number> = { ESTIMATED: 0, SUPPORTING: 0, STRONG: 0, VERIFIED: 0 };
  const parentGoal: Record<string, number> = {};
  let parallelGapRepair = 0;
  let aboveGradeFrontier = 0;
  let gradeLevelT4T5 = 0;

  for (const c of cases) {
    const s = c.spec;
    if (s.schoolGrade === 4) grade.g4 += 1;
    if (s.schoolGrade === 7) grade.g7 += 1;

    const roles = new Set(s.targets.skills.map((t) => t.role));
    for (const r of roles) targetRole[r] += 1;

    for (let i = kIdx(s.difficulty.kMin); i <= kIdx(s.difficulty.kMax); i++) {
      const lvl = KNOWLEDGE_LEVELS[i];
      if (lvl && knowledgeLevel[lvl] !== undefined) knowledgeLevel[lvl] += 1;
    }
    for (let i = tIdx(s.difficulty.tMin); i <= tIdx(s.difficulty.tMax); i++) {
      const lvl = THINKING_LEVELS[i];
      if (lvl && thinkingLevel[lvl] !== undefined) thinkingLevel[lvl] += 1;
    }

    contextConfidence[s.learningContext.confidence] = (contextConfidence[s.learningContext.confidence] ?? 0) + 1;
    parentGoal[s.goal.parentGoal] = (parentGoal[s.goal.parentGoal] ?? 0) + 1;

    const d = s.generationPlan.distribution;
    if (d.prerequisiteRepair > 0 && s.targets.skills.some((t) => t.role !== 'PREREQUISITE_REPAIR')) parallelGapRepair += 1;

    const hasAboveGradeFrontier = s.targets.skills.some((t) => t.role === 'FRONTIER' && t.curriculumOrigin > s.schoolGrade);
    if (hasAboveGradeFrontier) aboveGradeFrontier += 1;

    if (tIdx(s.difficulty.tMax) >= tIdx('T4') && kIdx(s.difficulty.kMax) <= kIdx('K3')) gradeLevelT4T5 += 1;
  }

  const uncovered: string[] = [];
  const noteZero = (label: string, n: number) => {
    if (n === 0) uncovered.push(label);
  };
  noteZero('grade-4', grade.g4);
  noteZero('grade-7', grade.g7);
  for (const r of Object.keys(targetRole) as (keyof typeof targetRole)[]) noteZero(`target role ${r}`, targetRole[r]);
  for (const k of ['K1', 'K2', 'K3', 'K4', 'K5']) noteZero(`knowledge ${k}`, knowledgeLevel[k] ?? 0);
  for (const t of ['T1', 'T2', 'T3', 'T4', 'T5']) noteZero(`thinking ${t}`, thinkingLevel[t] ?? 0);
  for (const cc of ['ESTIMATED', 'SUPPORTING', 'STRONG', 'VERIFIED']) noteZero(`context confidence ${cc}`, contextConfidence[cc] ?? 0);
  noteZero('Parallel Gap Repair', parallelGapRepair);
  noteZero('above-grade FRONTIER', aboveGradeFrontier);
  noteZero('grade-level T4/T5', gradeLevelT4T5);
  for (const g of ['theo_sat_chuong_trinh', 'kha_gioi', 'phat_trien_tu_duy', 'hsg_thi_chuyen']) noteZero(`parent goal ${g}`, parentGoal[g] ?? 0);

  return {
    totalCases: cases.length,
    baseCases: cases.filter((c) => c.kind === 'base').length,
    hardCases: cases.filter((c) => c.kind === 'hardcase').length,
    grade,
    targetRole,
    knowledgeLevel,
    thinkingLevel,
    contextConfidence,
    parentGoal,
    parallelGapRepair,
    aboveGradeFrontier,
    gradeLevelT4T5,
    answerFormatType: {},
    answerVerificationLevel: {},
    uncovered,
  };
}

/** Fill answer-format + verification coverage from MOCK-generated batches (deterministic, no network). */
export function probeAnswerCoverage(
  matrix: CoverageMatrix,
  batches: readonly GeneratedExerciseBatch[],
): CoverageMatrix {
  const answerFormatType: Record<string, number> = {};
  const answerVerificationLevel: Record<string, number> = {};
  for (const b of batches) {
    for (const item of b.items) {
      answerFormatType[item.answerSpec.kind] = (answerFormatType[item.answerSpec.kind] ?? 0) + 1;
      const level = verifyItemAnswer(item).level;
      answerVerificationLevel[level] = (answerVerificationLevel[level] ?? 0) + 1;
    }
  }
  const uncovered = [...matrix.uncovered];
  for (const fmt of ['numeric', 'fraction', 'choice', 'exact', 'reasoning']) {
    if (!answerFormatType[fmt]) uncovered.push(`answer format ${fmt}`);
  }
  if (!answerVerificationLevel.DETERMINISTIC_CORRECTNESS_VERIFIED) uncovered.push('deterministic-correctness-supported answer item');
  if (!(answerVerificationLevel.AI_CROSSCHECK_REQUIRED || answerVerificationLevel.FORMAT_VERIFIED)) {
    uncovered.push('crosscheck-required answer item');
  }
  return { ...matrix, answerFormatType, answerVerificationLevel, uncovered };
}

// --- live readiness decision (doc 14 C5.2 §G) --------------------------------

export interface BenchmarkReadiness {
  readonly benchmarkReady: boolean;
  readonly blockingCoverageGaps: readonly string[];
  readonly nonBlockingCoverageGaps: readonly string[];
  readonly hardCaseCount: number;
  readonly baseCaseCount: number;
  readonly totalCaseCount: number;
  readonly adversarialTestsPassed: boolean;
  readonly buildGatesGreen: boolean;
}

export interface ReadinessInput {
  readonly matrix: CoverageMatrix;
  readonly adversarialTestsPassed: boolean;
  readonly buildGatesGreen: boolean;
  /** Whether the HC05→HC06 test proved the SAME Grade-9 candidate opens after bridge repair (doc 14 C5.2 §1). */
  readonly frontierProgressionProven: boolean;
}

/**
 * Coverage cells whose absence BLOCKS the live benchmark (doc 14 C5.2 §G,
 * revised §5). Everything else that is uncovered is a NON-blocking gap and is
 * still reported.
 */
const BLOCKING_DIMENSIONS: readonly string[] = [
  'grade-4',
  'grade-7',
  'above-grade FRONTIER',
  'grade-level T4/T5',
  'knowledge K4',
  'knowledge K5',
  'thinking T4',
  'thinking T5',
  'Parallel Gap Repair',
  'parent goal hsg_thi_chuyen',
  'target role FRONTIER',
  'target role THINKING',
  'context confidence ESTIMATED',
  'context confidence SUPPORTING',
  'context confidence STRONG',
  'context confidence VERIFIED',
];

export function assessBenchmarkReadiness(input: ReadinessInput): BenchmarkReadiness {
  const m = input.matrix;
  const isBlocking = (gap: string): boolean => BLOCKING_DIMENSIONS.includes(gap);

  const blockingCoverageGaps = m.uncovered.filter(isBlocking);
  const nonBlockingCoverageGaps = m.uncovered.filter((g) => !isBlocking(g));

  // explicit criteria from doc 14 C5.2 §G (revised §5)
  const criteria: Array<[string, boolean]> = [
    ['grade 4 and grade 7 covered', m.grade.g4 > 0 && m.grade.g7 > 0],
    ['FRONTIER covered', m.aboveGradeFrontier > 0 && m.targetRole.FRONTIER > 0],
    ['K4 covered', (m.knowledgeLevel.K4 ?? 0) > 0],
    ['K5 covered', (m.knowledgeLevel.K5 ?? 0) > 0],
    ['T4 covered', (m.thinkingLevel.T4 ?? 0) > 0],
    ['T5 covered', (m.thinkingLevel.T5 ?? 0) > 0],
    ['grade-level T4/T5 covered', m.gradeLevelT4T5 > 0],
    ['Parallel Gap Repair covered', m.parallelGapRepair > 0],
    ['HC05→HC06 proves an actual frontier progression', input.frontierProgressionProven],
    ['no-frontier HSG covered', (m.parentGoal.hsg_thi_chuyen ?? 0) > 0],
    ['ESTIMATED curriculum-only context covered', (m.contextConfidence.ESTIMATED ?? 0) > 0],
    ['SUPPORTING / STRONG / VERIFIED represented', (m.contextConfidence.SUPPORTING ?? 0) > 0 && (m.contextConfidence.STRONG ?? 0) > 0 && (m.contextConfidence.VERIFIED ?? 0) > 0],
    ['adversarial validator tests pass', input.adversarialTestsPassed],
    ['build / golden / lint / typecheck / web-build green', input.buildGatesGreen],
  ];
  const failed = criteria.filter(([, ok]) => !ok).map(([name]) => name);

  return {
    benchmarkReady: failed.length === 0 && blockingCoverageGaps.length === 0,
    blockingCoverageGaps: [...blockingCoverageGaps, ...failed.map((f) => `criterion not met: ${f}`)],
    nonBlockingCoverageGaps,
    hardCaseCount: m.hardCases,
    baseCaseCount: m.baseCases,
    totalCaseCount: m.totalCases,
    adversarialTestsPassed: input.adversarialTestsPassed,
    buildGatesGreen: input.buildGatesGreen,
  };
}

export { KB };
