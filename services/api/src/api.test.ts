import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  createMockExerciseGenerator,
  createLunaExerciseGenerator,
  InMemoryShadowGenerationQueue,
  InMemoryGenerationStore,
  type ExerciseGenerator,
} from '@copilot/exercise-gen';
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

describe('C5 §23 — AI generation SHADOW mode (child never sees AI content)', () => {
  const lib = loadReferenceLibrary();

  function spyGenerator(inner: ExerciseGenerator): ExerciseGenerator & { calls: number } {
    let calls = 0;
    return {
      ...inner,
      get calls() {
        return calls;
      },
      generate: (req) => {
        calls += 1;
        return inner.generate(req);
      },
    };
  }
  const alwaysFails = createLunaExerciseGenerator({
    adapter: {
      provider: 'openai',
      capability: 'generate_problem',
      model: 'gpt-5.6-luna',
      processingRegion: 't',
      crossBorder: false,
      dataCategoriesAllowed: [],
      providerRetention: 'none',
      trainingAllowed: false,
      dpaStatus: 'not_applicable',
      call: () => Promise.reject(new Error('shadow provider down')),
    },
  });

  function depsWith(mode: 'OFF' | 'SHADOW' | 'LIVE', generator: ExerciseGenerator, queue = new InMemoryShadowGenerationQueue()) {
    return {
      ...deps,
      shadowGeneration: { mode, queue, generator, referenceLibrary: lib, store: new InMemoryGenerationStore() },
    } satisfies ApiDeps;
  }

  it('7. OFF — no AI generation runs at all', async () => {
    const gen = spyGenerator(createMockExerciseGenerator());
    const queue = new InMemoryShadowGenerationQueue();
    const api = createApi(depsWith('OFF', gen, queue));
    await api.childToday(childCtx, childId);
    await queue.drain();
    expect(gen.calls).toBe(0);
  });

  it('8. LIVE stays gated — still never generates for a child here', async () => {
    const gen = spyGenerator(createMockExerciseGenerator());
    const queue = new InMemoryShadowGenerationQueue();
    const api = createApi(depsWith('LIVE', gen, queue));
    await api.childToday(childCtx, childId);
    await queue.drain();
    expect(gen.calls).toBe(0);
  });

  it('6. SHADOW — the child-visible assignment is identical to the legacy path', async () => {
    const off = await createApi(depsWith('OFF', createMockExerciseGenerator())).childToday(childCtx, childId);
    const queue = new InMemoryShadowGenerationQueue();
    const shadow = await createApi(depsWith('SHADOW', createMockExerciseGenerator(), queue)).childToday(childCtx, childId);
    await queue.drain();
    expect(shadow).toEqual(off);
  });

  it('5. a SHADOW generation failure never reaches the child response', async () => {
    const off = await createApi(depsWith('OFF', createMockExerciseGenerator())).childToday(childCtx, childId);
    const queue = new InMemoryShadowGenerationQueue();
    const view = await createApi(depsWith('SHADOW', alwaysFails, queue)).childToday(childCtx, childId);
    await queue.drain();
    assertChildSafe(view);
    expect(view).toEqual(off);
  });

  it('SHADOW actually ran the generator (off the request path)', async () => {
    const gen = spyGenerator(createMockExerciseGenerator());
    const queue = new InMemoryShadowGenerationQueue();
    const api = createApi(depsWith('SHADOW', gen, queue));
    await api.childToday(childCtx, childId);
    expect(gen.calls).toBe(0); // not on the synchronous request path
    await queue.drain();
    expect(gen.calls).toBeGreaterThan(0); // but it did run
  });
});

describe('I7 — token-derived RequestContext + /me endpoints', () => {
  it('meRoles + switchWorkspace derive identity server-side; a workspace not held is rejected', async () => {
    const {
      IdentityService,
      InMemoryIdentityStore,
      InMemoryAuthAdapter,
    } = await import('@copilot/identity');
    const store = new InMemoryIdentityStore();
    const auth = new InMemoryAuthAdapter();
    const identityService = new IdentityService({ store, auth });
    const reg = await identityService.register({
      email: 'parent@x.com',
      password: 'supersecret',
      intendedRole: 'PARENT',
    });
    const bearer = (await store.getUser(reg.user.id))!.authUserId!;

    const api = createApi({ ...deps, auth: { identityService } });
    const me = await api.meRoles(bearer);
    expect(me.roles).toEqual(['PARENT']);
    expect(me.defaultWorkspace).toBe('PARENT');

    const ctx = await api.switchWorkspace(bearer, 'PARENT');
    expect(ctx).toMatchObject({ userId: reg.user.id, role: 'parent', workspace: 'PARENT' });

    await expect(api.switchWorkspace(bearer, 'TEACHER')).rejects.toBeTruthy();
    await expect(api.meRoles('forged-token')).rejects.toBeInstanceOf(AuthzError);
  });

  it('the /me endpoints require token auth to be configured', async () => {
    const api = createApi(deps); // no deps.auth
    await expect(api.meRoles('anything')).rejects.toBeInstanceOf(AuthzError);
  });
});
