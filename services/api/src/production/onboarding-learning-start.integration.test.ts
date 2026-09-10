import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * Onboarding step 2 (doc 70) — the parent pins where the child actually is:
 * getCurriculumProgram → setChildLearningStart → a PARENT lesson-confirmation
 * (STRONG) so the Curriculum Clock resolves the real position instead of
 * estimating from the calendar date. Against PostgreSQL. No paid AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('doc 70 — onboarding learning-start', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-01-20T00:00:00.000Z');
  const children: string[] = [];
  const families: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`ols${Date.now()}`), now });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of ['lesson_confirmations', 'evidence', 'learning_state_snapshots', 'learning_context_snapshots', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  });

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  it('curriculum program lists grade-4 chapters + lessons (static, no child data)', async () => {
    const parent = await reg(`ols-p1-${Date.now()}@x.com`);
    const prog = await api.getCurriculumProgram({ bearer: parent.bearer, workspace: 'PARENT' }, 4);
    expect(prog.chapters.length).toBeGreaterThan(5);
    expect(prog.chapters[0]!.lessons.length).toBeGreaterThan(0);
    expect(typeof prog.chapters[0]!.lessons[0]!.name).toBe('string');
    await expect(
      api.getCurriculumProgram({ bearer: parent.bearer, workspace: 'PARENT' }, 5 as never),
    ).rejects.toThrow();
  });

  it('setChildLearningStart records a PARENT/STRONG lesson confirmation + school label, and resolves it', async () => {
    const stamp = Date.now();
    const parent = await reg(`ols-p2-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Onboard', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    const prog = await api.getCurriculumProgram(pAuth, 4);
    // a lesson from the middle of the year — everything before it becomes "đã học"
    const midChapter = prog.chapters[Math.floor(prog.chapters.length / 2)]!;
    const target = midChapter.lessons[0]!;

    const res = await api.setChildLearningStart(pAuth, child.childId, {
      lessonId: target.lessonId,
      schoolName: 'Tiểu học Nguyễn Du',
      className: '4A2',
    });
    expect(res.resolved.lessonId).toBe(target.lessonId);

    const lc = await pool.query<{ source: string; confidence: string; lesson_id: string }>(
      `SELECT source, confidence, lesson_id FROM lesson_confirmations WHERE child_id = $1 ORDER BY confirmed_at DESC LIMIT 1`,
      [child.childId],
    );
    expect(lc.rows[0]!.source).toBe('PARENT_UPDATE');
    expect(lc.rows[0]!.confidence).toBe('STRONG');
    expect(lc.rows[0]!.lesson_id).toBe(target.lessonId);

    const prof = await pool.query<{ school_context: { name?: string; className?: string } }>(
      `SELECT school_context FROM child_profiles WHERE id = $1`,
      [child.childId],
    );
    expect(prof.rows[0]!.school_context.name).toBe('Tiểu học Nguyễn Du');
    expect(prof.rows[0]!.school_context.className).toBe('4A2');

    // the learning context now RESOLVES that lesson (not an ESTIMATED guess)
    const cx = await api.getLearningContext(pAuth, child.childId);
    expect(cx.resolved.lessonId).toBe(target.lessonId);
  });

  it('rejects a bogus lessonId and a non-PARENT caller', async () => {
    const stamp = Date.now();
    const parent = await reg(`ols-p3-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Bogus', schoolGrade: 7 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    await expect(api.setChildLearningStart(pAuth, child.childId, { lessonId: 'C.G4.NOPE.99' })).rejects.toThrow();
    // a caller who does not hold PARENT for this child cannot pin the lesson
    await expect(
      api.setChildLearningStart({ bearer: parent.bearer, workspace: 'STUDENT' }, child.childId, { lessonId: 'x' }),
    ).rejects.toThrow();
  });
});
