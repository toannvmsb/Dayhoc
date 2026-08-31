import {
  type AssessmentDiagnosis,
  type AssessmentQuestionOutcome,
  type ChildId,
  type ChildLearningTwin,
  type GapType,
  type LostPoint,
  type SkillId,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

export interface DiagnoseInput {
  readonly childId: ChildId;
  readonly examId: string;
  readonly outcomes: readonly AssessmentQuestionOutcome[];
  readonly twin: ChildLearningTwin;
  readonly knowledgeBase: KnowledgeBase;
}

/**
 * Post-exam diagnosis (Math Core §29): classify each lost point rather than
 * treating every dropped mark as the same weakness. Deterministic — uses the
 * same signal logic as the gap engine but scoped to a single assessment.
 */
export function diagnoseAssessment(input: DiagnoseInput): AssessmentDiagnosis {
  const { twin, knowledgeBase: kb } = input;
  let awardedSum = 0;

  const lostPoints: LostPoint[] = [];
  for (const o of input.outcomes) {
    awardedSum += o.awardedScore;
    if (o.awardedScore >= 0.95) continue;

    const classification = classifyLostPoint(o, twin, kb);
    lostPoints.push({
      questionRef: o.questionRef,
      skillId: o.skillId,
      lostFraction: Number((1 - o.awardedScore).toFixed(2)),
      classification,
      note: NOTE[classification],
    });
  }

  // remediation order: biggest aggregate loss per skill, worst first
  const lossBySkill = new Map<SkillId, number>();
  for (const lp of lostPoints) {
    lossBySkill.set(lp.skillId, (lossBySkill.get(lp.skillId) ?? 0) + lp.lostFraction);
  }
  const remediationSkillIds = [...lossBySkill.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return {
    childId: input.childId,
    examId: input.examId,
    totalAwarded: input.outcomes.length > 0 ? Number((awardedSum / input.outcomes.length).toFixed(2)) : 0,
    lostPoints,
    remediationSkillIds,
  };
}

function classifyLostPoint(
  o: AssessmentQuestionOutcome,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
): GapType {
  const state = twin.skillMastery.get(o.skillId);
  const mastery = state?.mastery ?? 40;

  // strong reasoning + small loss + solid mastery ⇒ a slip
  if (o.reasoningQuality === 'strong' && o.awardedScore >= 0.5 && mastery >= 65) return 'careless_error';

  // partial credit with steps present ⇒ execution, not understanding
  if (o.awardedScore > 0 && o.awardedScore < 0.8 && (o.stepsObserved?.length ?? 0) > 0) return 'procedural_gap';

  // a weak, important prerequisite has evidence ⇒ prerequisite gap
  const weakPrereq = kb.directPrerequisites(o.skillId).some((p) => {
    const ps = twin.skillMastery.get(p);
    return ps && ps.evidenceCount > 0 && ps.mastery < 55;
  });
  if (weakPrereq) return 'prerequisite_gap';

  // knowledge strong but a hard item lost ⇒ reasoning
  if (mastery >= 72) return 'reasoning_gap';

  return 'concept_gap';
}

const NOTE: Record<GapType, string> = {
  careless_error: 'Sai một bước nhỏ, không phải chưa hiểu.',
  procedural_gap: 'Hiểu cách làm nhưng sai khâu thực hiện.',
  prerequisite_gap: 'Mất điểm do phần kiến thức nền chưa vững.',
  reasoning_gap: 'Kiến thức ổn, vướng ở bước suy luận.',
  concept_gap: 'Chưa nắm chắc bản chất phần này.',
  method_gap: 'Chọn sai cách làm cho dạng bài này.',
  recognition_gap: 'Chưa nhận ra dạng bài để chọn cách.',
  application_gap: 'Khó chuyển từ đề bài sang phép toán.',
  retention_gap: 'Từng làm được nhưng đã quên.',
  reading_error: 'Đọc/hiểu đề chưa kỹ.',
  presentation_error: 'Làm đúng nhưng trình bày mất điểm.',
};
