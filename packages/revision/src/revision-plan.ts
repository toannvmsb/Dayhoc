import {
  asSkillId,
  type ChildId,
  type ChildLearningTwin,
  type Exam,
  type RevisionPlan,
  type RevisionPriorityItem,
  type SkillId,
} from '@copilot/domain';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { KnowledgeBase } from '@copilot/math-data';

export interface RevisionPlanInput {
  readonly childId: ChildId;
  readonly exam: Exam;
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf: Date;
  readonly dailyMinutes?: number;
}

/**
 * Build a personalised revision plan (Math Core §28).
 *
 *   revision_priority = probability_in_exam × knowledge_gap × forgetting
 *                     × importance × prerequisite_impact
 *
 * A skill fully in scope that the child has forgotten and that gates other
 * scope items ends up highest.
 */
export function buildRevisionPlan(input: RevisionPlanInput): RevisionPlan {
  const { exam, twin, gaps, knowledgeBase: kb } = input;
  const scope = new Set<SkillId>(exam.scopeSkillIds ?? exam.inferredScope?.skillIds ?? []);

  const dayCountdown = Math.max(
    0,
    Math.ceil((Date.parse(`${exam.examDate}T00:00:00Z`) - input.asOf.getTime()) / 86_400_000),
  );

  const gapBySkill = new Map(gaps.gaps.map((g) => [g.rootSkillId, g]));

  const items: RevisionPriorityItem[] = [...scope]
    .map((skillId) => {
      const skill = kb.skills.get(skillId);
      const state = twin.skillMastery.get(skillId);
      const mastery = state?.mastery ?? 40;
      const gap = gapBySkill.get(skillId);

      const probabilityInExam = 1; // in declared/inferred scope
      const knowledgeGap = clamp01((70 - mastery) / 70);
      const forgetting = state?.retention !== undefined ? clamp01(1 - state.retention) : 0.5;
      const importance = skill ? maxOutImportance(skillId, kb) : 0.5;
      const prerequisiteImpact = clamp01(kb.dependents(skillId).length / 6);

      const priority = clamp01(
        probabilityInExam *
          (0.25 + 0.75 * knowledgeGap) *
          (0.4 + 0.6 * forgetting) *
          (0.4 + 0.6 * importance) *
          (0.5 + 0.5 * prerequisiteImpact) *
          1.6,
      );

      const band: RevisionPriorityItem['band'] =
        priority >= 0.5 ? 'ưu_tiên_cao' : priority >= 0.28 ? 'nhắc_lại' : 'đã_ổn';

      return {
        skillId,
        name: skill?.name ?? skillId,
        priority: round(priority),
        band,
        reason: gap
          ? gap.rationale
          : band === 'đã_ổn'
            ? 'Con đã vững phần này, chỉ cần nhắc nhẹ.'
            : 'Lâu chưa ôn, nên xem lại trước kỳ kiểm tra.',
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return {
    childId: input.childId,
    examId: exam.id,
    dayCountdown,
    dailyMinutes: input.dailyMinutes ?? 20,
    priorityItems: items,
    createdAt: input.asOf.toISOString(),
  };
}

function maxOutImportance(skillId: SkillId, kb: KnowledgeBase): number {
  const edges = kb.prerequisites.filter((e) => e.from === skillId);
  return edges.length > 0 ? Math.max(...edges.map((e) => e.importance)) : 0.4;
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number): number => Math.round(x * 1000) / 1000;

export { asSkillId };
