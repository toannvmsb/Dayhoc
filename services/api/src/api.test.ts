import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { assertChildSafe } from '@copilot/projections';
import { AuthzError, createApi, type ApiDeps } from './api.js';

const kb = loadKnowledgeBase();
const asOf = new Date('2026-08-31T09:00:00Z');
const childId = 'child_minh_anh';

const seed: Evidence[] = [
  {
    id: 'ev_1' as Evidence['id'],
    childId: asChildId(childId),
    source: 'school_test',
    occurredAt: '2026-08-24T08:00:00Z',
    recordedAt: '2026-08-24T08:00:00Z',
    skillId: asSkillId('M4.FRAC.COMMON_DENOM'),
    result: { correct: false },
    confidenceTier: 'A',
    provenance: 'assessment',
  },
  {
    id: 'ev_2' as Evidence['id'],
    childId: asChildId(childId),
    source: 'school_test',
    occurredAt: '2026-08-28T08:00:00Z',
    recordedAt: '2026-08-28T08:00:00Z',
    skillId: asSkillId('M4.FRAC.COMMON_DENOM'),
    result: { correct: false },
    confidenceTier: 'A',
    provenance: 'assessment',
  },
];

const deps: ApiDeps = {
  knowledgeBase: kb,
  now: () => asOf,
  childProfiles: {
    [childId]: {
      profile: { childId, displayName: 'Minh Anh', schoolGrade: 7, schoolContext: 'Kết nối tri thức' },
      gradeContext: 7,
      familyUserIds: ['parent_thu_ha'],
      seedEvidence: seed,
    },
  },
};

const parentCtx = { userId: 'parent_thu_ha', role: 'parent' as const };
const childCtx = { userId: 'child_device', role: 'child' as const, childScope: childId };
const otherParentCtx = { userId: 'stranger', role: 'parent' as const };

describe('API role gating (Phase 10)', () => {
  it('a parent in the family can read the parent home', async () => {
    const api = createApi(deps);
    const home = await api.parentHome(parentCtx, childId);
    expect(home.child.displayName).toBe('Minh Anh');
  });

  it('a parent outside the family is refused', async () => {
    const api = createApi(deps);
    await expect(api.parentHome(otherParentCtx, childId)).rejects.toBeInstanceOf(AuthzError);
  });

  it('a child token CANNOT reach the parent home or gap detail', async () => {
    const api = createApi(deps);
    await expect(api.parentHome(childCtx, childId)).rejects.toBeInstanceOf(AuthzError);
    await expect(api.parentGapDetail(childCtx, childId, 'gap_1')).rejects.toBeInstanceOf(AuthzError);
  });

  it('a child token gets only the child-safe today view, and it passes assertChildSafe', async () => {
    const api = createApi(deps);
    const view = await api.childToday(childCtx, childId);
    expect(view).not.toHaveProperty('mastery');
    expect(() => assertChildSafe(view)).not.toThrow();
  });

  it('a child token scoped to child A cannot read child B', async () => {
    const api = createApi(deps);
    await expect(
      api.childToday({ ...childCtx, childScope: 'someone_else' }, childId),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it('a child token cannot write evidence directly', async () => {
    const api = createApi(deps);
    await expect(
      api.recordEvidence(childCtx, childId, {
        childId,
        source: 'app_practice',
        occurredAt: '2026-08-31T08:00:00Z',
        result: { correct: true },
        confidenceTier: 'B',
        provenance: 'manual',
      }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it('a parent can submit a teacher update on the teacher’s behalf, and it flows into the context', async () => {
    const api = createApi(deps);
    await api.recordTeacherUpdate(parentCtx, childId, {
      childId,
      contributedAs: 'parent',
      actorUserId: 'parent_thu_ha',
      occurredOn: '2026-08-30',
      taughtSkillIds: ['M7.RATIO.EQUAL_CHAIN'],
      problemTypeIds: [],
      homeworkRefs: [],
    });
    const home = await api.parentHome(parentCtx, childId);
    expect(home.learningContext.sources).toContain('Giáo viên xác nhận');
  });
});
