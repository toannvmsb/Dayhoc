import { loadKnowledgeBase } from '@copilot/math-data';
import { buildTeacherHome, buildTeacherUpdateForm } from '@copilot/projections';

export function teacherHomeView() {
  return buildTeacherHome({
    teacherName: 'Cô Trần Hằng',
    subject: 'Toán',
    today: '2026-08-30',
    classes: [
      { classRef: '7A2', connectedParents: 18, lastUpdatedOn: '2026-08-29' },
      { classRef: '7A5', connectedParents: 11 },
    ],
    recentHistory: [
      { topic: 'Dãy tỉ số bằng nhau', detail: '7A2 · có bài về nhà', date: '2026-08-29' },
      { topic: 'Tỉ lệ thức', detail: '7A2, 7A5', date: '2026-08-27' },
    ],
  });
}

export function teacherUpdateForm() {
  return buildTeacherUpdateForm({
    classRef: '7A5',
    dateLabel: 'Buổi 30/8',
    gradeContext: 7,
    knowledgeBase: loadKnowledgeBase(),
    recentSkillIds: ['G7.RATIO.EQUAL_CHAIN', 'G7.RATIO.PROPORTION'],
  });
}
