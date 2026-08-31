import { asSkillId, type ChildLearningTwin, type Exam, type LearningContext, type SkillId } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

/**
 * Infer an exam scope from recent learning context when no official scope is
 * given (Math Core §28, UI/UX Spec §11). The exam flow must work with only a
 * date + recent context — this fills the gap and asks the parent to confirm.
 */
export function inferExamScope(
  context: LearningContext,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
  recencyWeeks = 6,
): NonNullable<Exam['inferredScope']> {
  void recencyWeeks;
  const candidate = new Set<SkillId>();

  // recently taught / actively practised
  for (const id of [...context.actualTaughtPosition.skillIds, ...context.activeSkillIds]) {
    if (kb.skills.has(id)) candidate.add(id);
  }
  // plus their direct prerequisites in the same grade (commonly examined together)
  for (const id of [...candidate]) {
    for (const pre of kb.directPrerequisites(id)) {
      const s = kb.skills.get(pre);
      const target = kb.skills.get(id);
      if (s && target && s.gradeContext === target.gradeContext) candidate.add(pre);
    }
  }

  const skillIds = [...candidate].sort();
  // confidence: higher when a teacher confirmed the taught position and there is
  // a decent amount of evidence behind it.
  const evidenceDepth = [...twin.skillMastery.values()].filter((s) => s.evidenceCount > 0).length;
  const confidence = clamp01(
    (context.teacherParticipated ? 0.45 : 0.25) + Math.min(0.4, evidenceDepth * 0.06),
  );

  return {
    skillIds: skillIds.map(asSkillId),
    confidence: round(confidence),
    needsParentConfirm: confidence < 0.7,
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number): number => Math.round(x * 100) / 100;
