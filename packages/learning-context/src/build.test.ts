import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence, type TeacherContribution } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningContext } from './build.js';

const kb = loadKnowledgeBase();
const childId = asChildId('child_minh_anh');
const asOf = new Date('2026-08-31T09:00:00Z');

function ev(partial: Partial<Evidence> & { skillId: string; occurredAt: string }): Evidence {
  return {
    id: `ev_${Math.random()}`,
    childId,
    source: 'app_practice',
    recordedAt: partial.occurredAt,
    result: { correct: true },
    confidenceTier: 'B',
    provenance: 'manual',
    ...partial,
    skillId: asSkillId(partial.skillId),
  };
}

describe('buildLearningContext (Phase 2 acceptance)', () => {
  it('builds a usable context with ZERO teacher contributions', () => {
    const ctx = buildLearningContext({
      childId,
      gradeContext: 7,
      evidence: [
        ev({ skillId: 'M7.RATIO.PROPORTION', occurredAt: '2026-08-28T10:00:00Z' }),
        ev({ skillId: 'M4.FRAC.COMMON_DENOM', occurredAt: '2026-08-20T10:00:00Z', result: { correct: false } }),
      ],
      teacherContributions: [],
      knowledgeBase: kb,
      asOf,
    });

    expect(ctx.teacherParticipated).toBe(false);
    expect(ctx.activeSkillIds).toContain('M7.RATIO.PROPORTION');
    expect(ctx.actualTaughtPosition.skillIds.length).toBeGreaterThan(0);
    expect(ctx.actualTaughtPosition.note).toMatch(/chưa có cập nhật của giáo viên/);
    expect(ctx.standardPosition.skillIds.length).toBeGreaterThan(0);
  });

  it('prefers teacher-reported taught skills when a contribution exists', () => {
    const contribution: TeacherContribution = {
      id: 'tc_1',
      childId,
      contributedAs: 'teacher',
      actorUserId: 'user_teacher',
      occurredOn: '2026-08-29',
      recordedAt: '2026-08-29T12:00:00Z',
      taughtSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')],
      problemTypeIds: [],
      homeworkRefs: [],
    };
    const ctx = buildLearningContext({
      childId,
      gradeContext: 7,
      evidence: [ev({ skillId: 'M7.RATIO.EQUAL_CHAIN', occurredAt: '2026-08-30T10:00:00Z' })],
      teacherContributions: [contribution],
      knowledgeBase: kb,
      asOf,
    });
    expect(ctx.teacherParticipated).toBe(true);
    expect(ctx.actualTaughtPosition.skillIds).toContain('M7.RATIO.EQUAL_CHAIN');
    expect(ctx.actualTaughtPosition.note).toMatch(/giáo viên\/bố mẹ/);
    expect(ctx.conflicts).toHaveLength(0);
  });

  it('flags a conflict when the teacher and the app point at disjoint topics', () => {
    const contribution: TeacherContribution = {
      id: 'tc_2',
      childId,
      contributedAs: 'teacher',
      actorUserId: 'user_teacher',
      occurredOn: '2026-08-29',
      recordedAt: '2026-08-29T12:00:00Z',
      taughtSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')],
      problemTypeIds: [],
      homeworkRefs: [],
    };
    const ctx = buildLearningContext({
      childId,
      gradeContext: 7,
      evidence: [ev({ skillId: 'M4.FRAC.SIMPLIFY', occurredAt: '2026-08-30T10:00:00Z' })],
      teacherContributions: [contribution],
      knowledgeBase: kb,
      asOf,
    });
    expect(ctx.conflicts).toHaveLength(1);
    expect(ctx.conflicts[0]!.sources).toEqual(['teacher_contribution', 'app_evidence']);
  });

  it('reports a per-domain frontier — never one global grade level', () => {
    const ctx = buildLearningContext({
      childId,
      gradeContext: 7,
      evidence: [
        ev({ skillId: 'M7.ALG.IDENTITY', occurredAt: '2026-08-27T10:00:00Z' }), // origin 8 → above grade
        ev({ skillId: 'M7.RAT.OPERATIONS', occurredAt: '2026-08-27T10:00:00Z' }), // origin 7
      ],
      teacherContributions: [],
      knowledgeBase: kb,
      asOf,
    });
    const algebra = ctx.frontier.find((f) => f.domain === 'algebraic_thinking');
    const arithmetic = ctx.frontier.find((f) => f.domain === 'arithmetic');
    expect(algebra?.frontierLabel).toBe('above_grade_G8_exposure');
    expect(arithmetic?.frontierLabel).toBe('grade_7_context');
    // two separate entries, not a merged scalar
    expect(ctx.frontier.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores stale evidence outside the recency window for "active" skills', () => {
    const ctx = buildLearningContext({
      childId,
      gradeContext: 4,
      evidence: [ev({ skillId: 'M4.FRAC.CONCEPT', occurredAt: '2026-01-01T10:00:00Z' })],
      teacherContributions: [],
      knowledgeBase: kb,
      asOf,
      recencyDays: 21,
    });
    expect(ctx.activeSkillIds).not.toContain('M4.FRAC.CONCEPT');
    // but it still counts toward the domain frontier (all-time exposure)
    expect(ctx.frontier.some((f) => f.domain === 'fractions')).toBe(true);
  });
});
