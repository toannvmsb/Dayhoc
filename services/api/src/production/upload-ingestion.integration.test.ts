import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { InMemoryUploadStorageAdapter, MockDocumentVisionAdapter } from '@copilot/uploads';
import { createProductionApi } from './production-api.js';

/**
 * M4 — evidence upload / document-vision ingestion, end to end against
 * PostgreSQL. Immutable `uploads` ledger + mutable `upload_analysis` state
 * machine. Mock vision adapter (no paid call). Low-confidence extraction is
 * NEVER silently promoted to verified evidence.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('M4 — upload ingestion', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-02-01T00:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  async function reg(email: string, role: 'PARENT' | 'STUDENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  const png = (seed: string) =>
    Buffer.from(`fake-image-${seed}`.repeat(80)).toString('base64');

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
    api = createProductionApi({
      pool,
      authAdapter: new InMemoryAuthAdapter(`up${Date.now()}`),
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
      await c.query(`DELETE FROM upload_analysis WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM uploads WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM learning_state_snapshots WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM skill_states WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM knowledge_gaps WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM evidence WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]);
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('upload -> analyze -> confirm -> append-only evidence -> derived state invalidated', async () => {
    const stamp = Date.now();
    const parent = await reg(`up-p-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Mít', schoolGrade: 4 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    // seed a TWIN snapshot so we can prove confirmation invalidates it
    await api.getParentHome(pAuth, child.childId);
    let snap = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM learning_state_snapshots WHERE child_id = $1 AND kind = 'TWIN'`,
      [child.childId],
    );
    expect(snap.rows[0]!.n).toBe(1);

    const created = await api.createUpload(pAuth, child.childId, {
      kind: 'GRADED_TEST',
      filename: 'bai-kiem-tra.jpg',
      mimeType: 'image/jpeg',
      contentBase64: png('graded-A'),
    });
    expect(created.state).toBe('UPLOADED');

    // the immutable ledger row carries provenance + hash, no bytes
    const led = await pool.query(
      `SELECT actor_user_id, content_hash, storage_key, byte_size FROM uploads WHERE id = $1`,
      [created.uploadId],
    );
    expect(led.rows[0]!.actor_user_id).toBe(parent.userId);
    expect(led.rows[0]!.content_hash).toHaveLength(64);
    expect(String(led.rows[0]!.storage_key)).toContain(`child/${child.childId}/`);

    const analyzed = await api.runUploadAnalysis(pAuth, child.childId, created.uploadId);
    expect(analyzed.state).toBe('NEEDS_CONFIRMATION');
    expect(analyzed.adapterProvider).toBe('mock');
    expect(analyzed.items.length).toBeGreaterThan(0);

    // ledger row was NOT mutated for processing status
    const stillStored = await pool.query(`SELECT status FROM uploads WHERE id = $1`, [created.uploadId]);
    expect(stillStored.rows[0]!.status).toBe('stored');

    // confirm only the auto-selected (high-confidence) items -> evidence
    const res = await api.confirmUploadAnalysis(pAuth, child.childId, created.uploadId, []);
    expect(res.state).toBe('CONFIRMED');

    const ev = await pool.query<{ n: number; tiers: string[] }>(
      `SELECT count(*)::int n, array_agg(DISTINCT confidence_tier) tiers
         FROM evidence WHERE child_id = $1 AND provenance = 'scan'`,
      [child.childId],
    );
    if (analyzed.items.some((i) => i.autoSelected)) {
      expect(ev.rows[0]!.n).toBeGreaterThan(0);
      // scan-derived evidence is STRONG at best — never 'A' (verified)
      expect(ev.rows[0]!.tiers).not.toContain('A');
      // derived state invalidated by the confirmation
      snap = await pool.query<{ n: number }>(
        `SELECT count(*)::int n FROM learning_state_snapshots WHERE child_id = $1 AND kind = 'TWIN'`,
        [child.childId],
      );
      expect(snap.rows[0]!.n).toBe(0);
    }

    // re-confirming a CONFIRMED upload is rejected
    await expect(
      api.confirmUploadAnalysis(pAuth, child.childId, created.uploadId, []),
    ).rejects.toBeTruthy();
  });

  it('a stranger cannot read or upload for a child they do not guard', async () => {
    const stamp = Date.now();
    const parent = await reg(`up-o-${stamp}@x.com`, 'PARENT');
    const stranger = await reg(`up-s-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const sAuth = { bearer: stranger.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Xoài', schoolGrade: 7 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    await expect(api.listUploads(sAuth, child.childId)).rejects.toBeTruthy();
    await expect(
      api.createUpload(sAuth, child.childId, {
        kind: 'NOTEBOOK_PAGE',
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        contentBase64: png('stranger'),
      }),
    ).rejects.toBeTruthy();
  });
});
