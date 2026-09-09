import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';
import {
  PILOT_CONSENT,
  addPilotFamily,
  familyRequiresConsent,
  feedbackRollup,
  hasPilotConsent,
  listPilotFamilies,
  pilotChildRef,
  pilotFamilyRef,
  purgePilotForChild,
  recordParentFeedback,
  recordPilotActivity,
  recordPilotConsent,
  withdrawPilotConsent,
} from './pilot.js';
import { pilotDashboard } from './internal-live-observability.js';

/**
 * doc 70 — Small Family Pilot: consent gate, parent-feedback ledger (append-only,
 * never auto-applied), pseudonymous activity funnel, and the consent guard on
 * LIVE worksheet serving. Against PostgreSQL. NO paid AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const childRefOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

describe.skipIf(!DATABASE_URL)('doc 70 — Small Family Pilot', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-02-14T00:00:00.000Z');
  const children: string[] = [];
  const families: string[] = [];
  const childRefs: string[] = [];
  const familyRefs: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`pilot${Date.now()}`), now });
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const ref of childRefs) {
        await c.query(`DELETE FROM parent_feedback WHERE child_ref = $1`, [ref]).catch(() => {});
        await c.query(`DELETE FROM pilot_activity WHERE child_ref = $1`, [ref]).catch(() => {});
        await c.query(`DELETE FROM worksheet_run_serving WHERE child_ref = $1`, [ref]).catch(() => {});
      }
      for (const ref of familyRefs) {
        await c.query(`DELETE FROM pilot_activity WHERE family_ref = $1`, [ref]).catch(() => {});
        await c.query(`DELETE FROM internal_live_cohort WHERE family_ref = $1`, [ref]).catch(() => {});
      }
      for (const t of ['attempt_answers', 'attempts', 'assignment_items', 'assignments', 'evidence', 'skill_states', 'knowledge_gaps', 'learning_state_snapshots', 'consent_records', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  async function reg(email: string, role: 'PARENT' | 'STUDENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  it('§3 — pilot cohort row carries kind=pilot + consent_required', async () => {
    const ref = pilotFamilyRef(`pilot-fam-${Date.now()}`);
    familyRefs.push(ref);
    await addPilotFamily(pool, ref, { note: 'test family', actorRef: 'test' });
    expect(await familyRequiresConsent(pool, ref)).toBe(true);
    const list = await listPilotFamilies(pool);
    const row = list.find((f) => f.familyRef === ref);
    expect(row?.kind).toBe('pilot');
    expect(row?.consentRequired).toBe(true);
  }, 20_000);

  it('§4 — guardian consent records, reads back, and withdraws', async () => {
    const stamp = Date.now();
    const parent = await reg(`pil-c-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Consent', schoolGrade: 4 });
    children.push(child.childId);
    childRefs.push(childRefOf(child.childId));
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    expect(await hasPilotConsent(pool, child.childId)).toBe(false);
    const { consentId } = await recordPilotConsent(pool, { childId: child.childId, grantedByUserId: parent.userId });
    expect(consentId).toBeTruthy();
    expect(await hasPilotConsent(pool, child.childId)).toBe(true);

    const row = await pool.query<{ purpose: string; processor: string; policy_version: string }>(
      `SELECT purpose, processor, policy_version FROM consent_records WHERE id = $1`,
      [consentId],
    );
    expect(row.rows[0]!.purpose).toBe(PILOT_CONSENT.purpose);
    expect(row.rows[0]!.processor).toBe(PILOT_CONSENT.processor);

    const n = await withdrawPilotConsent(pool, child.childId);
    expect(n).toBe(1);
    expect(await hasPilotConsent(pool, child.childId)).toBe(false);
  }, 20_000);

  it('§5 — parent feedback is append-only, carries a hypothesis, and never auto-applies to mastery', async () => {
    const stamp = Date.now();
    const parent = await reg(`pil-f-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Feedback', schoolGrade: 7 });
    children.push(child.childId);
    const cref = childRefOf(child.childId);
    childRefs.push(cref);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    const masteryBefore = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM skill_states WHERE child_id = $1`, [child.childId])).rows[0]!.n;

    const res = await api.submitParentFeedback(pAuth, child.childId, { verdict: 'TOO_HARD', note: 'con làm mãi không xong' });
    expect(res.feedbackId).toBeTruthy();
    expect(res.hypothesis).toMatch(/above the child/i);

    // append-only — UPDATE and DELETE are rejected by the ledger trigger
    await expect(pool.query(`UPDATE parent_feedback SET verdict = 'SUITABLE' WHERE id = $1`, [res.feedbackId])).rejects.toThrow();
    await expect(pool.query(`DELETE FROM parent_feedback WHERE id = $1`, [res.feedbackId])).rejects.toThrow();

    // mastery is untouched by the feedback event
    const masteryAfter = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM skill_states WHERE child_id = $1`, [child.childId])).rows[0]!.n;
    expect(masteryAfter).toBe(masteryBefore);

    const rollup = await feedbackRollup(pool, '2026-01-01T00:00:00Z');
    expect(rollup.total).toBeGreaterThanOrEqual(1);
    expect(rollup.byVerdict.TOO_HARD).toBeGreaterThanOrEqual(1);
    expect(rollup.hypotheses).toBeGreaterThanOrEqual(1);

    // invalid verdict rejected
    await expect(api.submitParentFeedback(pAuth, child.childId, { verdict: 'NONSENSE' as never })).rejects.toThrow();
  }, 20_000);

  it('§4 — LIVE serving is blocked for a pilot family until guardian consent is on file', async () => {
    const stamp = Date.now();
    const parent = await reg(`pil-g-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Gate', schoolGrade: 4 });
    children.push(child.childId);
    const cref = childRefOf(child.childId);
    childRefs.push(cref);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    const familyId = fam.rows[0]!.family_id;
    families.push(familyId);
    const fref = pilotFamilyRef(familyId);
    familyRefs.push(fref);
    await addPilotFamily(pool, fref, { note: 'gate test', actorRef: 'test' });

    const runId = `pilrun-${stamp}`;
    runIds.push(runId);
    const items = [
      { orderIndex: 0, questionRef: `q-${stamp}-1`, skillId: 'M4.ARITH.MUL_2DIGIT', problemTypeId: null, knowledgeLevel: 2, thinkingLevel: 2, prompt: { text: 'Tính 12 × 3.' }, answerSpec: { kind: 'numeric', value: 36, tolerance: 0 }, hints: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ];
    const insertServe = () =>
      pool.query(
        `INSERT INTO worksheet_run_serving (run_id, child_ref, generation_spec_id, items, state)
         VALUES ($1, $2, $3, $4::jsonb, 'PENDING') ON CONFLICT (run_id) DO NOTHING`,
        [runId, cref, `egs_${runId}`, JSON.stringify(items)],
      );

    // no consent yet → the pending worksheet is skipped, no assignment served
    await insertServe();
    const list1 = await api.getChildAssignments(pAuth, child.childId);
    expect(list1.filter((a) => a.mode === 'WORKSHEET').length).toBe(0);
    const skipRow = await pool.query<{ state: string; skip_reason: string | null }>(`SELECT state, skip_reason FROM worksheet_run_serving WHERE run_id = $1`, [runId]);
    expect(skipRow.rows[0]!.state).toBe('SKIPPED');
    expect(skipRow.rows[0]!.skip_reason).toMatch(/consent/i);

    // grant consent, re-queue → now it serves
    await recordPilotConsent(pool, { childId: child.childId, grantedByUserId: parent.userId });
    const runId2 = `pilrun2-${stamp}`;
    runIds.push(runId2);
    await pool.query(
      `INSERT INTO worksheet_run_serving (run_id, child_ref, generation_spec_id, items, state)
       VALUES ($1, $2, $3, $4::jsonb, 'PENDING')`,
      [runId2, cref, `egs_${runId2}`, JSON.stringify(items)],
    );
    const list2 = await api.getChildAssignments(pAuth, child.childId);
    expect(list2.filter((a) => a.mode === 'WORKSHEET').length).toBe(1);
  }, 20_000);

  it('§6/§10 — pilot activity funnel + dashboard are pseudonymous (no child content)', async () => {
    const fref = pilotFamilyRef(`pilot-dash-${Date.now()}`);
    const cref = pilotChildRef(`pilot-dash-child-${Date.now()}`);
    familyRefs.push(fref);
    childRefs.push(cref);
    for (const ev of ['profile_created', 'today_viewed', 'first_worksheet_generated', 'practice_completed'] as const) {
      await recordPilotActivity(pool, { familyRef: fref, childRef: cref, actor: 'PARENT', event: ev });
    }
    const d = await pilotDashboard(pool, { sinceIso: '2026-01-01T00:00:00Z' });
    expect(d.activation.todayViewed).toBeGreaterThanOrEqual(1);
    expect(d.engagement.practiceCompletes).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/Tính|Đáp số|workedSolution/);
  }, 20_000);

  it('§13 — child-deletion purge removes pilot feedback + activity', async () => {
    const cref = pilotChildRef(`pilot-del-${Date.now()}`);
    childRefs.push(cref);
    await recordParentFeedback(pool, { childRef: cref, verdict: 'SUITABLE' });
    await recordPilotActivity(pool, { familyRef: 'fref-del', childRef: cref, actor: 'PARENT', event: 'today_viewed' });
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = replica`); // parent_feedback is append-only
      const n = await purgePilotForChild(client, cref);
      await client.query(`SET session_replication_role = origin`);
      expect(n).toBeGreaterThanOrEqual(2);
    } finally {
      client.release();
    }
    const left = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM parent_feedback WHERE child_ref = $1`, [cref]);
    expect(left.rows[0]!.n).toBe(0);
  }, 20_000);
});
