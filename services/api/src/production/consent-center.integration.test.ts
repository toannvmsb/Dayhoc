import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * Backlog B3-03 — consent management screen + data export. Real PostgreSQL, no AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('consent center + child data export', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  async function newChild(tag: string) {
    const parent = await reg(`cc-${tag}-${Date.now()}@x.com`);
    const auth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(auth, { displayName: `Bé ${tag}`, schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    return { auth, childId: child.childId, userId: parent.userId };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`cc${Date.now()}`), now: () => new Date() });
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM rights_requests WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      for (const t of ['consent_records', 'child_credentials', 'student_account_links', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  it('starts with every consent off and an empty timeline', async () => {
    const { auth, childId } = await newChild('fresh');
    const c = await api.getConsentCenter(auth, childId);
    expect(c.consents.length).toBeGreaterThan(0);
    expect(c.consents.every((x) => !x.active)).toBe(true);
    expect(c.history).toEqual([]);
    expect(c.dataNotes.length).toBeGreaterThan(0);
  });

  it('grant → withdraw → grant is recorded as an append-only timeline, newest first', async () => {
    const { auth, childId } = await newChild('flow');
    let c = await api.setConsent(auth, childId, 'ai_content', true);
    expect(c.consents[0]!.active).toBe(true);
    c = await api.setConsent(auth, childId, 'ai_content', false);
    expect(c.consents[0]!.active).toBe(false);
    c = await api.setConsent(auth, childId, 'ai_content', true);
    expect(c.consents[0]!.active).toBe(true);
    expect(c.history.map((h) => h.action)).toEqual(['GRANTED', 'WITHDRAWN', 'GRANTED']);
    expect(c.history.every((h) => h.method.length > 0 && h.policyVersion.length > 0)).toBe(true);
  });

  it('repeating the current choice writes nothing (the ledger holds decisions, not clicks)', async () => {
    const { auth, childId } = await newChild('idem');
    await api.setConsent(auth, childId, 'ai_content', true);
    await api.setConsent(auth, childId, 'ai_content', true);
    await api.setConsent(auth, childId, 'ai_content', false);
    await api.setConsent(auth, childId, 'ai_content', false);
    const n = Number((await pool.query<{ n: string }>(`SELECT count(*) n FROM consent_records WHERE child_id = $1`, [childId])).rows[0]!.n);
    expect(n).toBe(2);
  });

  it('rejects an unknown consent kind', async () => {
    const { auth, childId } = await newChild('kind');
    await expect(api.setConsent(auth, childId, 'sell_everything', true)).rejects.toThrow();
  });

  it('another family cannot read or change a child consent, nor export it', async () => {
    const a = await newChild('own');
    const b = await newChild('other');
    await expect(api.getConsentCenter(b.auth, a.childId)).rejects.toThrow();
    await expect(api.setConsent(b.auth, a.childId, 'ai_content', true)).rejects.toThrow();
    await expect(api.exportChildData(b.auth, a.childId)).rejects.toThrow();
  });

  it('export contains the child data, never password material, and is logged as a rights request', async () => {
    const { auth, childId, userId } = await newChild('export');
    await api.createStudentAccess(auth, childId, { username: `kid${Date.now() % 100000}`, password: 'kidpass123' });
    await api.setConsent(auth, childId, 'ai_content', true);

    const bundle = await api.exportChildData(auth, childId);
    expect(bundle.format).toBe('dayzi.child-data-export.v1');
    expect(bundle.childId).toBe(childId);
    expect(bundle.tables.child_profile).toHaveLength(1);
    expect(bundle.tables.consent_records).toHaveLength(1);
    expect(bundle.tables.student_account).toHaveLength(1);
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/password_hash|pin_hash|storage_key/);
    expect(bundle.unavailable).toEqual([]);

    const log = await pool.query(`SELECT kind, requested_by, fulfilled_at FROM rights_requests WHERE child_id = $1`, [childId]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ kind: 'export', requested_by: userId });
    expect(log.rows[0].fulfilled_at).not.toBeNull();
  });
});
