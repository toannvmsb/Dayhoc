import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryAuthAdapter } from '@copilot/identity';
import {
  createMockItemContentGenerator,
  createOpenAiAnswerCrosscheck,
  createRoutedAnswerCrosscheck,
  DailyCostGuard,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  PgWorksheetJobQueue,
  WorksheetJobWorker,
  type AiUsageEvent,
} from '@copilot/exercise-gen';
import { createOpenAiProviderAdapter, type AiCapability, type ProviderCompliance } from '@copilot/ai';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createProductionApi } from './production-api.js';
import { insertAiUsageEvent } from './pg-ai-usage.js';

/**
 * doc 67 §D6 — full production path against STAGING with the DURABLE queue.
 *
 *   Parent getToday → planner → ExerciseGenerationSpec → PgWorksheetJobQueue
 *   → (separate) WorksheetJobWorker → orchestrator → MathKernel/validator →
 *   model routing → retry/fallback/last-resort → LIVE Group-C crosscheck →
 *   review queue → Pg persistence → ai_usage_events → observability.
 *
 * Generation uses the MOCK generator (free); only the crosscheck is paid
 * (sub-cap $0.15). Parent / Student / Teacher API responses must be identical
 * with generation OFF. Child deletion purges worksheet_jobs too.
 */
const LIVE =
  process.env.RUN_D6_STAGING === '1' && !!process.env.DATABASE_URL && !!process.env.OPENAI_API_KEY;
const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'staging-d6', crossBorder: true, dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy', trainingAllowed: false, dpaStatus: 'not_applicable',
};

