import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { InMemoryUploadStorageAdapter } from '@copilot/uploads';
import { createProductionApi } from './production-api.js';
import { uploadRetentionDays, purgeExpiredUploadBytes } from './upload-retention.js';

/** Backlog B3-04 — the daily jobs, and the 30-day raw-photo promise made in the consent centre. */
const DATABASE_URL = process.env.DATABASE_URL;

describe('uploadRetentionDays (pure)', () => {
  it('defaults to 30 and ignores nonsense', () => {
    expect(uploadRetentionDays({})).toBe(30);
    expect(uploadRetentionDays({ UPLOAD_RETENTION_DAYS: '7' })).toBe(7);
    expect(uploadRetentionDays({ UPLOAD_RETENTION_DAYS: '0' })).toBe(30);
    expect(uploadRetentionDays({ UPLOAD_RETENTION_DAYS: 'abc' })).toBe(30);
    expect(uploadRetentionDays({ UPLOAD_RETENTION_DAYS: '9999' })).toBe(30);
  });
});

describe.skipIf(!DATABASE_URL)('raw-photo retention + scheduled jobs', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const storage = new InMemoryUploadStorageAdapter();
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  async function setup() {
    const me = await api.register({ email: `ret-${Date.now()}-${Math.random()}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: 'R' });
    users.push(me.userId);
    const bearer = (await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId])).rows[0]!.auth_user_id;
    const auth = { bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(auth, { displayName: 'Bé R', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    return { auth, childId: child.childId };
  }

  const upload = (auth: { bearer: string; workspace: 'PARENT' }, childId: string, tag: string) =>
    api.createUpload(auth, childId, {
      kind: 'HOMEWORK',
      filename: `${tag}.jpg`,
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from(`img-${tag}`.repeat(40)).toString('base64'),
    });

  /** `uploads` is append-only; moving its date needs the trigger switched off, as the deletion workflow does. */
  async function backdate(uploadId: string, daysAgo: number) {
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`UPDATE uploads SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [uploadId, daysAgo]);
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
  }
  const purgedAt = async (uploadId: string) =>
    (await pool.query<{ bytes_purged_at: Date | null }>(`SELECT bytes_purged_at FROM upload_analysis WHERE upload_id = $1`, [uploadId])).rows[0]!.bytes_purged_at;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`ret${Date.now()}`), now: () => new Date(), uploadStorage: storage });
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of ['upload_analysis', 'uploads']) await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  it('removes bytes older than the window, keeps recent ones, and is idempotent', async () => {
    const { auth, childId } = await setup();
    const old = await upload(auth, childId, 'old');
    const fresh = await upload(auth, childId, 'fresh');
    await backdate(old.uploadId, 31);
    const removeSpy: string[] = [];
    const spy = { ...storage, name: storage.name, put: storage.put.bind(storage), getBytes: storage.getBytes.bind(storage), remove: async (k: string) => { removeSpy.push(k); return storage.remove(k); } };

    const r1 = await purgeExpiredUploadBytes(pool, spy, new Date(), 30);
    expect(r1.failed).toBe(0);
    expect(r1.removed).toBeGreaterThanOrEqual(1);
    expect(await purgedAt(old.uploadId)).not.toBeNull();
    expect(await purgedAt(fresh.uploadId)).toBeNull();

    const before = removeSpy.length;
    await purgeExpiredUploadBytes(pool, spy, new Date(), 30);
    expect(removeSpy.length).toBe(before); // already purged → not touched again
  });

  it('a storage failure is not marked purged, so tomorrow retries it', async () => {
    const { auth, childId } = await setup();
    const u = await upload(auth, childId, 'flaky');
    await backdate(u.uploadId, 40);
    const broken = { ...storage, name: 'broken', put: storage.put.bind(storage), getBytes: storage.getBytes.bind(storage), remove: async () => { throw new Error('storage down'); } };
    const r = await purgeExpiredUploadBytes(pool, broken, new Date(), 30);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(await purgedAt(u.uploadId)).toBeNull();
  });

  it('a purged photo cannot be re-read, and the parent is told why', async () => {
    const { auth, childId } = await setup();
    const u = await upload(auth, childId, 'gone');
    await backdate(u.uploadId, 35);
    await purgeExpiredUploadBytes(pool, storage, new Date(), 30);
    await expect(api.runUploadAnalysis(auth, childId, u.uploadId)).rejects.toThrow(/đã được xoá/);
  });

  it('runSafetyAutoStop is a quiet no-op when there is nothing unsafe', async () => {
    const r = await api.runSafetyAutoStop();
    expect(r.tripped).toBe(false);
  });

  it('runScheduledJobs runs every job and reports each result', async () => {
    const r = await api.runScheduledJobs();
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['ranAt', 'inactivityReminders', 'uploadRetention', 'internalLiveMaintenance']));
    expect(JSON.stringify(r)).not.toMatch(/"error"/);
  });
});
