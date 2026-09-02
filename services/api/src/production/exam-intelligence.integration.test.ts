import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * M6 — exam intelligence end to end against PostgreSQL: create exam → infer
 * scope → confirm → revision map → record per-question result → post-exam
 * diagnosis that classifies every lost point. Deterministic; the Twin is not
 * mutated by recording an exam result.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('M6 — exam intelligence', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-03-01T00:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`ex${Date.now()}`), now });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of [
        'exam_results',
        'exams',
        'learning_state_snapshots',
        'skill_states',
        'knowledge_gaps',
        'learning_plans',
        'evidence',
      ]) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]);
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('create exam -> revision map -> record result -> classified diagnosis', async () => {
    const parent = await reg(`ex-p-${Date.now()}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Ổi', schoolGrade: 7 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    const created = await api.createExam(pAuth, child.childId, {
      examDate: '2027-03-15',
      subject: 'Toán',
      notes: 'Kiểm tra giữa kỳ 2',
    });
    expect(created.examId).toBeTruthy();
    expect(created.inferredScope).toHaveProperty('skillIds');

    const list = await api.listExams(pAuth, child.childId);
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe('SCHEDULED');

    const map = await api.getRevisionMap(pAuth, child.childId, created.examId);
    expect(map.dayCountdown).toBeGreaterThan(0);
    // scope may be empty for a zero-data child — the flow still works
    const scopeIds = map.items.map((i) => i.skillId);
    if (scopeIds.length > 0) {
      await api.confirmExamScope(pAuth, child.childId, created.examId, scopeIds.slice(0, 2));
      const map2 = await api.getRevisionMap(pAuth, child.childId, created.examId);
      expect(map2.scopeConfirmed).toBe(true);
    }

    // record a result: one right, one careless-looking slip, one clearly wrong
    const outcomes = (scopeIds.length >= 2 ? scopeIds.slice(0, 2) : ['M7.QNUM.OPERATIONS']).map(
      (skillId, i) => ({
        questionRef: `q${i + 1}`,
        skillId,
        awardedScore: i === 0 ? 1 : 0.2,
        reasoningQuality: (i === 0 ? 'strong' : 'weak') as 'strong' | 'weak',
      }),
    );
    const diag = await api.recordExamResult(pAuth, child.childId, created.examId, outcomes);
    expect(diag.totalAwardedPercent).toBeGreaterThanOrEqual(0);
    if (outcomes.some((o) => o.awardedScore < 0.95)) {
      expect(diag.lostPoints.length).toBeGreaterThan(0);
      // every lost point is classified with a Vietnamese label
      for (const lp of diag.lostPoints) {
        expect(lp.categoryLabel.length).toBeGreaterThan(1);
        expect(
          ['Bất cẩn', 'Hổng kiến thức', 'Hổng kiến thức nền', 'Sai phương pháp', 'Sai khâu thực hiện',
           'Không nhận ra dạng', 'Lập luận', 'Vận dụng', 'Trình bày', 'Đọc đề', 'Đã quên'],
        ).toContain(lp.categoryLabel);
      }
    }

    // exam is now COMPLETED and the diagnosis is retrievable
    const stored = await api.getExamDiagnosis(pAuth, child.childId, created.examId);
    expect(stored).not.toBeNull();
    const list2 = await api.listExams(pAuth, child.childId);
    expect(list2[0]!.status).toBe('COMPLETED');
    expect(list2[0]!.hasResult).toBe(true);

    // recording did NOT write evidence (an exam result is not a mastery signal here)
    const ev = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [child.childId]);
    expect(ev.rows[0]!.n).toBe(0);

    // a stranger cannot read the revision map
    const stranger = await reg(`ex-s-${Date.now()}@x.com`);
    await expect(
      api.getRevisionMap({ bearer: stranger.bearer, workspace: 'PARENT' }, child.childId, created.examId),
    ).rejects.toBeTruthy();
  });
});
