import {
  type ChildId,
  type ExerciseDose,
  type GapId,
  type GapType,
  type LearningPrescription,
  type LearningReadiness,
  type PrescriptionOption,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapFinding } from './detect.js';
import type { GapScoreBreakdown } from '@copilot/domain';

/** Base session plan by severity band. */
const PLAN_BY_BAND = {
  high: { sessions: 4, minutesPerSession: 12, durationDays: 8, retestItems: 5, retentionCheckDays: 7 },
  medium: { sessions: 3, minutesPerSession: 10, durationDays: 7, retestItems: 5, retentionCheckDays: 7 },
  low: { sessions: 2, minutesPerSession: 8, durationDays: 5, retestItems: 3, retentionCheckDays: 7 },
} as const;

/** Dose shape (must sum to a whole number of items) shifts by gap type. */
const DOSE_BY_TYPE: Partial<Record<GapType, ExerciseDose>> = {
  prerequisite_gap: { foundation: 6, standard: 4, application: 2, thinking: 1 },
  concept_gap: { foundation: 5, standard: 5, application: 2, thinking: 1 },
  method_gap: { foundation: 3, standard: 5, application: 3, thinking: 1 },
  recognition_gap: { foundation: 2, standard: 4, application: 4, thinking: 2 },
  application_gap: { foundation: 2, standard: 3, application: 5, thinking: 2 },
  reasoning_gap: { foundation: 1, standard: 2, application: 3, thinking: 5 },
  procedural_gap: { foundation: 4, standard: 5, application: 2, thinking: 1 },
  retention_gap: { foundation: 3, standard: 4, application: 2, thinking: 1 },
};
const DEFAULT_DOSE: ExerciseDose = { foundation: 4, standard: 4, application: 2, thinking: 1 };

const LABEL: Record<GapType, string> = {
  concept_gap: 'chưa nắm bản chất',
  prerequisite_gap: 'thiếu kiến thức nền',
  method_gap: 'chọn sai cách làm',
  recognition_gap: 'chưa nhận ra dạng bài',
  application_gap: 'chưa vận dụng vào bài toán',
  reasoning_gap: 'vướng ở bước suy luận',
  procedural_gap: 'sai khâu thực hiện',
  retention_gap: 'quên sau một thời gian',
  careless_error: 'lỗi bất cẩn',
  reading_error: 'đọc/hiểu đề chưa kỹ',
  presentation_error: 'trình bày chưa rõ',
};

export interface GeneratePrescriptionInput {
  readonly childId: ChildId;
  readonly gapId: GapId;
  readonly finding: GapFinding;
  readonly score: GapScoreBreakdown;
  readonly readiness: LearningReadiness;
  readonly knowledgeBase: KnowledgeBase;
  readonly at: string; // ISO
  readonly newId: () => string;
}

/**
 * Turn a scored gap into a concrete, parent-approvable plan (Math Core §23,
 * UI/UX Spec §9). The engine proposes; the parent picks follow / lighter /
 * intensify / later.
 */
export function generatePrescription(input: GeneratePrescriptionInput): LearningPrescription {
  const { finding, score, readiness, knowledgeBase: kb } = input;
  const plan = PLAN_BY_BAND[score.band];
  const dose = DOSE_BY_TYPE[finding.type] ?? DEFAULT_DOSE;

  const rootName = kb.skills.get(finding.rootSkillId)?.name ?? finding.rootSkillId;
  const targetName = kb.skills.get(finding.targetSkillId)?.name ?? finding.targetSkillId;

  const blocksCurrentLearning =
    readiness.recommendation !== 'ready' || finding.type === 'prerequisite_gap';
  const blocksAdvancedLearning = readiness.recommendation === 'repair_first';

  const severity: LearningPrescription['severity'] = score.band;

  const rationale = buildRationale(finding.type, rootName, targetName, readiness, blocksCurrentLearning);

  const options: PrescriptionOption[] = [
    { key: 'follow', label: 'Theo đề xuất', sessions: plan.sessions, minutesPerSession: plan.minutesPerSession, durationDays: plan.durationDays },
    { key: 'lighter', label: 'Nhẹ hơn', sessions: Math.max(2, plan.sessions - 1), minutesPerSession: Math.max(6, plan.minutesPerSession - 3), durationDays: plan.durationDays + 4 },
    { key: 'intensify', label: 'Tăng cường', sessions: plan.sessions + 2, minutesPerSession: plan.minutesPerSession + 2, durationDays: Math.max(5, plan.durationDays - 2) },
    { key: 'later', label: 'Để sau', sessions: plan.sessions, minutesPerSession: plan.minutesPerSession, durationDays: plan.durationDays },
  ];

  return {
    id: `rx_${input.newId()}`,
    childId: input.childId,
    gapId: input.gapId,
    gapLabel: `${targetName} — ${LABEL[finding.type]}`,
    severity,
    rootGapLabel: rootName,
    durationDays: plan.durationDays,
    sessions: plan.sessions,
    minutesPerSession: plan.minutesPerSession,
    dose,
    retestItems: plan.retestItems,
    retentionCheckDays: plan.retentionCheckDays,
    blocksCurrentLearning,
    blocksAdvancedLearning,
    rationale,
    options,
    createdAt: input.at,
  };
}

function buildRationale(
  type: GapType,
  rootName: string,
  targetName: string,
  readiness: LearningReadiness,
  blocksCurrent: boolean,
): string {
  const what =
    type === 'prerequisite_gap'
      ? `"${rootName}" là nền của "${targetName}", phần này chưa vững.`
      : type === 'reasoning_gap'
        ? `Kiến thức "${targetName}" của con ổn; chỗ vướng là bước suy luận nhiều bước.`
        : type === 'retention_gap'
          ? `Con từng làm chắc "${targetName}" nhưng đang quên dần.`
          : `Con chưa vững "${targetName}" (${LABEL[type]}).`;
  const why = blocksCurrent
    ? ' Nên xử lý sớm vì đang ảnh hưởng tới bài con học trên lớp.'
    : ' Có thể xử lý song song, không cần dừng phần nâng cao.';
  const how =
    readiness.recommendation === 'parallel_repair'
      ? ' App sẽ chèn một liều luyện ngắn vào buổi học hằng ngày.'
      : readiness.recommendation === 'repair_first'
        ? ' Nên ưu tiên phần nền trước khi học tiếp nội dung mới.'
        : ' Vài buổi ôn ngắn là đủ.';
  return what + why + how;
}
