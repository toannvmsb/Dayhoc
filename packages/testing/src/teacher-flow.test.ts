import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { EvidenceService, InMemoryLedgerStore } from '@copilot/evidence';
import { buildLearningContext } from '@copilot/learning-context';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildDailyPlan } from '@copilot/planning';
import { buildParentHome, buildTeacherHome, buildTeacherUpdateForm } from '@copilot/projections';
import { KB, buildEvidence } from './harness.js';

const childId = asChildId('teacher_flow_child');
const asOf = new Date('2026-08-31T09:00:00Z');

async function context(contributions: Awaited<ReturnType<EvidenceService['recordTeacherContribution']>>[], evidence: Evidence[]) {
  return buildLearningContext({
    childId,
    gradeContext: 7,
    evidence,
    teacherContributions: contributions,
    knowledgeBase: KB,
    asOf,
  });
}

describe('Phase 8 — teacher quick update flows into the parent Learning Context', () => {
  it('the update form is short and grade-scoped (goal < 60s)', () => {
    const form = buildTeacherUpdateForm({
      classRef: '7A5',
      dateLabel: 'Buổi 30/8',
      gradeContext: 7,
      knowledgeBase: KB,
      recentSkillIds: ['M7.RATIO.EQUAL_CHAIN'],
    });
    expect(form.topicChoices.length).toBeLessThanOrEqual(12);
    expect(form.topicChoices[0]!.skillId).toBe('M7.RATIO.EQUAL_CHAIN'); // recent first
    expect(form.estimatedSeconds).toBeLessThanOrEqual(60);
  });

  it('a recorded contribution changes the parent home headline & marks teacher participation', async () => {
    const service = new EvidenceService({ store: new InMemoryLedgerStore(), now: () => asOf, newId: () => 'x' });

    const evidence = buildEvidence(
      childId,
      [{ skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'weak' }],
      asOf,
    );

    // BEFORE: no teacher — context still works (parent-only path)
    const before = await context([], evidence);
    expect(before.teacherParticipated).toBe(false);

    // teacher (or a parent proxy) submits the quick update
    const contribution = await service.recordTeacherContribution({
      childId,
      contributedAs: 'teacher',
      actorUserId: 'teacher_hang',
      occurredOn: '2026-08-29',
      taughtSkillIds: ['M7.RATIO.EQUAL_CHAIN'],
      problemTypeIds: [],
      homeworkRefs: ['SGK tr.12 bài 1-4'],
    });

    const after = await context([contribution], evidence);
    expect(after.teacherParticipated).toBe(true);
    expect(after.actualTaughtPosition.skillIds).toContain(asSkillId('M7.RATIO.EQUAL_CHAIN'));

    // and the parent's Home reflects it
    const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
    const gaps = runGapEngine({ childId, gradeContext: 7, twin, evidence, knowledgeBase: KB, asOf });
    const plan = buildDailyPlan({ childId, planDate: '2026-08-31', availableMinutes: 25, twin, gaps, context: after, knowledgeBase: KB, asOf });
    const home = buildParentHome({
      profile: { childId: childId as string, displayName: 'Minh Anh', schoolGrade: 7, schoolContext: 'Kết nối tri thức' },
      twin,
      gaps,
      context: after,
      plan,
      knowledgeBase: KB,
    });
    expect(home.learningContext.headline).toContain('tỉ số bằng nhau');
    expect(home.learningContext.sources).toContain('Giáo viên xác nhận');
  });

  it('a parent can submit the update on the teacher’s behalf', async () => {
    const service = new EvidenceService({ store: new InMemoryLedgerStore() });
    const c = await service.recordTeacherContribution({
      childId,
      contributedAs: 'parent',
      actorUserId: 'parent_thu_ha',
      occurredOn: '2026-08-30',
      taughtSkillIds: ['M7.RATIO.PROPORTION'],
      problemTypeIds: [],
      homeworkRefs: [],
    });
    expect(c.contributedAs).toBe('parent');
    const ctx = await context([c], []);
    expect(ctx.teacherParticipated).toBe(true);
  });

  it('buildTeacherHome flags a class that has not been updated today', () => {
    const view = buildTeacherHome({
      teacherName: 'Cô Trần Hằng',
      subject: 'Toán',
      today: '2026-08-30',
      classes: [
        { classRef: '7A2', connectedParents: 18, lastUpdatedOn: '2026-08-30' },
        { classRef: '7A5', connectedParents: 11 },
      ],
      recentHistory: [],
    });
    expect(view.todayUpdated).toBe(false);
    expect(view.classes.find((c) => c.classRef === '7A5')!.lastUpdatedLabel).toBe('Chưa cập nhật');
    expect(view.classes.find((c) => c.classRef === '7A2')!.updatedToday).toBe(true);
  });
});
