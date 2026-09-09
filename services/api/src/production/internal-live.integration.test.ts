import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';
import {
  resolveKillSwitch,
  setKillSwitch,
  addToInternalLiveCohort,
  isInInternalLiveCohort,
  listInternalLiveCohort,
  removeFromInternalLiveCohort,
  recordInternalLiveSpend,
  internalLiveBudgetGate,
  scanInternalLiveSafety,
  enforceSafetyAutoStop,
  familyRef,
} from './internal-live.js';
import { internalLiveDashboard, purgeExpiredQaSamples } from './internal-live-observability.js';

/**
 * doc 69 — Controlled Internal LIVE: cohort / kill switch / budget ledger /
 * safety auto-stop / serving → assignment → learning loop, against PostgreSQL.
 * NO paid AI (the serving intent is inserted directly).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const childRefOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

describe.skipIf(!DATABASE_URL)('doc 69 — Controlled Internal LIVE', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-02-10T00:00:00.000Z');
  const children: string[] = [];
  const families: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`il${Date.now()}`), now });
    await setKillSwitch(pool, false, { reason: 'test reset', source: 'manual', actorRef: 'test' });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM worksheet_run_serving WHERE run_id = ANY($1::text[])`, [runIds]).catch(() => {});
      await c.query(`DELETE FROM internal_live_qa_sample WHERE run_id = ANY($1::text[])`, [runIds]).catch(() => {});
      for (const t of ['attempt_answers', 'attempts', 'assignment_items', 'assignments', 'evidence', 'skill_states', 'knowledge_gaps', 'learning_state_snapshots', 'child_profiles', 'families']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM internal_live_cohort WHERE family_ref = ANY($1::text[])`, [families.map(familyRef)]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  });

  async function reg(email: string, role: 'PARENT' | 'STUDENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  it('§1/§2 — kill switch (db) survives a read and is cleared', async () => {
    expect((await resolveKillSwitch(pool, {})).active).toBe(false);
    await setKillSwitch(pool, true, { reason: 'manual test', source: 'manual', actorRef: 'test' });
    const on = await resolveKillSwitch(pool, {});
    expect(on.active).toBe(true);
    expect(on.source).toBe('db');
    await setKillSwitch(pool, false, { reason: 'clear', source: 'manual', actorRef: 'test' });
    expect((await resolveKillSwitch(pool, {})).active).toBe(false);
  });

  it('§1 — cohort CRUD (pseudonymous family refs)', async () => {
    const ref = familyRef(`fam-cohort-${Date.now()}`);
    expect(await isInInternalLiveCohort(pool, ref)).toBe(false);
    await addToInternalLiveCohort(pool, ref, { wave: 1, note: 'test', actorRef: 'test' });
    expect(await isInInternalLiveCohort(pool, ref)).toBe(true);
    expect((await listInternalLiveCohort(pool)).some((m) => m.familyRef === ref)).toBe(true);
    await removeFromInternalLiveCohort(pool, ref, 'test');
    expect(await isInInternalLiveCohort(pool, ref)).toBe(false);
    await pool.query(`DELETE FROM internal_live_cohort WHERE family_ref = $1`, [ref]);
  });

  it('§3 — budget ledger + gate degrades safely on exhaustion', async () => {
    const env = { INTERNAL_LIVE_GEN_DAILY_CAP_USD: '0.10' };
    expect((await internalLiveBudgetGate(pool, env, 'generation', 0.05)).ok).toBe(true);
    await recordInternalLiveSpend(pool, 'generation', 0.09, 3, now);
    const gate = await internalLiveBudgetGate(pool, env, 'generation', 0.05, now);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/daily cap .* reached/);
    await pool.query(`DELETE FROM internal_live_spend WHERE spend_date = $1`, [now().toISOString().slice(0, 10)]);
  });

  it('§4 — safety scan is clean on a fresh window; enforce is a no-op', async () => {
    const scan = await scanInternalLiveSafety(pool, { sinceIso: '2099-01-01T00:00:00Z' });
    expect(scan.critical).toBe(false);
    expect(scan.wrongAccepted).toBe(0);
    expect(scan.unsafeDelivered).toBe(0);
    const { tripped } = await enforceSafetyAutoStop(pool, { sinceIso: '2099-01-01T00:00:00Z' });
    expect(tripped).toBe(false);
    expect((await resolveKillSwitch(pool, {})).active).toBe(false);
  });

  it('§5/§6 — pending LIVE worksheet → AI_GENERATED assignment → submit → evidence → twin moves', async () => {
    const stamp = Date.now();
    const parent = await reg(`il-p-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Live', schoolGrade: 4 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    // simulate a completed LIVE run: two verified items held for this child.
    const runId = `ilrun-${stamp}`;
    runIds.push(runId);
    const items = [
      { orderIndex: 0, questionRef: `q-${stamp}-1`, skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 2, thinkingLevel: 2, prompt: { text: 'Tính 12 × 3.' }, answerSpec: { kind: 'numeric', value: 36, tolerance: 0 }, hints: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { orderIndex: 1, questionRef: `q-${stamp}-2`, skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 2, thinkingLevel: 2, prompt: { text: 'Tính 21 × 4.' }, answerSpec: { kind: 'numeric', value: 84, tolerance: 0 }, hints: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ];
    await pool.query(
      `INSERT INTO worksheet_run_serving (run_id, child_ref, generation_spec_id, items, state)
       VALUES ($1, $2, $3, $4::jsonb, 'PENDING')`,
      [runId, childRefOf(child.childId), `egs_${runId}`, JSON.stringify(items)],
    );

    // the authenticated request serves it as an assignment
    const list = await api.getChildAssignments(pAuth, child.childId);
    const ai = list.find((a) => a.mode === 'WORKSHEET');
    expect(ai, 'AI_GENERATED assignment served').toBeTruthy();
    const srcRow = await pool.query<{ source: string; state: string }>(`SELECT source FROM assignments WHERE id = $1`, [ai!.id]);
    expect(srcRow.rows[0]!.source).toBe('AI_GENERATED');
    // the held content is now nulled (SERVED)
    const serveRow = await pool.query<{ state: string; items: unknown }>(`SELECT state, items FROM worksheet_run_serving WHERE run_id = $1`, [runId]);
    expect(serveRow.rows[0]!.state).toBe('SERVED');
    expect(serveRow.rows[0]!.items).toBeNull();
    // idempotent — a second request does not double-serve
    const list2 = await api.getChildAssignments(pAuth, child.childId);
    expect(list2.filter((a) => a.mode === 'WORKSHEET').length).toBe(1);

    // link a student + submit correct answers
    const student = await reg(`il-s-${stamp}@x.com`, 'STUDENT');
    const { IdentityService } = await import('@copilot/identity');
    const { PgIdentityStore } = await import('@copilot/identity/pg');
    const idSvc = new IdentityService({ store: new PgIdentityStore(pool), auth: new InMemoryAuthAdapter(), now });
    await idSvc.linkStudentAccount({ studentUserId: student.userId as never, childId: child.childId, linkMethod: 'PARENT_INVITE', linkedByUserId: parent.userId as never });
    const sAuth = { bearer: student.bearer, workspace: 'STUDENT' as const };

    const detail = await api.getAssignmentDetail(sAuth, ai!.id);
    const evBefore = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [child.childId])).rows[0]!.n;
    await api.submitPractice(
      sAuth,
      ai!.id,
      detail.items.map((it, i) => ({ assignmentItemId: it.id, answer: i === 0 ? '36' : '84', hintsUsed: 0 })),
    );
    const evAfter = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [child.childId])).rows[0]!.n;
    expect(evAfter).toBeGreaterThan(evBefore); // append-only evidence flowed

    // the learning loop closed — a Parent Progress read recomputes the Twin with the new evidence
    const progress = await api.getParentProgress(pAuth, child.childId);
    expect(progress.child.childId).toBe(child.childId);
    const skillRow = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM skill_states WHERE child_id = $1 AND skill_id = 'M4.ARITH.MUL_2DIGIT'`,
      [child.childId],
    );
    expect(skillRow.rows[0]!.n).toBe(1); // mastery state now exists for the practised skill
  }, 20_000);

  it('§7 — internalLiveDashboard is privacy-safe (no child content, returns budgets + kill state)', async () => {
    const d = await internalLiveDashboard(pool, { sinceIso: '2099-01-01T00:00:00Z' });
    expect(d.killSwitch.active).toBe(false);
    expect(d.budgets.genDailyCapUsd).toBeGreaterThan(0);
    expect(d.budgets.xcheckDailyCapUsd).toBeGreaterThan(0);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/Tính|Đáp số|workedSolution|prompt/);
  });

  it('§8 — QA sample retention purge nulls content, keeps the operational row', async () => {
    const runId = `ilqa-${Date.now()}`;
    runIds.push(runId);
    await pool.query(
      `INSERT INTO internal_live_qa_sample (id, run_id, generation_spec_id, child_ref, item_id, prompt_snapshot, retention_until)
       VALUES (gen_random_uuid(), $1, $2, 'cref', 'i1', 'secret prompt', now() - interval '1 day')`,
      [runId, `egs_${runId}`],
    );
    const purged = await purgeExpiredQaSamples(pool);
    expect(purged).toBeGreaterThanOrEqual(1);
    const row = await pool.query<{ prompt_snapshot: string | null; purged: boolean }>(`SELECT prompt_snapshot, purged FROM internal_live_qa_sample WHERE run_id = $1`, [runId]);
    expect(row.rows[0]!.prompt_snapshot).toBeNull();
    expect(row.rows[0]!.purged).toBe(true);
  });
});
