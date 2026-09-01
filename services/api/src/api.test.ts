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

describe('Curriculum Clock + Context Resolver — B3', () => {
  // a child enrolled in the calendar, with NO evidence at all
  const freshDeps: ApiDeps = {
    knowledgeBase: kb,
    now: () => new Date('2026-11-14T09:00:00Z'),
    childProfiles: {
      c_fresh: {
        profile: { childId: 'c_fresh', displayName: 'Bé An', schoolGrade: 4, schoolContext: 'Kết nối tri thức' },
        gradeContext: 4,
        familyUserIds: ['p_an'],
        enrollment: { curriculum: 'KET_NOI_TRI_THUC', academicYear: '2026-2027' },
      },
    },
  };
  const pAn = { userId: 'p_an', role: 'parent' as const };

  it('B3-1 — no evidence → estimated context with a window, marked ESTIMATED (not fact)', async () => {
    const api = createApi(freshDeps);
    const lc = await api.learningContext(pAn, 'c_fresh');
    expect(lc.expected).not.toBeNull();
    expect(lc.expected!.confidence).toBe('ESTIMATED');
    expect(lc.expected!.window.lessonIds.length).toBeGreaterThan(1);
    expect(lc.resolved.source).toBe('CURRICULUM_TIMELINE');
    expect(lc.resolved.confidence).toBe('ESTIMATED');
    const home = await api.parentHome(pAn, 'c_fresh');
    expect(home.learningContext.status).toBe('ESTIMATED_FROM_CALENDAR');
    expect(home.learningContext.statusLabel).toMatch(/ước tính|Dự kiến/i);
  });

  it('B3-7 — the estimate carries calendar provenance / version', async () => {
    const api = createApi(freshDeps);
    const lc = await api.learningContext(pAn, 'c_fresh');
    expect(lc.calendar?.calendarId).toBe('cal.KNTT.G4.2026-2027.v1');
    expect(lc.calendar?.status).toBe('PROVISIONAL');
    expect(lc.calendar?.version).toBe(1);
  });

  it('B3-2 / B3-9 — confirm-lesson APPENDS an event (history kept) and re-resolves', async () => {
    // advancing clock so successive confirmations get distinct timestamps
    let t = new Date('2026-11-14T09:00:00Z').getTime();
    const advancing: ApiDeps = { ...freshDeps, now: () => new Date((t += 60_000)) };
    const api = createApi(advancing);
    const before = await api.learningContext(pAn, 'c_fresh');

    const r1 = await api.confirmLesson(pAn, 'c_fresh', { lessonId: 'C.G4.10.5' }); // Quy đồng mẫu số
    expect(r1.event.source).toBe('PARENT_UPDATE');
    expect(r1.resolved.lessonId).toBe('C.G4.10.5');
    expect(r1.resolved.source).toBe('PARENT_UPDATE');
    // expected (calendar) still exists, separate from resolved
    expect(r1.expected).not.toBeNull();
    expect(r1.expected!.lessonId).toBe(before.expected!.lessonId);

    // a second confirmation APPENDS — the first row is not overwritten
    await api.confirmLesson(pAn, 'c_fresh', { lessonId: 'C.G4.10.6' });
    const home = await api.parentHome(pAn, 'c_fresh');
    expect(home.learningContext.status).toBe('CONFIRMED_BY_PARENT');
    const lc = await api.learningContext(pAn, 'c_fresh');
    expect(lc.resolved.lessonId).toBe('C.G4.10.6'); // most recent confirmation wins the re-resolution
  });

  it('confirm-lesson rejects an unknown lesson id and a child token', async () => {
    const api = createApi(freshDeps);
    await expect(api.confirmLesson(pAn, 'c_fresh', { lessonId: 'C.G4.99.9' })).rejects.toThrow();
    await expect(
      api.confirmLesson({ userId: 'x', role: 'child', childScope: 'c_fresh' }, 'c_fresh', { lessonId: 'C.G4.10.5' }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it('B3-3 — a recent verified test beats the curriculum estimate', async () => {
    const api = createApi({
      ...freshDeps,
      childProfiles: {
        c_fresh: {
          ...freshDeps.childProfiles.c_fresh!,
          seedEvidence: [
            {
              id: 'ev_vt' as never,
              childId: asChildId('c_fresh'),
              source: 'school_test',
              occurredAt: '2026-11-05T08:00:00Z',
              recordedAt: '2026-11-05T08:00:00Z',
              skillId: asSkillId('M4.FRAC.SIMPLIFY'), // C.G4.10.4
              result: { correct: true },
              confidenceTier: 'A',
              provenance: 'assessment',
            },
          ],
        },
      },
    });
    const lc = await api.learningContext(pAn, 'c_fresh');
    expect(lc.resolved.source).not.toBe('CURRICULUM_TIMELINE');
    expect(lc.resolved.confidence).toBe('VERIFIED');
  });

  it('B3-10 — legacy aliases still populated for existing consumers during migration', async () => {
    const api = createApi(freshDeps);
    const home = await api.parentHome(pAn, 'c_fresh');
    expect(home.learningContext.headline.length).toBeGreaterThan(0); // reads actualTaughtPosition
    const s = await api.parentProgress(pAn, 'c_fresh');
    expect(s.child.displayName).toBe('Bé An'); // whole pipeline still runs
  });
});
