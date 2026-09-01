import {
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  asProblemTypeId,
  type ChildId,
  type ChildLearningTwin,
  type ExerciseDistribution,
  type ExerciseGenerationSpec,
  type KnowledgeLevel,
  type LearningContext,
  type ParentGoal,
  type SessionGoal,
  type SkillId,
  type SpecDifficulty,
  type SpecPrerequisiteGap,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapEngineResult } from '@copilot/gap-engine';
import { DEFAULT_PLANNING_CONFIG, type PlanningConfig } from './config.js';
import { computeLearningMix } from './learning-mix.js';

export const PLANNER_VERSION = 'exercise-spec.v1';
export const CURRICULUM_VERSION = 'dev-core.v1';

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 16;

export interface ExerciseSpecInput {
  readonly childId: ChildId;
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly context: LearningContext;
  readonly knowledgeBase: KnowledgeBase;
  readonly parentGoal?: ParentGoal;
  readonly availableMinutes: number;
  readonly daysToExam?: number;
  readonly asOf?: Date;
  readonly config?: PlanningConfig;
  readonly newId?: () => string;
}

const kLevel = (n: number): KnowledgeLevel => KNOWLEDGE_LEVELS[clampIdx(n, KNOWLEDGE_LEVELS.length)]!;
const tLevel = (n: number): ThinkingLevel => THINKING_LEVELS[clampIdx(n, THINKING_LEVELS.length)]!;
const kIdx = (k: KnowledgeLevel): number => KNOWLEDGE_LEVELS.indexOf(k);
const tIdx = (t: ThinkingLevel): number => THINKING_LEVELS.indexOf(t);
function clampIdx(n: number, len: number): number {
  return Math.max(0, Math.min(len - 1, Math.round(n)));
}

/**
 * buildExerciseGenerationSpec (doc 14 §3, C1) — the deterministic educational
 * contract. Pure function of (resolved context, KB graphs, twin, gaps,
 * readiness, frontier, parent goal, available time). AI never influences any
 * field here.
 */
