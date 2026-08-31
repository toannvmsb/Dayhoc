import type { TeacherHomeView, TeacherUpdateFormView } from '@copilot/api-contract';
import type { KnowledgeBase } from '@copilot/math-data';

export interface TeacherClassInput {
  readonly classRef: string;
  readonly connectedParents: number;
  readonly lastUpdatedOn?: string; // YYYY-MM-DD
}

export interface TeacherHomeInput {
  readonly teacherName: string;
  readonly subject: string;
  readonly today: string; // YYYY-MM-DD
  readonly classes: readonly TeacherClassInput[];
  readonly recentHistory: readonly { topic: string; detail: string; date: string }[];
}

export function buildTeacherHome(input: TeacherHomeInput): TeacherHomeView {
  const classes = input.classes.map((c) => {
    const updatedToday = c.lastUpdatedOn === input.today;
    return {
      classRef: c.classRef,
      connectedParents: c.connectedParents,
      lastUpdatedLabel: c.lastUpdatedOn
        ? updatedToday
          ? 'Đã cập nhật hôm nay'
          : `Đã cập nhật ${viDate(c.lastUpdatedOn)}`
        : 'Chưa cập nhật',
      updatedToday,
    };
  });
  return {
    teacherName: input.teacherName,
    subject: input.subject,
    todayUpdated: classes.every((c) => c.updatedToday),
    classes,
    recentHistory: input.recentHistory.map((h) => ({
      topic: h.topic,
      detail: h.detail,
      dateLabel: viDate(h.date),
    })),
  };
}

/**
 * The quick-update form for one class/session. Topic choices are drawn from the
 * grade the class is on — kept short so the whole flow stays under a minute
 * (UI/UX Spec §14, §23). A teacher only needs to pick topics + tick problem
 * types + (optionally) add homework and an exam date.
 */
export function buildTeacherUpdateForm(input: {
  classRef: string;
  dateLabel: string;
  gradeContext: number;
  knowledgeBase: KnowledgeBase;
  recentSkillIds?: readonly string[];
}): TeacherUpdateFormView {
  const gradeSkills = [...input.knowledgeBase.skills.values()].filter(
    (s) => s.gradeContext === input.gradeContext,
  );
  // Surface recently-taught skills first, then the rest of the grade.
  const recent = new Set(input.recentSkillIds ?? []);
  const ordered = [
    ...gradeSkills.filter((s) => recent.has(s.id)),
    ...gradeSkills.filter((s) => !recent.has(s.id)),
  ].slice(0, 12);

  const topicChoices = ordered.map((s) => ({ skillId: s.id, name: s.name }));
  const problemTypeChoices = ordered
    .flatMap((s) => input.knowledgeBase.getProblemTypesForSkill(s.id))
    .slice(0, 10)
    .map((pt) => ({ problemTypeId: pt.id, name: pt.name }));

  return {
    classRef: input.classRef,
    dateLabel: input.dateLabel,
    topicChoices,
    problemTypeChoices,
    estimatedSeconds: 40,
  };
}

function viDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}
