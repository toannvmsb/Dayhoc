import {
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type ChildId,
  type ChildLearningTwin,
  type GradeContext,
  type DomainFrontierView,
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
import { assessThinking, selectLearningTargets, TARGET_SELECTOR_VERSION } from './target-selector.js';

export const PLANNER_VERSION = 'exercise-spec.v1';

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 16;

export interface ExerciseSpecInput {
  readonly childId: ChildId;
  /** The child's school grade — context for above-grade checks. */
  readonly gradeContext: GradeContext;
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

  // --- primary (current) targets: the resolved lesson's skills ---
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

  // --- readiness for the primary target ---
  const readinessRec =
    input.gaps.readiness.find((r) => primaryTargets.includes(r.targetSkillId))?.recommendation ?? 'ready';

  // --- deterministic target selection by role (doc 14 C4.1) ---
  const targets = selectLearningTargets({
    resolvedLessonId: resolved.lessonId,
    activeSkillIds: primaryTargets.length > 0 ? primaryTargets : [...input.context.activeSkillIds],
    gradeContext: input.gradeContext,
    twin: input.twin,
    gaps: input.gaps,
    knowledgeBase: kb,
    parentGoal,
    readiness: readinessRec,
  });

  // --- prerequisite gaps relevant to those targets ---
  const prereqGaps = collectPrereqGaps(input.gaps, primaryTargets, kb);
  const blockingPrereqs = prereqGaps.filter((g) => g.blocking);

  const targetSkillIds = dedupe(targets.all.map((t) => t.skillId));
  const problemTypeIds = targets.problemTypeIds;
  const hasFrontierTarget = targets.frontier.length > 0;
  const hasThinkingTarget = targets.thinking.length > 0;

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
  for (const id of dedupe([...targetSkillIds, ...prereqGaps.map((g) => g.skillId)])) {
    relevantMastery[id] = Math.round(input.twin.skillMastery.get(id)?.mastery ?? 0);
  }
  const primaryMastery =
    primaryTargets.length > 0
      ? primaryTargets.reduce((s, id) => s + (input.twin.skillMastery.get(id)?.mastery ?? 0), 0) / primaryTargets.length
      : 0;

  // --- thinking profile ---
  const thinkingProfile: Record<string, ThinkingLevel> = {};
  for (const [dim, st] of input.twin.thinkingProfile) {
    if (st.demonstratedLevel) thinkingProfile[dim] = st.demonstratedLevel;
  }

  // --- structured Actual Learning Frontier (doc 14 C4.1 §9 — no magic strings) ---
  const actualLearningFrontier: Record<string, DomainFrontierView> = {};
  for (const f of input.twin.frontier) {
    actualLearningFrontier[f.domain] = {
      reachedCurriculumOrigin: f.reachedCurriculumOrigin,
      aboveGrade: f.aboveGrade,
      confidence: f.confidence,
      evidenceCount: f.evidenceCount,
      masteredSkillIds: [...f.masteredSkillIds],
      readyNextSkillIds: [...f.readyNextSkillIds],
      exposureSkillIds: [...f.exposureSkillIds],
    };
  }
  const anyAboveGrade = input.twin.frontier.some((f) => f.aboveGrade);

  // --- total questions from available time ---
  const totalQuestions = Math.max(
    MIN_QUESTIONS,
    Math.min(MAX_QUESTIONS, Math.round(input.availableMinutes / config.minutesPerItem)),
  );

  const { strongThinking } = assessThinking(input.twin.thinkingProfile);

  // --- distribution: learning mix → 6 buckets → integer counts ---
  const { mix } = computeLearningMix(
    { twin: input.twin, gaps: input.gaps, parentGoal, asOf, ...(input.daysToExam !== undefined ? { daysToExam: input.daysToExam } : {}) },
    config,
  );
  const distribution = allocateDistribution({
    totalQuestions,
    mix,
    sessionGoal,
    hasPrereqGap: targets.prerequisiteRepair.length > 0,
    prereqBlocking: blockingPrereqs.length > 0,
    readiness: readinessRec,
    goalIsAdvanced,
    // ADVANCED KNOWLEDGE only when a FRONTIER target was actually selected (§6/§7)
    allowAdvanced: hasFrontierTarget,
    aboveGradeFrontier: hasFrontierTarget,
    // ADVANCED THINKING only when a THINKING target exists
    allowThinkingChallenge: hasThinkingTarget,
    strongThinking,
  });

  const isEstimated = resolved.confidence === 'ESTIMATED';

  // --- difficulty ---
  const frontierCeilingIdx =
    targets.frontier.length > 0
      ? Math.max(...targets.frontier.map((t) => KNOWLEDGE_LEVELS.indexOf(t.knowledgeCeiling)))
      : null;
  const difficulty = deriveDifficulty({
    primaryMastery,
    hasPrereqRepair: distribution.prerequisiteRepair > 0,
    readiness: readinessRec,
    thinkingProfile: input.twin.thinkingProfile,
    goalIsAdvanced,
    goalIsHsg,
    anyAboveGrade,
    frontierCeilingIdx,
    isEstimated,
  });

  return {
    generationSpecId: `egs_${newId()}`,
    childId: input.childId,
    createdAt: asOf.toISOString(),
    schoolGrade: input.gradeContext,
    learningContext: {
      curriculum: input.context.expected?.curriculum ?? 'KET_NOI_TRI_THUC',
      expectedLessonId: input.context.expected?.lessonId ?? null,
      resolvedLessonId: resolved.lessonId,
      source: resolved.source,
      confidence: resolved.confidence,
      isEstimated,
    },
    goal: { parentGoal, sessionGoal },
    targets: { skills: targets.all, skillIds: targetSkillIds, problemTypeIds },
    childState: {
      relevantMastery,
      prerequisiteGaps: prereqGaps,
      readiness: readinessRec,
      thinkingProfile,
      actualLearningFrontier,
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
      targetSelectorVersion: TARGET_SELECTOR_VERSION,
      curriculumRevision: kb.provenance.datasetRevision,
      curriculumContentHash: kb.provenance.contentHash,
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
  /** A FRONTIER role target was selected — ADVANCED KNOWLEDGE has somewhere to run. */
  readonly allowAdvanced: boolean;
  readonly aboveGradeFrontier: boolean;
  /** A THINKING role target was selected — ADVANCED THINKING has somewhere to run. */
  readonly allowThinkingChallenge: boolean;
  /** Demonstrated ≥ T3 with real evidence — guarantees a thinking-challenge slot. */
  readonly strongThinking: boolean;
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
  // ADVANCED KNOWLEDGE runs ONLY on a selected FRONTIER target (§6/§7).
  const advancedAllowed = input.allowAdvanced;
  const thinkingAllowed = input.allowThinkingChallenge;
  const weights: Record<keyof ExerciseDistribution, number> = {
    prerequisiteRepair: gapRepairShare,
    currentSkill: mix.school * schoolCurrent + (input.hasPrereqGap ? 0 : mix.gapRepair),
    variation: mix.school * schoolVariation,
    application: mix.school * schoolApplication,
    advanced: advancedAllowed ? mix.advanced : 0,
    thinkingChallenge: thinkingAllowed ? mix.thinking : 0,
  };
  // budget with no target to run on falls back to current-skill work
  if (!advancedAllowed) weights.currentSkill += mix.advanced;
  if (!thinkingAllowed) weights.currentSkill += mix.thinking;

  let dist = largestRemainder(weights, total);

  // --- invariants ---
  if ((input.readiness !== 'ready' || input.prereqBlocking) && input.hasPrereqGap && dist.prerequisiteRepair < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'prerequisiteRepair'), 'prerequisiteRepair');
  }
  // Parallel Gap Repair — a FRONTIER target + advanced goal keeps advanced ≥ 1
  // even while prerequisiteRepair ≥ 1.
  if (advancedAllowed && input.goalIsAdvanced && input.readiness !== 'repair_first' && dist.advanced < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'advanced'), 'advanced');
  }
  // strong demonstrated thinking + a THINKING target → always ≥ 1 thinking challenge
  if (thinkingAllowed && input.strongThinking && input.readiness !== 'repair_first' && dist.thinkingChallenge < 1) {
    dist = moveOne(dist, biggestDonor(dist, 'thinkingChallenge'), 'thinkingChallenge');
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
  /** Highest K a selected FRONTIER target permits (null when no frontier target). */
  readonly frontierCeilingIdx: number | null;
  /** Context is only a calendar estimate → be more conservative (invariant 10). */
  readonly isEstimated: boolean;
}