export function buildExerciseGenerationSpec(input: ExerciseSpecInput): ExerciseGenerationSpec {
  const asOf = input.asOf ?? new Date();
  const config = input.config ?? DEFAULT_PLANNING_CONFIG;
  const kb = input.knowledgeBase;
  const parentGoal: ParentGoal = input.parentGoal ?? 'theo_sat_chuong_trinh';
  const goalIsAdvanced = parentGoal === 'phat_trien_tu_duy' || parentGoal === 'hsg_thi_chuyen';
  const goalIsHsg = parentGoal === 'hsg_thi_chuyen';
  let seq = 0;
  const newId = input.newId ?? (() => `${Date.now().toString(36)}${(seq++).toString(36)}`);

  const resolved = input.context.resolved;

  // --- targets: the resolved lesson's skills (fall back to active skills) ---
  const lessonSkillIds = resolved.lessonId
    ? [...kb.skills.values()].filter((s) => s.curriculumNodeId === resolved.lessonId).map((s) => s.id as SkillId)
    : [];
  const primaryTargets = dedupe(
    lessonSkillIds.length > 0
      ? lessonSkillIds
      : resolved.activeSkillIds.length > 0
        ? [...resolved.activeSkillIds]
        : [...input.context.activeSkillIds],
  ).filter((id) => kb.skills.has(id));

  // --- prerequisite gaps relevant to those targets ---
  const prereqGaps = collectPrereqGaps(input.gaps, primaryTargets, kb);
  const blockingPrereqs = prereqGaps.filter((g) => g.blocking);

  const targetSkillIds = dedupe([...primaryTargets, ...prereqGaps.map((g) => g.skillId)]).filter((id) =>
    kb.skills.has(id),
  );
  const problemTypeIds = dedupe(
    primaryTargets.flatMap((id) => kb.getProblemTypesForSkill(id).map((pt) => pt.id)),
  ).map(asProblemTypeId);

  // --- readiness for the primary target ---
  const readinessRec =
    input.gaps.readiness.find((r) => primaryTargets.includes(r.targetSkillId))?.recommendation ?? 'ready';

  // --- session goal ---
  const activeGaps = input.gaps.gaps.filter((g) => g.type !== 'careless_error' && g.score.band !== 'low');
  const sessionGoal: SessionGoal =
    input.daysToExam !== undefined && input.daysToExam <= config.examSoonDays
      ? 'exam_revision'
      : activeGaps.length > 0 || blockingPrereqs.length > 0
        ? 'gap_repair'
        : goalIsAdvanced && readinessRec === 'ready'
          ? 'stretch_and_thinking'
          : 'lesson_practice';

  // --- relevant mastery ---
  const relevantMastery: Record<string, number> = {};
  for (const id of targetSkillIds) {
    relevantMastery[id] = Math.round(input.twin.skillMastery.get(id)?.mastery ?? 0);
  }
  const primaryMastery =
    primaryTargets.length > 0
      ? primaryTargets.reduce((s, id) => s + (input.twin.skillMastery.get(id)?.mastery ?? 0), 0) / primaryTargets.length
      : 0;

  // --- thinking profile + frontier ---
  const thinkingProfile: Record<string, ThinkingLevel> = {};
  for (const [dim, st] of input.twin.thinkingProfile) {
    if (st.demonstratedLevel) thinkingProfile[dim] = st.demonstratedLevel;
  }
  const frontier: Record<string, string> = {};
  for (const f of input.twin.frontier) frontier[f.domain] = f.frontierLabel;
  const anyAboveGrade = input.twin.frontier.some((f) => f.aboveGrade);

  // --- total questions from available time ---
  const totalQuestions = Math.max(
    MIN_QUESTIONS,
    Math.min(MAX_QUESTIONS, Math.round(input.availableMinutes / config.minutesPerItem)),
  );

  // --- distribution: learning mix → 6 buckets → integer counts ---
  const { mix } = computeLearningMix(
    { twin: input.twin, gaps: input.gaps, parentGoal, asOf, ...(input.daysToExam !== undefined ? { daysToExam: input.daysToExam } : {}) },
    config,
  );
  const distribution = allocateDistribution({
    totalQuestions,
    mix,
    sessionGoal,
    hasPrereqGap: prereqGaps.length > 0,
    prereqBlocking: blockingPrereqs.length > 0,
    readiness: readinessRec,
    goalIsAdvanced,
    allowAdvanced: anyAboveGrade || goalIsAdvanced || primaryMastery >= config.strongStudentMastery,
  });

  const isEstimated = resolved.confidence === 'ESTIMATED';

  // --- difficulty ---
  const difficulty = deriveDifficulty({
    primaryMastery,
    hasPrereqRepair: distribution.prerequisiteRepair > 0,
    readiness: readinessRec,
    thinkingProfile: input.twin.thinkingProfile,
    goalIsAdvanced,
    goalIsHsg,
    anyAboveGrade,
    isEstimated,
  });

  return {
    generationSpecId: `egs_${newId()}`,
    childId: input.childId,
    createdAt: asOf.toISOString(),
    learningContext: {
      curriculum: input.context.expected?.curriculum ?? 'KET_NOI_TRI_THUC',
      expectedLessonId: input.context.expected?.lessonId ?? null,
      resolvedLessonId: resolved.lessonId,
      source: resolved.source,
      confidence: resolved.confidence,
      isEstimated,
    },
    goal: { parentGoal, sessionGoal },
    targets: { skillIds: targetSkillIds, problemTypeIds },
    childState: {
      relevantMastery,
      prerequisiteGaps: prereqGaps,
      readiness: readinessRec,
      thinkingProfile,
      actualLearningFrontier: frontier,
    },
    generationPlan: { totalQuestions, distribution },
    difficulty,
    constraints: {
      noUnlearnedRequiredKnowledge: true,
      allowAboveGradeReasoning: true,
      requireUniqueVariants: true,
      language: 'vi',
      ageAppropriate: true,
      maxSolutionComplexity: goalIsHsg ? 'high' : readinessRec === 'repair_first' ? 'low' : 'standard',
    },
    provenance: {
      plannerVersion: PLANNER_VERSION,
      curriculumVersion: CURRICULUM_VERSION,
      twinVersion: input.twin.computedAt,
      gapSnapshotVersion: input.gaps.computedAt,
    },
  };
}

