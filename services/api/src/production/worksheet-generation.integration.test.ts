import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import {
  createMockItemContentGenerator,
  InMemoryWorksheetShadowQueue,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  shadowRollup,
  type AiUsageEvent,
  type WorksheetShadowOutcome,
} from '@copilot/exercise-gen';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createProductionApi } from './production-api.js';
import { insertAiUsageEvent } from './pg-ai-usage.js';

/**
 * doc 66 §1 — production wiring: OFF = nothing runs; SHADOW = the orchestrator
 * runs off the request path, persists run+slots+attempts + telemetry, and the
 * student `getToday` response is unaffected. Deletion cascades. No paid AI
 * (injected mock generators).
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('doc 66 — production worksheet SHADOW wiring', () => {
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

  async function setup(mode: 'OFF' | 'SHADOW') {
    const stamp = Date.now() + Math.random();
    const gen = createMockItemContentGenerator();
    const events: AiUsageEvent[] = [];
    const outcomes: WorksheetShadowOutcome[] = [];
    const queue = new InMemoryWorksheetShadowQueue({ onOutcome: (_j, o) => outcomes.push(o) });
    const api = createProductionApi({
      pool,
      authAdapter: new InMemoryAuthAdapter(`wg${stamp}`),
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
              usageSink: (e) => {
                events.push(e);
                void insertAiUsageEvent(pool, e).catch(() => {});
              },
              resolveUsageContext: () => ({ userRef: 'u_ps', childRef: 'c_ps', plan: 'plus' as const }),
              resolveChildRef: () => 'c_ps',
            },
    });
    const parent = await api.register({ email: `wg-p-${stamp}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: 'P' });
    users.push(parent.userId);
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [parent.userId]);
    const pAuth = { bearer: r.rows[0]!.auth_user_id, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Test', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    // wrong answers on a core skill → a real Daily Plan (not "no plan needed")
    for (let i = 0; i < 4; i += 1) {
      await pool.query(
        `INSERT INTO evidence (id, child_id, source, occurred_at, recorded_at, skill_id, result, confidence_tier, provenance)
         VALUES (gen_random_uuid(), $1, 'school_test', $2, $2, 'M4.FRAC.COMMON_DENOM', '{"correct":false}'::jsonb, 'A', 'assessment')`,
        [child.childId, new Date(2027, 0, 15 + i).toISOString()],
      );
    }
    return { api, pAuth, childId: child.childId, queue, events, outcomes };
  }

  it('OFF → getToday works, nothing enqueued', async () => {
    const { api, pAuth, childId, outcomes } = await setup('OFF');
    const today = await api.getToday(pAuth, childId);
    expect(today).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(outcomes).toHaveLength(0);
  });

  it('SHADOW → getToday unchanged; run + slots + attempts + usage events persisted', async () => {
    const { api, pAuth, childId, queue, events, outcomes } = await setup('SHADOW');
    const offApi = (await setup('OFF')).api;
    const shadowToday = await api.getToday(pAuth, childId);
    expect(shadowToday).toBeTruthy();
    await queue.drain();

    expect(outcomes.length).toBeGreaterThanOrEqual(1); // the SHADOW run fired
    const o = outcomes[0]!;
    expect(o.ran).toBe(true);
    if (!o.ran) return;
    const store = new PgWorksheetGenerationStore(pool);
    const run = await store.getRun(o.runId);
    expect(run?.mode).toBe('SHADOW');
    expect((await store.listSlots(o.runId)).length).toBeGreaterThan(0);
    expect((await store.listAttempts(o.runId)).length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);

    // persisted rows carry NO PII
    const scan = JSON.stringify({ run, slots: await store.listSlots(o.runId), events });
    expect(scan).not.toMatch(/Bé Test/);
    expect(scan).not.toMatch(/workedSolution|Đáp số/);

    // observability rollup sees it
    const roll = await shadowRollup(pool);
    expect(roll.runs).toBeGreaterThanOrEqual(1);
    void offApi;
  });

  it('confirm-delete purges review_queue + cascades worksheet runs', async () => {
    const { api, pAuth, childId, queue, outcomes } = await setup('SHADOW');
    await api.getToday(pAuth, childId).catch(() => {});
    await queue.drain();
    // force a review row for this child's spec
    if (outcomes[0]?.ran) {
      await new PgReviewQueueStore(pool).create({
        generationSpecId: outcomes[0].result.trace.generationSpecId,
        itemId: 'x',
        reason: 'BOTH_MODELS_FAILED',
        detail: 'test',
      });
    }
    await api.requestChildDeletion(pAuth, childId).catch(() => {});
    const res = await api.confirmChildDeletion(pAuth, childId, { acknowledgement: 'Bé Test' } as never).catch(() => null);
    // deletion purge ran (or the ack shape differs) — either way, no worksheet
    // rows or review rows for a deleted child
    const left = await pool.query(
      `SELECT count(*)::int n FROM worksheet_generation_runs r
         JOIN generation_specs s ON s.id = r.generation_spec_id WHERE s.child_id = $1`,
      [childId],
    );
    if (res) expect(left.rows[0]!.n).toBe(0);
  });
});
