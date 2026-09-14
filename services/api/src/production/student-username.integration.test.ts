import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * P-03 — the parent chooses the child's login username (not an opaque
 * generated id), checked for uniqueness across every account on the system.
 * Against PostgreSQL. No paid AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('doc — parent-chosen student username', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-03-01T00:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`su${Date.now()}`), now });
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM student_account_links WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    users.push(me.userId);
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  it('parent-chosen username is stored, returned, and rejects a shape violation', async () => {
    const stamp = Date.now();
    const parent = await reg(`su-p1-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Username', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    // shape violations rejected before any account is created — same child,
    // no account exists yet so each attempt hits the "create" branch fresh.
    await expect(api.createStudentAccess(pAuth, child.childId, { username: 'ab', password: 'kidpass123' })).rejects.toThrow(/3-20/);
    await expect(api.createStudentAccess(pAuth, child.childId, { username: '2fast2furious', password: 'kidpass123' })).rejects.toThrow(/3-20/);
    expect(await api.getStudentAccess(pAuth, child.childId)).toBeNull();

    const uname = `beminh${stamp}`.slice(0, 18);
    const res = await api.createStudentAccess(pAuth, child.childId, { username: uname, password: 'kidpass123' });
    expect(res.username).toBe(uname);
    expect(res.loginEmail).toBe(`${uname}@dayzi.local`);

    const status = await api.getStudentAccess(pAuth, child.childId);
    expect(status?.username).toBe(uname);
    expect(status?.status).toBe('ACTIVE');
  }, 20_000);

  it('a duplicate username is refused — case-insensitive, across different parents', async () => {
    const stamp = Date.now();
    const uname = `trung${stamp}`.slice(0, 18);

    const parentA = await reg(`su-p2a-${stamp}@x.com`);
    const aAuth = { bearer: parentA.bearer, workspace: 'PARENT' as const };
    const childA = await api.createChild(aAuth, { displayName: 'Con A', schoolGrade: 4 });
    children.push(childA.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [childA.childId])).rows[0]!.family_id);
    await api.createStudentAccess(aAuth, childA.childId, { username: uname, password: 'kidpass123' });

    const parentB = await reg(`su-p2b-${stamp}@x.com`);
    const bAuth = { bearer: parentB.bearer, workspace: 'PARENT' as const };
    const childB = await api.createChild(bAuth, { displayName: 'Con B', schoolGrade: 7 });
    children.push(childB.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [childB.childId])).rows[0]!.family_id);

    // exact + differently-cased collision, both refused
    await expect(api.createStudentAccess(bAuth, childB.childId, { username: uname, password: 'kidpass123' })).rejects.toThrow(/đã có người dùng/);
    await expect(api.createStudentAccess(bAuth, childB.childId, { username: uname.toUpperCase(), password: 'kidpass123' })).rejects.toThrow(/đã có người dùng/);

    // no account was created for child B
    const statusB = await api.getStudentAccess(bAuth, childB.childId);
    expect(statusB).toBeNull();
  }, 20_000);

  it('the child signs in with exactly the username the parent chose', async () => {
    const stamp = Date.now();
    const parent = await reg(`su-p3-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Login', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    const uname = `dangnhap${stamp}`.slice(0, 18);
    await api.createStudentAccess(pAuth, child.childId, { username: uname, password: 'kidpass123' });

    // this is exactly what the web login action builds from a bare (no "@") typed value
    const signIn = await api.signIn({ email: `${uname}@dayzi.local`, password: 'kidpass123' });
    expect(signIn.bearer).toBeTruthy();
    const who = await api.whoami(signIn.bearer);
    expect(who.roles).toContain('STUDENT');
  }, 20_000);
});