describe.skipIf(!LIVE)('doc 67 §D6 — full production path, durable queue (staging)', () => {
  let pool: import('pg').Pool;
  const users: string[] = [];
  const children: string[] = [];
  const childRefs: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  });
  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      const specIds = (
        await c.query<{ generation_spec_id: string }>(
          `SELECT generation_spec_id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])
           UNION SELECT generation_spec_id FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`,
          [childRefs],
        )
      ).rows.map((x) => x.generation_spec_id);
      await c.query(`DELETE FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM review_queue WHERE child_ref = ANY($1::text[]) OR generation_spec_id = ANY($2::text[])`, [childRefs, specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM ai_usage_events WHERE generation_spec_id = ANY($1::text[])`, [specIds]).catch(() => {});
      for (const t of ['skill_states', 'knowledge_gaps', 'learning_state_snapshots', 'evidence', 'generation_specs', 'learning_plans', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id IN (SELECT family_id FROM child_profiles WHERE id = ANY($1::uuid[]))`, [children]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('durable-queue path end to end; role flows unaffected; deletion purges the queue', async () => {
    const kb = loadKnowledgeBase();
    const authAdapter = new InMemoryAuthAdapter(`d6${Date.now()}`);
    const gen = createMockItemContentGenerator();
    const events: AiUsageEvent[] = [];
    const usageSink = (e: AiUsageEvent) => { events.push(e); void insertAiUsageEvent(pool, e).catch(() => undefined); };

    const mkCc = (model: string) =>
      createOpenAiAnswerCrosscheck(createOpenAiProviderAdapter({
        apiKey: process.env.OPENAI_API_KEY!, model,
        capability: 'advanced_verification' as AiCapability, compliance: COMPLIANCE,
      }));
    const crosscheckAdapter = createRoutedAnswerCrosscheck({
      base: mkCc(process.env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini'),
      geometryProof: mkCc(process.env.CROSSCHECK_GEOMETRY_MODEL ?? 'gpt-5-mini'),
    });

    const queue = new PgWorksheetJobQueue(pool);
    const store = new PgWorksheetGenerationStore(pool);
    const reviewQueue = new PgReviewQueueStore(pool);
    // the SAME pseudonymisation `resolveWorksheetGeneration` uses in production —
    // sha256(childId).slice(0,16). The deletion workflow recomputes it.
    let childRef = '';
    const mkApi = (mode: 'OFF' | 'SHADOW') =>
      createProductionApi({
        pool, authAdapter, now: () => new Date('2027-02-01T00:00:00.000Z'),
        worksheetGeneration: mode === 'OFF' ? null : {
          mode: 'SHADOW', queue, generators: { default: gen, highComplexity: gen },
          referenceLibrary: loadReferenceLibrary(),
          crosscheckAdapter, reviewQueue, store, usageSink,
          resolveUsageContext: () => ({ userRef: 'u_d6', childRef, plan: 'plus' as const }),
          resolveChildRef: () => childRef,
        },
      });

    const off = mkApi('OFF');
    const parent = await off.register({ email: `d6-${Date.now()}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: 'P' });
    users.push(parent.userId);
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [parent.userId]);
    const pAuth = { bearer: r.rows[0]!.auth_user_id, workspace: 'PARENT' as const };
    const child = await off.createChild(pAuth, { displayName: 'Bé D6', schoolGrade: 4 });
    children.push(child.childId);
    childRef = createHash('sha256').update(child.childId).digest('hex').slice(0, 16);
    childRefs.push(childRef);
    const skills = ['M4.FRAC.COMMON_DENOM', 'M4.FRAC.ADD', 'M4.ARITH.SUB_MULTI', 'M4.ARITH.MUL_2DIGIT'];
    for (let i = 0; i < 8; i += 1) {
      await pool.query(
        `INSERT INTO evidence (id, child_id, source, occurred_at, recorded_at, skill_id, result, confidence_tier, provenance)
         VALUES (gen_random_uuid(), $1, 'school_test', $2, $2, $3, '{"correct":false}'::jsonb, 'A', 'assessment')`,
        [child.childId, new Date(2027, 0, 10 + i).toISOString(), skills[i % skills.length]],
      );
    }

    // baseline role responses with generation OFF
    const offHome = await off.getParentHome(pAuth, child.childId);
    const offProg = await off.getParentProgress(pAuth, child.childId);
    const offToday = await off.getToday(pAuth, child.childId);

    // SHADOW: getToday enqueues a DURABLE job (does not run inline)
    const on = mkApi('SHADOW');
    const onHome = await on.getParentHome(pAuth, child.childId);
    const onProg = await on.getParentProgress(pAuth, child.childId);
    const onToday = await on.getToday(pAuth, child.childId);
    expect(JSON.stringify(onHome)).toBe(JSON.stringify(offHome));
    expect(JSON.stringify(onProg)).toBe(JSON.stringify(offProg));
    expect(JSON.stringify(onToday)).toBe(JSON.stringify(offToday));

    // enqueue is fire-and-forget → poll for the persisted job
    let q0 = await queue.stats();
    for (let i = 0; i < 40 && q0.PENDING < 1; i += 1) {
      await new Promise((res) => setTimeout(res, 250));
      q0 = await queue.stats();
    }
    expect(q0.PENDING, 'getToday must persist a durable job').toBeGreaterThanOrEqual(1);

    // a SEPARATE worker process drains the queue
    const worker = new WorksheetJobWorker({
      pool, workerId: 'd6-worker', knowledgeBase: kb, referenceLibrary: loadReferenceLibrary(),
      leaseMs: 60_000, backoffMs: 0,
      buildDeps: () => ({
        generators: { default: gen, highComplexity: gen },
        crosscheckAdapter, reviewQueue, store, usageSink,
        costGuard: new DailyCostGuard({ perWorksheetUsd: 0.05, perDayUsd: 0.15 }),
      }),
    });
    const processed = await worker.runToIdle(50);
    expect(processed).toBeGreaterThanOrEqual(1);
    const q1 = await queue.stats();
    expect(q1.DONE).toBeGreaterThanOrEqual(1);
    expect(q1.PENDING).toBe(0);
    expect(q1.CLAIMED).toBe(0);

    // the run + slots + attempts + cost ledger landed in staging Postgres
    // (the worksheet SHADOW path keys on the pseudonymous child_ref)
    const run = await pool.query<{ id: string; spec: string }>(
      `SELECT id, generation_spec_id spec FROM worksheet_generation_runs WHERE child_ref = $1`,
      [childRef],
    );
    expect(run.rows.length).toBeGreaterThanOrEqual(1);
    const runIds = run.rows.map((x) => x.id);
    const specIds = run.rows.map((x) => x.spec);
    const slots = await pool.query<{ n: string }>(
      `SELECT count(*)::int n FROM worksheet_slots WHERE run_id = ANY($1::text[])`,
      [runIds],
    );
    expect(Number(slots.rows[0]!.n)).toBeGreaterThan(0);
    const attempts = await pool.query<{ n: string }>(
      `SELECT count(*)::int n FROM worksheet_slot_attempts WHERE run_id = ANY($1::text[])`,
      [runIds],
    );
    expect(Number(attempts.rows[0]!.n)).toBeGreaterThan(0);
    const ledger = await pool.query<{ ops: string }>(
      `SELECT string_agg(DISTINCT operation_type, ',') ops FROM ai_usage_events WHERE generation_spec_id = ANY($1::text[])`,
      [specIds],
    );
    expect(ledger.rows[0]!.ops ?? '').toContain('worksheet_batch_generation');

    // NO PII in the persisted trace / job rows (whole-row dump)
    const scan = await pool.query<{ blob: string }>(
      `SELECT coalesce(string_agg(sl::text,' '),'') || coalesce(string_agg(a::text,' '),'') blob
         FROM worksheet_slots sl
         LEFT JOIN worksheet_slot_attempts a ON a.run_id = sl.run_id
        WHERE sl.run_id = ANY($1::text[])`,
      [runIds],
    );
    expect(scan.rows[0]!.blob ?? '').not.toMatch(/Bé D6/);
    const jobScan = await pool.query<{ blob: string }>(
      `SELECT coalesce(string_agg(j::text,' '),'') blob FROM worksheet_jobs j WHERE child_ref = $1`,
      [childRef],
    );
    expect(jobScan.rows[0]!.blob ?? '').not.toMatch(/Bé D6/);

    // ADMIN observability reflects the run
    const obs = await on.worksheetShadowObservability({ userId: users[0]!, workspace: 'ADMIN' as const });
    expect(obs.rollup.runs).toBeGreaterThanOrEqual(1);

    // Student + Teacher flows unaffected
    const teacher = await off.register({ email: `d6-t-${Date.now()}@x.com`, password: 'supersecret', intendedRole: 'TEACHER', displayName: 'Cô' });
    users.push(teacher.userId);
    const tRow = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [teacher.userId]);
    const tAuth = { bearer: tRow.rows[0]!.auth_user_id, workspace: 'TEACHER' as const };
    expect(JSON.stringify(await on.teacherListChildren(tAuth).catch(() => null))).toBe(
      JSON.stringify(await off.teacherListChildren(tAuth).catch(() => null)),
    );

    // child deletion purges worksheet_jobs + the run tables (by child_ref)
    await on.requestChildDeletion(pAuth, child.childId).catch(() => undefined);
    const del = await on.confirmChildDeletion(pAuth, child.childId, 'Bé D6').catch(() => null);
    if (del) {
      for (const tbl of ['worksheet_jobs', 'worksheet_generation_runs', 'review_queue']) {
        const left = await pool.query<{ n: string }>(
          `SELECT count(*)::int n FROM ${tbl} WHERE child_ref = $1`,
          [childRef],
        ).catch(() => ({ rows: [{ n: '0' }] }));
        expect(Number(left.rows[0]!.n), `${tbl} not purged`).toBe(0);
      }
      const slotsLeft = await pool.query<{ n: string }>(
        `SELECT count(*)::int n FROM worksheet_slots WHERE run_id = ANY($1::text[])`,
        [runIds],
      );
      expect(Number(slotsLeft.rows[0]!.n)).toBe(0);
    }
  }, 15 * 60 * 1000);
});
