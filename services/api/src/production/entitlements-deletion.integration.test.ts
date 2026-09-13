import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { InMemoryUploadStorageAdapter, MockDocumentVisionAdapter } from '@copilot/uploads';
import { entitlementsFor, PLAN_ENTITLEMENTS, PLANS } from '@copilot/domain';
import { createProductionApi } from './production-api.js';

/**
 * M7 — entitlements (MOCK, no billing; never selects an AI model) + REAL
 * child-profile deletion (hard purge, not a soft-hide) against PostgreSQL.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe('M7 — entitlements matrix (pure)', () => {
  it('no plan entitlement mentions an AI model / tier / effort', () => {
    const blob = JSON.stringify(PLAN_ENTITLEMENTS).toLowerCase();
    for (const bad of ['model', 'gpt', 'luna', 'sonnet', 'terra', 'effort', 'reasoning']) {
      expect(blob).not.toContain(bad);
    }
  });
  it('plus is the recommended plan; prices match the locked commercials', () => {
    expect(entitlementsFor('plus').recommended).toBe(true);
    expect(entitlementsFor('basic').priceVnd).toBe(169_000);
    expect(entitlementsFor('plus').priceVnd).toBe(229_000);
    expect(entitlementsFor('pro').priceVnd).toBe(329_000);
    expect(entitlementsFor('free').priceVnd).toBeNull();
  });
  it('higher plans never reduce a quota', () => {
    for (let i = 1; i < PLANS.length; i += 1) {
      const lo = entitlementsFor(PLANS[i - 1]!);
      const hi = entitlementsFor(PLANS[i]!);
      expect(hi.maxChildren).toBeGreaterThanOrEqual(lo.maxChildren);
      expect(hi.evidenceAnalysesPerMonth).toBeGreaterThanOrEqual(lo.evidenceAnalysesPerMonth);
    }
  });
});

describe.skipIf(!DATABASE_URL)('M7 — entitlements + real deletion (DB)', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-04-01T00:00:00.000Z');
  const users: string[] = [];
  const families: string[] = [];

  async function reg(email: string, role: 'PARENT' | 'STUDENT' = 'PARENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
    api = createProductionApi({
      pool,
      authAdapter: new InMemoryAuthAdapter(`m7${Date.now()}`),
      now,
      uploadStorage: new InMemoryUploadStorageAdapter(),
      documentVision: new MockDocumentVisionAdapter(),
    });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM family_subscriptions WHERE family_id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('plan gates maxChildren; setPlan is mock (no charge) and raises the gate', async () => {
    const parent = await reg(`m7-p-${Date.now()}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const fam = () =>
      pool
        .query<{ id: string }>(
          `SELECT f.id FROM families f JOIN family_memberships m ON m.family_id=f.id WHERE m.user_id=$1 LIMIT 1`,
          [parent.userId],
        )
        .then((r) => r.rows[0]?.id);

    const c1 = await api.createChild(pAuth, { displayName: 'Con 1', schoolGrade: 4 });
    const famId = await fam();
    if (famId) families.push(famId);
    // FREE allows 1 child — the 2nd is refused
    await expect(api.createChild(pAuth, { displayName: 'Con 2', schoolGrade: 4 })).rejects.toBeTruthy();

    const up = await api.setPlan(pAuth, 'plus');
    expect(up.billing).toBe('MOCK_NO_CHARGE');
    const ent = await api.getEntitlements(pAuth);
    expect(ent.plan).toBe('plus');
    expect(ent.entitlements.maxChildren).toBeGreaterThanOrEqual(2);

    // now the 2nd child is allowed
    const c2 = await api.createChild(pAuth, { displayName: 'Con 2', schoolGrade: 7 });
    expect(c2.childId).toBeTruthy();
    void c1;
  });

  it('confirmChildDeletion hard-purges every child row + the profile; wrong name is refused', async () => {
    const parent = await reg(`m7-d-${Date.now()}@x.com`);
    const student = await reg(`m7-s-${Date.now()}@x.com`, 'STUDENT');
    void student;
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Sẽ Xoá', schoolGrade: 4 });
    const famId = await pool
      .query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])
      .then((r) => r.rows[0]!.family_id);
    families.push(famId);

    // generate some child-scoped data
    await api.getParentHome(pAuth, child.childId); // snapshot + derived rows
    await api.createStudentAccess(pAuth, child.childId, { password: 'kidpass123' });
    const up = await api.createUpload(pAuth, child.childId, {
      kind: 'NOTEBOOK_PAGE',
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('img'.repeat(200)).toString('base64'),
    });
    await api.runUploadAnalysis(pAuth, child.childId, up.uploadId);
    await api.confirmUploadAnalysis(pAuth, child.childId, up.uploadId, []);
    const exam = await api.createExam(pAuth, child.childId, { examDate: '2027-05-01', subject: 'Toán' });
    void exam;

    await api.requestChildDeletion(pAuth, child.childId);
    let status = await api.getChildDeletionStatus(pAuth, child.childId);
    expect(status.deletionState).toBe('deletion_requested');
    expect(status.request?.state).toBe('REQUESTED');

    // wrong name is refused
    await expect(
      api.confirmChildDeletion(pAuth, child.childId, 'sai tên'),
    ).rejects.toBeTruthy();

    // cancel then re-request works
    await api.cancelChildDeletion(pAuth, child.childId);
    status = await api.getChildDeletionStatus(pAuth, child.childId);
    expect(status.deletionState).toBe('active');
    await api.requestChildDeletion(pAuth, child.childId);

    const res = await api.confirmChildDeletion(pAuth, child.childId, 'Bé Sẽ Xoá');
    expect(res.ok).toBe(true);

    // the profile row is GONE (not soft-hidden)
    const gone = await pool.query(`SELECT id FROM child_profiles WHERE id = $1`, [child.childId]);
    expect(gone.rowCount).toBe(0);
    for (const t of ['evidence', 'uploads', 'upload_analysis', 'skill_states', 'knowledge_gaps', 'exams', 'learning_state_snapshots', 'student_account_links', 'parent_child_relationships']) {
      const r = await pool.query(`SELECT 1 FROM ${t} WHERE child_id = $1`, [child.childId]);
      expect(r.rowCount).toBe(0);
    }
    // an append-only audit row survives
    const audit = await pool.query(`SELECT state FROM deletion_jobs WHERE child_id = $1`, [child.childId]);
    expect(audit.rows[0]?.state).toBe('completed');

    // the child no longer appears for the parent
    const kids = await api.listChildren(pAuth);
    expect(kids.some((k) => k.childId === child.childId)).toBe(false);
  }, 30_000);
});
