import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import type { Notification } from '@copilot/domain';
import type { NotificationDeliveryAdapter } from '@copilot/revision';
import { createProductionApi } from './production-api.js';
import { runInactivityReminders } from './reminders.js';

/** Backlog B2-04 — inactivity reminders against real PostgreSQL, with a fake delivery channel. */
const DATABASE_URL = process.env.DATABASE_URL;

class FakeChannel implements NotificationDeliveryAdapter {
  readonly name = 'fake';
  readonly sent: { to: string; n: Notification }[] = [];
  send(to: string, n: Notification) {
    this.sent.push({ to, n });
    return Promise.resolve({ delivered: true });
  }
}

describe.skipIf(!DATABASE_URL)('inactivity reminders', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];
  const NOW = new Date('2026-11-10T03:00:00.000Z'); // 10:00 in Vietnam
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  async function newChild(tag: string) {
    const me = await api.register({ email: `rm-${tag}-${Date.now()}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: tag });
    users.push(me.userId);
    const bearer = (await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId])).rows[0]!.auth_user_id;
    const auth = { bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(auth, { displayName: `Bé ${tag}`, schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    return { auth, childId: child.childId, parentId: me.userId };
  }

  const giveWork = (childId: string, createdAt: Date) =>
    pool.query(`INSERT INTO assignments (child_id, created_at) VALUES ($1, $2)`, [childId, createdAt]);
  const attempt = (childId: string, at: Date) =>
    pool.query(`INSERT INTO attempts (child_id, status, started_at, submitted_at) VALUES ($1, 'SUBMITTED', $2, $2)`, [childId, at]);

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`rm${Date.now()}`), now: () => NOW });
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of ['reminder_log', 'attempts', 'assignments', 'student_account_links', 'parent_child_relationships', 'child_profiles']) {
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

  it('reminds the guardian of a child idle for 2 days, once per day', async () => {
    const { childId, parentId } = await newChild('idle');
    await giveWork(childId, daysAgo(6));
    await attempt(childId, daysAgo(2));
    const ch = new FakeChannel();

    const first = await runInactivityReminders(pool, ch, NOW, childId);
    expect(first.sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0]!.to).toBe(parentId);
    expect(ch.sent[0]!.n.type).toBe('practice_reminder');
    expect(ch.sent[0]!.n.title).toContain('2 ngày');

    const again = await runInactivityReminders(pool, ch, NOW, childId);
    expect(again.sent).toBe(0);
    expect(ch.sent).toHaveLength(1);
  });

  it('does not remind when the child practised yesterday, or was never given work', async () => {
    const active = await newChild('active');
    await giveWork(active.childId, daysAgo(6));
    await attempt(active.childId, daysAgo(1));
    const fresh = await newChild('fresh');
    const ch = new FakeChannel();
    await runInactivityReminders(pool, ch, NOW, active.childId);
    await runInactivityReminders(pool, ch, NOW, fresh.childId);
    expect(ch.sent).toHaveLength(0);
  });

  it('honours the parent switch', async () => {
    const { auth, childId } = await newChild('off');
    await giveWork(childId, daysAgo(6));
    await attempt(childId, daysAgo(4));
    await api.setChildPreferences(auth, childId, { dailyMinutes: 20, goal: 'KEEP_PACE', reminders: false });
    expect((await api.getChildPreferences(auth, childId)).reminders).toBe(false);
    const ch = new FakeChannel();
    await runInactivityReminders(pool, ch, NOW, childId);
    expect(ch.sent).toHaveLength(0);
    await api.setChildPreferences(auth, childId, { dailyMinutes: 20, goal: 'KEEP_PACE', reminders: true });
    await runInactivityReminders(pool, ch, NOW, childId);
    expect(ch.sent).toHaveLength(1);
  });

  it('uses no delivery channel without logging a phantom reminder', async () => {
    const { childId } = await newChild('noop');
    await giveWork(childId, daysAgo(6));
    await attempt(childId, daysAgo(4));
    const noop: NotificationDeliveryAdapter = { name: 'noop', send: () => Promise.resolve({ delivered: false }) };
    const r = await runInactivityReminders(pool, noop, NOW, childId);
    expect(r.sent).toBe(0);
    const n = Number((await pool.query<{ n: string }>(`SELECT count(*) n FROM reminder_log WHERE child_id = $1`, [childId])).rows[0]!.n);
    expect(n).toBe(0);
  });

  it('status endpoint reports idle days for the banner; another family is refused', async () => {
    const mine = await newChild('status');
    const other = await newChild('stranger');
    await giveWork(mine.childId, daysAgo(9));
    await attempt(mine.childId, daysAgo(3));
    const s = await api.getInactivityStatus(mine.auth, mine.childId);
    expect(s).toMatchObject({ inactiveDays: 3, needsNudge: true, remindersEnabled: true });
    await expect(api.getInactivityStatus(other.auth, mine.childId)).rejects.toThrow();
  });
});