// --- helpers -------------------------------------------------------------

function dedupe<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** Prerequisite gaps relevant to the target skills, from gaps + readiness. */
function collectPrereqGaps(
  gaps: GapEngineResult,
  targets: readonly SkillId[],
  kb: KnowledgeBase,
): SpecPrerequisiteGap[] {
  const closure = new Set<string>();
  for (const t of targets) for (const p of kb.prerequisiteClosure(t)) closure.add(p);

  const out = new Map<string, SpecPrerequisiteGap>();
  for (const g of gaps.gaps) {
    const sid = g.rootSkillId ?? g.targetSkillId;
    const relevant = g.type === 'prerequisite_gap' || g.blocksCurrentLearning || closure.has(sid);
    if (!relevant) continue;
    if (targets.includes(sid as SkillId) && g.type !== 'prerequisite_gap') continue; // that's the current skill, not a prereq
    out.set(sid, { skillId: sid as SkillId, severity: round2(g.severity), blocking: g.blocksCurrentLearning });
  }
  for (const r of gaps.readiness) {
    if (!targets.includes(r.targetSkillId)) continue;
    for (const wp of r.weakPrerequisites) {
      if (!out.has(wp)) out.set(wp, { skillId: wp, severity: 0.5, blocking: r.recommendation === 'repair_first' });
    }
  }
  return [...out.values()].sort((a, b) => b.severity - a.severity);
}

interface AllocInput {
  readonly totalQuestions: number;
  readonly mix: { school: number; gapRepair: number; advanced: number; thinking: number };
  readonly sessionGoal: SessionGoal;
  readonly hasPrereqGap: boolean;
  readonly prereqBlocking: boolean;
  readonly readiness: 'ready' | 'parallel_repair' | 'repair_first';
  readonly goalIsAdvanced: boolean;
  readonly allowAdvanced: boolean;
}

/**
 * Turn the learning mix into 6 integer buckets that sum EXACTLY to
 * totalQuestions. Distribution is derived from learning state — never a fixed
 * split (doc 14 C1.4). Invariants enforced afterwards:
 *  - readiness ≠ ready + a prereq gap → prerequisiteRepair ≥ 1
 *  - advanced goal / above-grade frontier + readiness allows → advanced ≥ 1,
 *    even while prerequisiteRepair ≥ 1 (Parallel Gap Repair)
 */
export function allocateDistribution(input: AllocInput): ExerciseDistribution {
  const { mix, totalQuestions: total } = input;
  // school share splits into current/variation/application; exam tilts to application.
  const schoolCurrent = input.sessionGoal === 'exam_revision' ? 0.4 : 0.5;
  const schoolVariation = 0.25;
  const schoolApplication = 1 - schoolCurrent - schoolVariation;

  const gapRepairShare = input.hasPrereqGap ? mix.gapRepair : 0;
  const weights: Record<keyof ExerciseDistribution, number> = {
    prerequisiteRepair: gapRepairShare,
    currentSkill: mix.school * schoolCurrent + (input.hasPrereqGap ? 0 : mix.gapRepair),
    variation: mix.school * schoolVariation,
    application: mix.school * schoolApplication,
    advanced: input.allowAdvanced ? mix.advanced : 0,
    thinkingChallenge: mix.thinking,
  };
  if (!input.allowAdvanced) weights.currentSkill += mix.advanced;

  let dist = largestRemainder(weights, total);

  // --- invariants ---
  if ((input.readiness !== 'ready' || input.prereqBlocking) && input.hasPrereqGap && dist.prerequisiteRepair < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'prerequisiteRepair'), 'prerequisiteRepair');
  }
  if (input.allowAdvanced && input.goalIsAdvanced && input.readiness !== 'repair_first' && dist.advanced < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'advanced'), 'advanced');
  }
  if (dist.currentSkill < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'currentSkill'), 'currentSkill');
  }
  return dist;
}

