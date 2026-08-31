import type { Exam, RevisionPlan, WeeklyReport } from '@copilot/domain';
import type { ExamRevisionView, WeeklyReportView } from '@copilot/api-contract';
import type { KnowledgeBase } from '@copilot/math-data';

const BAND_LABEL = {
  ưu_tiên_cao: 'Ưu tiên cao',
  nhắc_lại: 'Nhắc lại',
  đã_ổn: 'Đã ổn',
} as const;

export function buildExamRevisionView(
  exam: Exam,
  plan: RevisionPlan,
  kb: KnowledgeBase,
): ExamRevisionView {
  const scopeIds = exam.scopeSkillIds ?? exam.inferredScope?.skillIds ?? [];
  const scopeConfirmed = exam.scopeSkillIds !== undefined;
  return {
    examDateLabel: viDate(exam.examDate),
    dayCountdown: plan.dayCountdown,
    subject: exam.subject,
    scopeConfirmed,
    scopeItems: scopeIds.map((id) => ({
      name: kb.skills.get(id)?.name ?? id,
      confirmed: scopeConfirmed,
    })),
    dailyMinutes: plan.dailyMinutes,
    priorityItems: plan.priorityItems.map((it) => ({
      name: it.name,
      bandLabel: BAND_LABEL[it.band],
      fillPercent: Math.round(it.priority * 100),
    })),
    mockTest: plan.dayCountdown <= 10 ? { label: 'Đề ôn thử', minutes: 30 } : null,
  };
}

export function buildWeeklyReportView(report: WeeklyReport): WeeklyReportView {
  return {
    weekLabel: `Tuần ${viDate(report.weekOf)}`,
    stats: [
      { value: `${report.stats.sessions}`, label: 'buổi học cùng bố mẹ' },
      { value: `${report.stats.totalMinutes}′`, label: 'tổng thời gian học' },
      { value: `${report.stats.skillsSteady}`, label: 'kỹ năng đã vững', highlight: true },
    ],
    progress: report.progress,
    needsFollowUp: report.needsFollowUp,
    nextWeekMix: report.nextWeekMix,
    nextWeekNote: report.nextWeekNote,
  };
}

function viDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}
