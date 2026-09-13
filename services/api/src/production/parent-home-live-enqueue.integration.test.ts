import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryAuthAdapter } from '@copilot/identity';
import {
  createMockItemContentGenerator,
  PgWorksheetJobQueue,
  type ItemContentGenerator,
} from '@copilot/exercise-gen';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createProductionApi } from './production-api.js';
import { addToInternalLiveCohort, familyRef, setKillSwitch } from './internal-live.js';
import { recordPilotConsent } from './pilot.js';

/**
 * doc 70 regression — the REAL "Hôm nay" / "Bài tập" paths the deployed web app
 * calls (`getParentHome`, `studentGetToday`) must trigger the doc 69 §5 LIVE
 * enqueue/serve, not just the unreachable `getToday` method. Root-caused from a
 * live pilot report: cohort + consent + env were all correct, yet
 * `worksheet_jobs` stayed empty forever — because nothing in the deployed app
 * ever called `getToday`. Against PostgreSQL, a durable `PgWorksheetJobQueue`,
 * and a MOCK generator (free — no OpenAI call; this proves the enqueue wiring,
 * not generation quality, which is covered elsewhere).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const childRefOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

describe.skipIf(!DATABASE_URL)('doc 70 — getParentHome / studentGetToday trigger the LIVE enqueue', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-02-20T09:00:00.000Z');
  const children: string[] = [];
  const families: string[] = [];
  const prevMode = process.env.AI_GENERATION_MODE;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    await setKillSwitch(pool, false, { reason: 'test reset', source: 'manual', actorRef: 'test' });
    // resolveEffectiveGenerationMode reads AI_GENERATION_MODE off process.env —
    // set it for this process only, restored in afterAll.
    process.env.AI_GENERATION_MODE = 'LIVE';
    const gen: ItemContentGenerator = createMockItemContentGenerator();
    api = createProductionApi({
      pool,
      authAdapter: new InMemoryAuthAdapter(`phle${Date.now()}`),
      now,
      worksheetGeneration: {
        mode: 'LIVE',
        queue: new PgWorksheetJobQueue(pool), // the SAME durable queue a `durable` deploy uses
        generators: { default: gen, highComplexity: gen },
        referenceLibrary: loadReferenceLibrary(),
      },
    });
  }, 20_000);

  afterAll(async () => {
    process.env.AI_GENERATION_MODE = prevMode;
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`, [children.map(childRefOf)]).catch(() => {});
      await c.query(`DELETE FROM internal_live_cohort WHERE family_ref = ANY($1::text[])`, [families.map(familyRef)]).catch(() => {});
      for (const t of ['consent_records', 'evidence', 'skill_states', 'knowledge_gaps', 'learning_state_snapshots', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  it('getParentHome enqueues a durable LIVE job for a cohort+consented family (0 jobs → 1 job)', async () => {
    const stamp = Date.now();
    const parent = await reg(`phle-p1-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Enqueue', schoolGrade: 4 });
    children.push(child.childId);
    const famId = (await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id;
    families.push(famId);
    const fref = familyRef(famId);
    await addToInternalLiveCohort(pool, fref, { wave: 2, note: 'enqueue test', actorRef: 'test' });
    await recordPilotConsent(pool, { childId: child.childId, grantedByUserId: parent.userId });

    const cref = childRefOf(child.childId);
    const before = await pool.query<{ n: string }>(`SELECT count(*)::int n FROM worksheet_jobs WHERE child_ref = $1`, [cref]);
    expect(Number(before.rows[0]!.n)).toBe(0);

    await api.getParentHome(pAuth, child.childId); // the REAL "Hôm nay" call

    const after = await pool.query<{ mode: string; state: string }>(`SELECT mode, state FROM worksheet_jobs WHERE child_ref = $1`, [cref]);
    expect(after.rows.length).toBe(1);
    expect(after.rows[0]!.mode).toBe('LIVE');

    // idempotent — a second "Hôm nay" load the same day does not duplicate the job
    await api.getParentHome(pAuth, child.childId);
    const still = await pool.query<{ n: string }>(`SELECT count(*)::int n FROM worksheet_jobs WHERE child_ref = $1`, [cref]);
    expect(Number(still.rows[0]!.n)).toBe(1);
  }, 20_000);

  it('a non-cohort family enqueues nothing (still uses the legacy path)', async () => {
    const stamp = Date.now();
    const parent = await reg(`phle-p2-${stamp}@x.com`);
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Control', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    await api.getParentHome(pAuth, child.childId);

    const jobs = await pool.query<{ n: string }>(`SELECT count(*)::int n FROM worksheet_jobs WHERE child_ref = $1`, [childRefOf(child.childId)]);
    expect(Number(jobs.rows[0]!.n)).toBe(0);
  }, 20_000);
});
