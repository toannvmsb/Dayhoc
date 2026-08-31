import { asProblemTypeId, type ChildId, type ChildLearningTwin, type LearningReadiness, type SkillId } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapConfig } from './config.js';

export interface ReadinessConfig {
  readonly weights: {
    readonly prerequisiteMastery: number;
    readonly problemTypeMastery: number;
    readonly thinkingReadiness: number;
    readonly retentionConfidence: number;
  };
  readonly readyThreshold: number; // 0..1
  readonly repairFirstThreshold: number; // below this ⇒ hold the new skill
}

export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
  weights: {
    prerequisiteMastery: 0.45,
    problemTypeMastery: 0.2,
    thinkingReadiness: 0.2,
    retentionConfidence: 0.15,
  },
  readyThreshold: 0.6,
  repairFirstThreshold: 0.32,
};

/**
 * Learning readiness for a target skill (Math Core §25).
 *
 * Low readiness does NOT automatically stop advanced learning (Grade 7 rule):
 * unless prerequisites are critically weak, the engine recommends `parallel_repair`
 * — keep the path, add a gap-repair dose.
 */
export function computeReadiness(
  childId: ChildId,
  targetSkillId: SkillId,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
  gapConfig: GapConfig,
  config: ReadinessConfig = DEFAULT_READINESS_CONFIG,
): LearningReadiness {
  const prereqEdges = kb.prerequisites.filter((e) => e.to === targetSkillId);
  const weakPrerequisites: SkillId[] = [];

  let prereqScore = 1;
  if (prereqEdges.length > 0) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const edge of prereqEdges) {
      const m = twin.skillMastery.get(edge.from)?.mastery ?? 0;
      weightedSum += (m / 100) * edge.importance;
      weightTotal += edge.importance;
      if (m < gapConfig.weakPrerequisite) weakPrerequisites.push(edge.from);
    }
    prereqScore = weightTotal > 0 ? weightedSum / weightTotal : 1;
  }

  const skill = kb.skills.get(targetSkillId);
  const pts = kb.getProblemTypesForSkill(targetSkillId);
  const ptScores = pts
    .map((pt) => twin.problemTypeMastery.get(asProblemTypeId(pt.id))?.mastery)
    .filter((m): m is number => m !== undefined);
  const ptScore = ptScores.length > 0 ? avg(ptScores) / 100 : prereqScore;

  const thinkingScores = skill
    ? [...twin.thinkingProfile.entries()]
        .filter(([dim]) => skill.thinkingDimensions.includes(dim))
        .map(([, s]) => s.score / 100)
    : [];
  const thinkingScore = thinkingScores.length > 0 ? avg(thinkingScores) : prereqScore;

  const retentionScores = prereqEdges
    .map((e) => twin.skillMastery.get(e.from)?.retention)
    .filter((r): r is number => r !== undefined);
  const retentionScore = retentionScores.length > 0 ? avg(retentionScores) : 0.6;

  const w = config.weights;
  const readinessScore = clamp01(
    w.prerequisiteMastery * prereqScore +
      w.problemTypeMastery * ptScore +
      w.thinkingReadiness * thinkingScore +
      w.retentionConfidence * retentionScore,
  );

  const criticallyWeak = prereqEdges.some(
    (e) =>
      e.importance >= gapConfig.blockingImportance &&
      (twin.skillMastery.get(e.from)?.mastery ?? 0) < gapConfig.weakPrerequisite * 0.6,
  );

  const recommendation: LearningReadiness['recommendation'] =
    readinessScore >= config.readyThreshold
      ? 'ready'
      : criticallyWeak || readinessScore < config.repairFirstThreshold
        ? 'repair_first'
        : 'parallel_repair';

  return {
    childId,
    targetSkillId,
    readinessScore: round(readinessScore),
    breakdown: {
      prerequisiteMastery: round(prereqScore),
      problemTypeMastery: round(ptScore),
      thinkingReadiness: round(thinkingScore),
      retentionConfidence: round(retentionScore),
    },
    recommendation,
    weakPrerequisites: [...new Set(weakPrerequisites)],
  };
}

const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number): number => Math.round(x * 1000) / 1000;
