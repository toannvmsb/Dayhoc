import type { ChildLearningTwin, GapScoreBreakdown, SkillId } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapConfig } from './config.js';
import type { GapFinding } from './detect.js';

/**
 * gap_score (Math Core §21) — a multiplicative priority.
 *
 *   score = mastery_difference × evidence_confidence × recurrence
 *         × prerequisite_importance × future_dependency × goal_weight
 *
 * A small gap can outrank a large one when it blocks upcoming learning
 * (`future_dependency`).
 */
export function scoreGap(
  finding: GapFinding,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
  config: GapConfig,
  parentGoal: string | undefined,
): GapScoreBreakdown {
  const rootState = twin.skillMastery.get(finding.rootSkillId);
  const currentMastery = rootState?.mastery ?? 0;

  const targetMasteryDifference = clamp01((config.masteryTarget - currentMastery) / config.masteryTarget);
  const evidenceConfidence = clamp01(rootState?.confidence ?? 0.2);

  const streak = rootState?.recentErrorStreak ?? 0;
  const recurrenceFactor = Math.min(2, 1 + streak * 0.35);

  // Importance = the strongest prerequisite edge OUT of the root (what it gates).
  const outEdges = kb.prerequisites.filter((e) => e.from === finding.rootSkillId);
  const prerequisiteImportance =
    outEdges.length > 0 ? Math.max(...outEdges.map((e) => e.importance)) : 0.4;

  // Future dependency = share of the graph transitively downstream of the root.
  const downstream = transitiveDependents(finding.rootSkillId, kb);
  const futureDependency = clamp01(downstream.size / Math.max(8, kb.skills.size / 3));

  const goalWeight = parentGoal ? (config.goalWeight[parentGoal] ?? 0.85) : 0.85;

  const raw =
    targetMasteryDifference *
    evidenceConfidence *
    (recurrenceFactor / 2) *
    prerequisiteImportance *
    (0.4 + 0.6 * futureDependency) *
    goalWeight;
  const score = clamp01(raw * 1.9); // spread into a usable 0..1 band

  const band: GapScoreBreakdown['band'] =
    score >= config.scoreBands.high ? 'high' : score >= config.scoreBands.medium ? 'medium' : 'low';

  return {
    targetMasteryDifference: round(targetMasteryDifference),
    evidenceConfidence: round(evidenceConfidence),
    recurrenceFactor: round(recurrenceFactor),
    prerequisiteImportance: round(prerequisiteImportance),
    futureDependency: round(futureDependency),
    learningGoalWeight: round(goalWeight),
    score: round(score),
    band,
  };
}

function transitiveDependents(skillId: SkillId, kb: KnowledgeBase): Set<SkillId> {
  const seen = new Set<SkillId>();
  const queue = [...kb.dependents(skillId)];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...kb.dependents(next));
  }
  return seen;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
