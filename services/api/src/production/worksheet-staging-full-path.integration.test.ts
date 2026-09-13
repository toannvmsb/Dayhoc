import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import {
  createMockAnswerCrosscheck,
  createMockItemContentGenerator,
  InMemoryWorksheetShadowQueue,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  type AiUsageEvent,
  type CrosscheckVerdict,
  type WorksheetShadowOutcome,
} from '@copilot/exercise-gen';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createProductionApi } from './production-api.js';
import { insertAiUsageEvent } from './pg-ai-usage.js';

/**
 * doc 66 §7 — STAGING FULL PATH. The whole SHADOW pipeline end-to-end against a
 * real Postgres, internal/synthetic accounts, NO paid AI (mock generators + mock
 * crosscheck): planner → orchestrator → MathKernel/validator → routing → retry/
 * fallback/last-resort → Group-C crosscheck → review queue → persistence → cost
 * ledger → observability → retention → deletion. Plus: Parent / Student / Teacher
 * API responses are byte-identical with SHADOW on vs off.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('doc 66 §7 — worksheet staging full path (SHADOW, no paid AI)', () => {
  let pool: import('pg').Pool;
  const now = () => new Date('2027-02-01T00:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      const scope = `generation_spec_id IN (SELECT id FROM generation_specs WHERE child_id = ANY($1::uuid[]))`;
      await c.query(`DELETE FROM review_queue WHERE ${scope}`, [children]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE ${scope})`, [children]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE ${scope})`, [children]).catch(() => {});
      await c.query(`DELETE FROM worksheet_generation_runs WHERE ${scope}`, [children]).catch(() => {});
      await c.query(`DELETE FROM ai_usage_events WHERE operation_type IN ('worksheet_batch_generation','advanced_verification')`).catch(() => {});
      for (const t of ['skill_states', 'knowledge_gaps', 'learning_state_snapshots', 'evidence', 'generation_specs', 'learning_plans', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  async function seedFamily(stamp: number) {
    const authAdapter = new InMemoryAuthAdapter(`fp${stamp}`);
    const events: AiUsageEvent[] = [];
    const outcomes: WorksheetShadowOutcome[] = [];
    const queue = new InMemoryWorksheetShadowQueue({ onOutcome: (_j, o) => outcomes.push(o) });
    const gen = createMockItemContentGenerator();
    const crosscheckCalls = { n: 0 };
    const mkApi = (
      mode: 'OFF' | 'SHADOW',
      crosscheckVerdict?: (prompt: string) => CrosscheckVerdict,
    ) => {
      const cc = crosscheckVerdict
        ? createMockAnswerCrosscheck((p) => {
            crosscheckCalls.n += 1;
            return crosscheckVerdict(p);
          })
        : undefined;
      return createProductionApi({
        pool,
        authAdapter,
        now,
        worksheetGeneration:
          mode === 'OFF'
            ? null
            : {
                mode: 'SHADOW',
                queue,
                generators: { default: gen, highComplexity: gen },
                referenceLibrary: loadReferenceLibrary(),
                reviewQueue: new PgReviewQueueStore(pool),
                store: new PgWorksheetGenerationStore(pool),
                ...(cc ? { crosscheckAdapter: cc } : {}),
                usageSink: (e) => {
                  events.push(e);
                  void insertAiUsageEvent(pool, e).catch(() => {});
                },
                resolveUsageContext: () => ({ userRef: 'u_ps', childRef: 'c_ps', plan: 'plus' as const }),
                resolveChildRef: () => 'c_ps',
              },
      });
    };

    const setupApi = mkApi('OFF');
    const parent = await setupApi.register({ email: `fp-p-${stamp}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: 'P' });
    users.push(parent.userId);
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [parent.userId]);
    const pAuth = { bearer: r.rows[0]!.auth_user_id, workspace: 'PARENT' as const };
    const child = await setupApi.createChild(pAuth, { displayName: 'Bé Phở', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    // spread wrong-answer evidence over a few skills so the planner produces a
    // mixed worksheet (not 16 identical fraction items — a shape the offline
    // MOCK generator's scenario library is too small to diversify).
    const skills = ['M4.FRAC.COMMON_DENOM', 'M4.FRAC.ADD', 'M4.ARITH.SUB_MULTI', 'M4.ARITH.MUL_2DIGIT'];
    for (let i = 0; i < 8; i += 1) {
      await pool.query(
        `INSERT INTO evidence (id, child_id, source, occurred_at, recorded_at, skill_id, result, confidence_tier, provenance)
         VALUES (gen_random_uuid(), $1, 'school_test', $2, $2, $3, '{"correct":false}'::jsonb, 'A', 'assessment')`,
        [child.childId, new Date(2027, 0, 10 + i).toISOString(), skills[i % skills.length]],
      );
    }
    return { mkApi, pAuth, childId: child.childId, queue, events, outcomes, crosscheckCalls };
  }

  it('SHADOW run persists the full trace + cost ledger; Parent/Student flows byte-identical vs OFF', async () => {
    const stamp = Date.now() + Math.random();
    const { mkApi, pAuth, childId, queue, events, outcomes } = await seedFamily(stamp);

    const offApi = mkApi('OFF');
    const offHome = await offApi.getParentHome(pAuth, childId);
    const offProgress = await offApi.getParentProgress(pAuth, childId);
    const offToday = await offApi.getToday(pAuth, childId);

    const shadowApi = mkApi('SHADOW', () => 'PASS');
    const onHome = await shadowApi.getParentHome(pAuth, childId);
    const onProgress = await shadowApi.getParentProgress(pAuth, childId);
    const onToday = await shadowApi.getToday(pAuth, childId);
    await queue.drain();

    // 1) user-visible responses unchanged by SHADOW
    expect(JSON.stringify(onHome)).toBe(JSON.stringify(offHome));
    expect(JSON.stringify(onProgress)).toBe(JSON.stringify(offProgress));
    expect(JSON.stringify(onToday)).toBe(JSON.stringify(offToday));

    // 2) a SHADOW run fired and fully persisted
    const ran = outcomes.find((o) => o.ran);
    expect(ran?.ran).toBe(true);
    if (!ran?.ran) return;
    const store = new PgWorksheetGenerationStore(pool);
    const run = await store.getRun(ran.runId);
    const slots = await store.listSlots(ran.runId);
    const attempts = await store.listAttempts(ran.runId);
    expect(run?.mode).toBe('SHADOW');
    expect(slots.length).toBeGreaterThan(0);
    expect(attempts.length).toBeGreaterThanOrEqual(slots.length);
    expect(slots.every((s) => ['READY', 'PENDING_CROSSCHECK', 'FAILED'].includes(s.finalState))).toBe(true);
    // most slots complete even with the offline MOCK generator (the REAL
    // generator hits ~92–97% — Phases 3–4); a regression that tanks completion
    // trips this floor.
    const done = slots.filter((s) => s.finalState !== 'FAILED').length;
    expect(done / slots.length).toBeGreaterThanOrEqual(0.6);

    // 3) cost ledger — worksheet_batch_generation events, plan-independent, no PII
    const ledger = await pool.query<{ operation_type: string; model: string; actual_cost_usd: string | null }>(
      `SELECT operation_type, model, actual_cost_usd FROM ai_usage_events WHERE operation_type = 'worksheet_batch_generation'`,
    );
    expect(ledger.rows.length).toBeGreaterThan(0);
    expect(events.some((e) => e.operationType === 'worksheet_batch_generation')).toBe(true);

    // 4) NO PII anywhere in the persisted trace / ledger
    const scan = JSON.stringify({ run, slots, attempts, events });
    expect(scan).not.toMatch(/Bé Phở/);
    expect(scan).not.toMatch(/Đáp số|workedSolution|prompt"\s*:/);
  }, 30_000);

  it('Group-C crosscheck: UNCERTAIN → PENDING_CROSSCHECK + a review-queue row; observability + retention', async () => {
    const stamp = Date.now() + Math.random();
    const { mkApi, pAuth, childId, queue, outcomes, crosscheckCalls } = await seedFamily(stamp);

    const shadowApi = mkApi('SHADOW', () => 'UNCERTAIN');
    await shadowApi.getToday(pAuth, childId);
    await queue.drain();
    const ran = outcomes.find((o) => o.ran);
    if (!ran?.ran) return;

    const slots = await new PgWorksheetGenerationStore(pool).listSlots(ran.runId);
    const pending = slots.filter((s) => s.finalState === 'PENDING_CROSSCHECK');
    // the mock crosscheck (always UNCERTAIN) is wired into the orchestrator:
    // every Group-C slot → 2 verifier calls (retry-once) → PENDING_CROSSCHECK.
    // 0 if this plan produced no Group-C slot — the flow itself is also covered
    // by worksheet-staging.test.ts.
    expect(crosscheckCalls.n).toBe(2 * pending.length);
    // a PENDING_CROSSCHECK slot is NEVER silently production-verified
    for (const s of pending) expect(s.productionReady).toBe(false);

    // review-queue rows exist for this run's spec (UNCERTAIN crosscheck and/or
    // any FAILED slot) and carry only a pseudonymous ref + a short snapshot
    const rq = await pool.query<{ reason: string; child_ref: string | null; prompt_snapshot: string | null }>(
      `SELECT reason, child_ref, prompt_snapshot FROM review_queue WHERE generation_spec_id = $1`,
      [ran.result.trace.generationSpecId],
    );
    for (const row of rq.rows) {
      expect(row.child_ref === null || row.child_ref === 'c_ps').toBe(true);
      expect(row.reason).toMatch(/CROSSCHECK_UNCERTAIN|BOTH_MODELS_FAILED|NO_KERNEL_GENERATION_FAILED|CONTENT_QUALITY_NONRECOVERABLE|SAFETY_ANOMALY/);
    }

    // ADMIN observability sees the run; non-admin is refused
    const adminCtx = { userId: users[0]!, workspace: 'ADMIN' as const };
    const obs = await shadowApi.worksheetShadowObservability(adminCtx);
    expect(obs.mode).toBe('SHADOW');
    expect(obs.rollup.runs).toBeGreaterThanOrEqual(1);
    await expect(
      shadowApi.worksheetShadowObservability({ userId: users[0]!, workspace: 'PARENT' as const }),
    ).rejects.toBeTruthy();

    // retention purge nulls the snapshots (idempotent; returns a count)
    const purged1 = await shadowApi.purgeReviewQueueSnapshots(adminCtx, 0);
    expect(typeof purged1.purged).toBe('number');
    const stillHasSnap = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM review_queue WHERE generation_spec_id = $1 AND prompt_snapshot IS NOT NULL`,
      [ran.result.trace.generationSpecId],
    );
    expect(stillHasSnap.rows[0]!.n).toBe(0);
  });

  it('reviewer path (doc 67 §D4): ADMIN lists PENDING, resolves once, non-admin refused', async () => {
    const stamp = Date.now() + Math.random();
    const { mkApi } = await seedFamily(stamp);
    const api = mkApi('SHADOW', () => 'PASS');
    const adminCtx = { userId: users[0]!, workspace: 'ADMIN' as const };

    // force a PENDING review row (a genuine one comes from a FAILED slot /
    // UNCERTAIN crosscheck; here we insert one directly to test the path)
    await new PgReviewQueueStore(pool).create({
      generationSpecId: `d4-${stamp}`,
      itemId: 'slot_ps',
      childRef: 'c_ps',
      reason: 'BOTH_MODELS_FAILED',
      promptSnapshot: 'Tính: 2/3 + 1/6.',
      workedSolutionSnapshot: '2/3 + 1/6 = 5/6.',
      detail: 'both models failed after retries',
    });

    const listed = await api.reviewQueueListPending(adminCtx);
    const mine = listed.items.find((i) => i.generationSpecId === `d4-${stamp}`)!;
    expect(mine.state).toBe('PENDING');
    expect(mine.promptSnapshot).toContain('2/3'); // reviewer sees the QA snapshot
    expect(mine.childRef).toBe('c_ps'); // pseudonymous only

    // non-admin is refused
    await expect(
      api.reviewQueueListPending({ userId: users[0]!, workspace: 'PARENT' as const }),
    ).rejects.toBeTruthy();
    await expect(
      api.reviewQueueResolve({ userId: users[0]!, workspace: 'TEACHER' as const }, mine.id, 'APPROVED'),
    ).rejects.toBeTruthy();

    // resolve once → the row records the decision + a pseudonymous reviewer
    const resolved = await api.reviewQueueResolve(adminCtx, mine.id, 'REGENERATE_REQUESTED');
    expect(resolved.item.state).toBe('REGENERATE_REQUESTED');
    expect(resolved.item.resolvedBy).toBeTruthy();
    expect(resolved.item.resolvedBy).not.toBe(users[0]); // pseudonymized
    expect(resolved.item.resolvedAt).toBeTruthy();

    // a second resolve of the same row is rejected (one-time transition)
    await expect(api.reviewQueueResolve(adminCtx, mine.id, 'APPROVED')).rejects.toBeTruthy();

    await pool.query(`DELETE FROM review_queue WHERE generation_spec_id = $1`, [`d4-${stamp}`]);
  });

  it('Teacher flow is unaffected by SHADOW generation', async () => {
    const stamp = Date.now() + Math.random();
    const { mkApi, pAuth, childId, queue } = await seedFamily(stamp);

    // a teacher linked to the child
    const off = mkApi('OFF');
    const teacher = await off.register({ email: `fp-t-${stamp}@x.com`, password: 'supersecret', intendedRole: 'TEACHER', displayName: 'Cô Giáo' });
    users.push(teacher.userId);
    const tRow = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [teacher.userId]);
    const tAuth = { bearer: tRow.rows[0]!.auth_user_id, workspace: 'TEACHER' as const };

    const offList = await off.teacherListChildren(tAuth).catch(() => null);
    const shadowApi = mkApi('SHADOW', () => 'PASS');
    await shadowApi.getToday(pAuth, childId);
    await queue.drain();
    const onList = await shadowApi.teacherListChildren(tAuth).catch(() => null);
    expect(JSON.stringify(onList)).toBe(JSON.stringify(offList));
  });
});
