import {
  type ChildLearningTwin,
  type LearningContext,
  type PlannedAction,
  type SkillId,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { PlanningConfig } from './config.js';

export interface NblaInput {
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly context: LearningContext;
  readonly knowledgeBase: KnowledgeBase;
  readonly parentGoal?: string;
  readonly daysToExam?: number;
}

const MASTERY_TARGET = 70;

/**
 * Candidate Next Best Learning Actions with an ROI-per-minute estimate
 * (Math Core §40). The daily planner greedily fills the time budget from this
 * list, keeping to the Learning Mix proportions.
 */
export function candidateActions(input: NblaInput, config: PlanningConfig): PlannedAction[] {
  const { twin, gaps, context, knowledgeBase: kb } = input;
  const out: PlannedAction[] = [];
  const nameOf = (id: SkillId): string => kb.skills.get(id)?.name ?? id;

  // 1 — close each detected gap (highest-value first; blocking gaps rank up).
  for (const gap of gaps.gaps) {
    if (gap.type === 'careless_error') continue;
    const rx = gaps.prescriptions.find((p) => p.gapId === gap.id);
    const minutes = rx?.minutesPerSession ?? 10;
    const roi = clamp01(gap.score.score * (gap.blocksCurrentLearning ? 1.15 : 0.9));
    out.push({
      kind: gap.type === 'prerequisite_gap' ? 'review_prerequisite' : 'close_gap',
      mixBucket: 'gapRepair',
      targetSkillId: gap.rootSkillId,
      gapId: gap.id,
      estimatedMinutes: minutes,
      roiPerMinute: roi,
      parentFacingTitle: `Củng cố ${nameOf(gap.rootSkillId)}`,
      childFacingTitle: `Ôn ${nameOf(gap.rootSkillId)}`,
      rationale: gap.rationale,
    });
  }

  // 2 — practice the skills currently being taught (school bucket).
  for (const skillId of context.activeSkillIds.slice(0, 3)) {
    const state = twin.skillMastery.get(skillId);
    const mastery = state?.mastery ?? 40;
    if (mastery >= 90) continue;
    const roi = clamp01((MASTERY_TARGET + 20 - mastery) / 100) * 0.8;
    out.push({
      kind: 'practice_current_skill',
      mixBucket: 'school',
      targetSkillId: skillId,
      estimatedMinutes: 10,
      roiPerMinute: roi,
      parentFacingTitle: `Bài trên lớp — ${nameOf(skillId)}`,
      childFacingTitle: nameOf(skillId),
      rationale: 'Ôn lại nội dung con vừa học trên lớp.',
    });
  }

  // 3 — advanced extension when a strong active skill is "ready" to push further.
  for (const skillId of context.activeSkillIds) {
    const state = twin.skillMastery.get(skillId);
    if (!state || state.mastery < 75) continue;
    const dependents = kb.dependents(skillId);
    if (dependents.length === 0) continue;
    const next = dependents[0]!;
    out.push({
      kind: 'harder_problem_type',
      mixBucket: 'advanced',
      targetSkillId: next,
      estimatedMinutes: 8,
      roiPerMinute: clamp01(0.5 + (state.mastery - 75) / 100),
      parentFacingTitle: `Nâng cao — ${nameOf(next)}`,
      childFacingTitle: nameOf(next),
      rationale: `Con đã vững ${nameOf(skillId)}, thử bước tiếp theo.`,
    });
    break;
  }

  // 4 — a daily thinking challenge (Math Core §35). Always offer one.
  const thinkingChallengeSkill = pickThinkingChallenge(input);
  if (thinkingChallengeSkill) {
    out.push({
      kind: 'thinking_challenge',
      mixBucket: 'thinking',
      targetSkillId: thinkingChallengeSkill,
      estimatedMinutes: 6,
      roiPerMinute: input.parentGoal === 'phat_trien_tu_duy' || input.parentGoal === 'hsg_thi_chuyen' ? 0.7 : 0.5,
      parentFacingTitle: 'Thử thách tư duy',
      childFacingTitle: 'Thử thách',
      rationale: 'Một bài suy luận ngắn, con giải thích cách nghĩ sau khi làm.',
    });
  }

  // 5 — retention check for a skill verified long ago.
  for (const [skillId, state] of twin.skillMastery) {
    if (!state.lastVerifiedAt) continue;
    if (state.retention < 0.35 && state.mastery >= 55) {
      out.push({
        kind: 'retention_check',
        mixBucket: 'gapRepair',
        targetSkillId: skillId,
        estimatedMinutes: 4,
        roiPerMinute: clamp01(0.4 + (1 - state.retention) * 0.3),
        parentFacingTitle: `Kiểm tra lại — ${nameOf(skillId)}`,
        childFacingTitle: nameOf(skillId),
        rationale: 'Con lâu chưa ôn phần này, kiểm tra nhanh xem còn nhớ không.',
      });
      break;
    }
  }

  void config;
  return out.sort((a, b) => b.roiPerMinute - a.roiPerMinute);
}

function pickThinkingChallenge(input: NblaInput): SkillId | undefined {
  // A skill the child has some traction on, that carries thinking dimensions,
  // preferring one where thinking headroom exists.
  for (const skillId of input.context.activeSkillIds) {
    const skill = input.knowledgeBase.skills.get(skillId);
    if (skill && skill.thinkingDimensions.length > 0) return skillId;
  }
  return [...input.twin.skillMastery.keys()][0];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