function deriveDifficulty(input: DiffInput): SpecDifficulty {
  // K: floor drops when we schedule prerequisite repair. The ceiling is
  // grade-level (≤ K3) UNLESS a FRONTIER target was selected — then it rises to
  // that target's evidence-gated ceiling (§4/§7/§10). Parent goal never lifts K
  // on its own.
  const kMinIdx = input.hasPrereqRepair ? kIdx('K1') : kIdx('K2');
  let kMaxIdx = input.primaryMastery >= 70 ? kIdx('K3') : kIdx('K2');
  if (input.frontierCeilingIdx !== null && input.readiness !== 'repair_first') {
    kMaxIdx = Math.max(kMaxIdx, input.frontierCeilingIdx);
  }
  // an estimated context is not a firm basis for pushing the knowledge ceiling
  if (input.isEstimated) kMaxIdx = Math.min(kMaxIdx, kIdx('K3'));
  kMaxIdx = Math.max(kMaxIdx, kMinIdx);

  // T: driven by the DEMONSTRATED thinking level + evidence, then parent goal +
  // readiness — never raised just because the parent picked HSG (doc 14 C3.1 §A).
  //   demonstrated level → CONTROLLED next stretch, no arbitrary jump.
  //   T5 ≠ above-grade knowledge — a Grade-7-knowledge item can still be T5.
  const { demoMax, strongThinking } = assessThinking(input.thinkingProfile);

  let tMaxIdx = demoMax + 1; // controlled +1 stretch is the default
  if (input.readiness === 'ready' && strongThinking) {
    // HSG + ready + strong thinking → controlled 2-step stretch, T5 reachable;
    // other advanced goals → +1 but T5 still reachable.
    tMaxIdx = input.goalIsHsg ? Math.min(demoMax + 2, tIdx('T5')) : input.goalIsAdvanced ? Math.min(demoMax + 1, tIdx('T5')) : tMaxIdx;
  }
  // a plain school goal caps at T4 (Thinking Challenge still allowed, allocation differs)
  if (!input.goalIsAdvanced) tMaxIdx = Math.min(tMaxIdx, tIdx('T4'));
  if (input.readiness === 'repair_first') tMaxIdx = Math.min(tMaxIdx, tIdx('T3'));
  if (input.isEstimated) tMaxIdx = Math.min(tMaxIdx, tIdx('T4'));
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