function largestRemainder(
  weights: Record<keyof ExerciseDistribution, number>,
  total: number,
): ExerciseDistribution {
  const sum = DISTRIBUTION_BUCKETS.reduce((s, b) => s + Math.max(0, weights[b]), 0) || 1;
  const exact = DISTRIBUTION_BUCKETS.map((b) => ({ b, v: (Math.max(0, weights[b]) / sum) * total }));
  const floors = exact.map((e) => ({ ...e, f: Math.floor(e.v), r: e.v - Math.floor(e.v) }));
  let used = floors.reduce((s, e) => s + e.f, 0);
  const order = [...floors].sort((a, b) => b.r - a.r);
  const out = Object.fromEntries(floors.map((e) => [e.b, e.f])) as unknown as Record<
    keyof ExerciseDistribution,
    number
  >;
  for (const e of order) {
    if (used >= total) break;
    out[e.b] += 1;
    used += 1;
  }
  return out as ExerciseDistribution;
}

function biggestDonor(dist: ExerciseDistribution, exclude: keyof ExerciseDistribution): keyof ExerciseDistribution {
  return DISTRIBUTION_BUCKETS.filter((b) => b !== exclude).sort((a, b) => dist[b] - dist[a])[0]!;
}

function moveOne(
  dist: ExerciseDistribution,
  from: keyof ExerciseDistribution,
  to: keyof ExerciseDistribution,
): ExerciseDistribution {
  if (dist[from] <= 0) return dist;
  return { ...dist, [from]: dist[from] - 1, [to]: dist[to] + 1 };
}

interface DiffInput {
  readonly primaryMastery: number;
  readonly hasPrereqRepair: boolean;
  readonly readiness: 'ready' | 'parallel_repair' | 'repair_first';
  readonly thinkingProfile: ChildLearningTwin['thinkingProfile'];
  readonly goalIsAdvanced: boolean;
  readonly goalIsHsg: boolean;
  readonly anyAboveGrade: boolean;
  /** Context is only a calendar estimate → be more conservative (invariant 10). */
  readonly isEstimated: boolean;
}

function deriveDifficulty(input: DiffInput): SpecDifficulty {
  // K: floor drops when we schedule prerequisite repair; ceiling rises with
  // mastery + goal + a real above-grade frontier (never past K5).
  const kMinIdx = input.hasPrereqRepair ? kIdx('K1') : kIdx('K2');
  let kMaxIdx = kIdx('K2');
  if (input.primaryMastery >= 70) kMaxIdx = kIdx('K3');
  if ((input.goalIsAdvanced || input.anyAboveGrade) && input.readiness !== 'repair_first') kMaxIdx = kIdx('K4');
  if (input.goalIsHsg && input.anyAboveGrade && input.readiness === 'ready') kMaxIdx = kIdx('K5');
  // an estimated context is not a firm basis for pushing the knowledge ceiling
  if (input.isEstimated) kMaxIdx = Math.min(kMaxIdx, kIdx('K3'));
  kMaxIdx = Math.max(kMaxIdx, kMinIdx);

  // T: from the demonstrated thinking level (+1 stretch), capped by goal.
  const demoLevels = [...input.thinkingProfile.values()]
    .map((s) => (s.demonstratedLevel ? tIdx(s.demonstratedLevel) : -1))
    .filter((i) => i >= 0);
  const demoMax = demoLevels.length > 0 ? Math.max(...demoLevels) : tIdx('T2');
  let tMaxIdx = demoMax + 1;
  if (!input.goalIsAdvanced) tMaxIdx = Math.min(tMaxIdx, tIdx('T4'));
  if (input.readiness === 'repair_first') tMaxIdx = Math.min(tMaxIdx, tIdx('T3'));
  const tMinIdx = input.hasPrereqRepair ? tIdx('T1') : tIdx('T2');
  tMaxIdx = Math.max(tMaxIdx, tMinIdx);

  const stretchRatio =
    input.readiness === 'repair_first' || input.isEstimated
      ? 0.15
      : input.goalIsAdvanced && input.primaryMastery >= 65
        ? 0.35
        : 0.25;

  return {
    kMin: kLevel(kMinIdx),
    kMax: kLevel(kMaxIdx),
    tMin: tLevel(tMinIdx),
    tMax: tLevel(tMaxIdx),
    stretchRatio,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
