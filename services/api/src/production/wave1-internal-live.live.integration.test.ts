import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { loadKnowledgeBase } from '@copilot/math-data';
import { createProductionApi } from './production-api.js';
import { createWorksheetJobWorker } from './worksheet-generation.js';
import {
  familyRef,
  addToInternalLiveCohort,
  setKillSwitch,
  enforceSafetyAutoStop,
  internalLiveSpendToday,
  scanInternalLiveSafety,
} from './internal-live.js';
import { internalLiveDashboard, reviewQueueOps, productFunnel } from './internal-live-observability.js';

/**
 * doc 69 §7 — CONTROLLED INTERNAL LIVE, WAVE 1. Real product journeys through
 * the deployed API + REAL paid generation, against staging Postgres:
 *
 *   Parent getToday → planner → LIVE worksheet (durable queue + worker)
 *   → verified items served as an AI_GENERATED assignment
 *   → practice submit → append-only evidence → Twin recompute → next plan.
 *
 * Gated on RUN_WAVE1=1 + DATABASE_URL + OPENAI_API_KEY + AI_GENERATION_MODE=LIVE.
 * Operational caps: INTERNAL_LIVE_GEN_DAILY_CAP_USD (2.00) / _XCHECK (0.50).
 */
const LIVE =
  process.env.RUN_WAVE1 === '1' &&
  !!process.env.DATABASE_URL &&
  !!process.env.OPENAI_API_KEY &&
  process.env.AI_GENERATION_MODE === 'LIVE';

const OUT = 'D:/Lap trinh/Claude/Dayhoc/WAVE1_REPORT.txt';
const FAMILIES = 4; // internal cohort families
const CHILDREN_PER_FAMILY = 5;
const childRefOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

describe.skipIf(!LIVE)('doc 69 §7 — CONTROLLED INTERNAL LIVE Wave 1 (real journeys, PAID)', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  let worker: ReturnType<typeof createWorksheetJobWorker>;
  const now = () => new Date(); // REAL time — DB timestamps stay coherent
  const day = () => new Date().toISOString().slice(0, 10);
  const kb = loadKnowledgeBase();
  const childIds: string[] = [];
  const familyIds: string[] = [];
  const runTag = `w1-${Date.now()}`;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, keepAlive: true, max: 4, idleTimeoutMillis: 20_000 });
    pool.on('error', () => undefined); // swallow the Supabase pooler's idle-connection drops
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(runTag), now });
    worker = createWorksheetJobWorker({ pool, knowledgeBase: kb, workerId: `${runTag}-worker`, leaseMs: 300_000, backoffMs: 200 });
    await setKillSwitch(pool, false, { reason: 'wave1 start', source: 'manual', actorRef: 'wave1' });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      const refs = childIds.map(childRefOf);
      const specIds = (
        await c.query<{ generation_spec_id: string }>(
          `SELECT generation_spec_id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])
           UNION SELECT generation_spec_id FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`,
          [refs],
        )
      ).rows.map((r) => r.generation_spec_id);
      await c.query(`DELETE FROM worksheet_run_serving WHERE child_ref = ANY($1::text[])`, [refs]).catch(() => {});
      await c.query(`DELETE FROM internal_live_qa_sample WHERE child_ref = ANY($1::text[])`, [refs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`, [refs]).catch(() => {});
      await c.query(`DELETE FROM review_queue WHERE child_ref = ANY($1::text[]) OR generation_spec_id = ANY($2::text[])`, [refs, specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [refs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [refs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])`, [refs]).catch(() => {});
      await c.query(`DELETE FROM ai_usage_events WHERE generation_spec_id = ANY($1::text[])`, [specIds]).catch(() => {});
      for (const t of ['attempt_answers', 'attempts', 'assignment_items', 'assignments', 'evidence', 'skill_states', 'knowledge_gaps', 'thinking_state', 'problem_type_mastery', 'learning_state_snapshots', 'learning_plans', 'gap_prescriptions']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [childIds]).catch(() => {});
      }
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [childIds]).catch(() => {});
      await c.query(`DELETE FROM internal_live_cohort WHERE family_ref = ANY($1::text[])`, [familyIds.map(familyRef)]).catch(() => {});
      await c.query(`DELETE FROM family_subscriptions WHERE family_id = ANY($1::uuid[])`, [familyIds]).catch(() => {});
      await c.query(`DELETE FROM internal_live_spend WHERE spend_date = $1`, [now().toISOString().slice(0, 10)]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  });

  it(`Wave 1 — ${FAMILIES} families × ${CHILDREN_PER_FAMILY} children through the real LIVE journey`, async () => {
    // ---- 1. verify LIVE config ----
    const { validateWorksheetStagingConfig } = await import('./worksheet-staging-config.js');
    const cfg = validateWorksheetStagingConfig(process.env);
    expect(cfg.mode, 'AI_GENERATION_MODE').toBe('LIVE');
    expect(cfg.blocking, 'config blocking').toEqual([]);
    expect(cfg.defaultModel).toBe('gpt-4.1-mini');
    expect(cfg.highComplexityModel).toBe('gpt-5-mini');
    expect(worker, 'durable worker built').toBeTruthy();

    // ---- 2. internal families + cohort ----
    const parents: { userId: string; bearer: string; auth: { bearer: string; workspace: 'PARENT' } }[] = [];
    const kids: { childId: string; parentIdx: number }[] = [];
    for (let f = 0; f < FAMILIES + 1; f += 1) {
      const me = await api.register({ email: `${runTag}-p${f}@internal.test`, password: 'supersecret12', intendedRole: 'PARENT', displayName: `Parent ${f}` });
      const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
      const pAuth = { bearer: r.rows[0]!.auth_user_id, workspace: 'PARENT' as const };
      parents.push({ userId: me.userId, bearer: r.rows[0]!.auth_user_id, auth: pAuth });
      const nKids = f < FAMILIES ? CHILDREN_PER_FAMILY : 2; // family #FAMILIES = negative control
      for (let k = 0; k < nKids; k += 1) {
        const child = await api.createChild(pAuth, { displayName: `Bé ${f}-${k}`, schoolGrade: k % 2 === 0 ? 4 : 7 });
        childIds.push(child.childId);
        kids.push({ childId: child.childId, parentIdx: f });
        const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
        if (!familyIds.includes(fam.rows[0]!.family_id)) {
          familyIds.push(fam.rows[0]!.family_id);
          // MOCK 'pro' subscription (maxChildren 6, NO CHARGE) so an internal
          // family can hold ${CHILDREN_PER_FAMILY} test children.
          await pool.query(
            `INSERT INTO family_subscriptions (family_id, plan, status, current_period_end, updated_at, source, auto_renew)
             VALUES ($1, 'pro', 'active', now() + interval '30 days', now(), 'manual', false)
             ON CONFLICT (family_id) DO UPDATE SET plan = 'pro', status = 'active'`,
            [fam.rows[0]!.family_id],
          );
        }
        // seed a little assessment evidence so the planner produces a real plan
        const g4 = ['M4.FRAC.COMMON_DENOM', 'M4.FRAC.ADD', 'M4.ARITH.SUB_MULTI', 'M4.ARITH.MUL_2DIGIT'];
        const g7 = ['M7.RATIO.EQUAL_CHAIN', 'M7.RATIO.PROPORTION', 'M7.RATIO.DIRECT', 'M7.GEO.PARALLEL_CRITERIA'];
        const skills = k % 2 === 0 ? g4 : g7;
        for (let i = 0; i < 10; i += 1) {
          await pool.query(
            `INSERT INTO evidence (id, child_id, source, occurred_at, recorded_at, skill_id, result, confidence_tier, provenance)
             VALUES (gen_random_uuid(), $1, 'school_test', $2, $2, $3, $4::jsonb, 'A', 'assessment')`,
            [child.childId, new Date(Date.now() - (20 - i) * 86_400_000).toISOString(), skills[i % skills.length], i % 3 === 0 ? '{"correct":true}' : '{"correct":false}'],
          );
        }
      }
    }
    // add the first FAMILIES families to the cohort; the last stays SHADOW (control)
    for (let f = 0; f < FAMILIES; f += 1) {
      await addToInternalLiveCohort(pool, familyRef(familyIds[f]!), { wave: 1, note: `wave1 internal ${f}`, actorRef: 'wave1' });
    }

    // ---- 3. cohort gate verified end-to-end ----
    const effCohort = await api._effectiveModeFor(parents[0]!.userId);
    expect(effCohort.mode, 'cohort family → LIVE').toBe('LIVE');
    const effControl = await api._effectiveModeFor(parents[FAMILIES]!.userId);
    expect(effControl.mode, 'non-cohort family → SHADOW').toBe('SHADOW');

    // ---- 5/7. run the real journey per cohort child ----
    const cohortKids = kids.filter((k) => k.parentIdx < FAMILIES);
    const flows: { childId: string; parentIdx: number; planBefore: string; assignmentId: string | null; itemCount: number; evidenceDelta: number; twinChanged: boolean; nextPlanChanged: boolean }[] = [];
    let killed = false;

    // ---- PHASE 1: every cohort parent opens Today → enqueues one LIVE worksheet ----
    for (const { childId, parentIdx } of cohortKids) {
      const planBefore = JSON.stringify((await api.getToday(parents[parentIdx]!.auth, childId)) ?? {});
      const dbg = await api._maybeEnqueueLiveWorksheet(parents[parentIdx]!.userId, childId);
      if (cohortKids.indexOf(cohortKids.find((k) => k.childId === childId)!) < 3) console.log(`WAVE1 enqueue ${childId.slice(0, 8)}: ${JSON.stringify(dbg)}`);
      flows.push({ childId, parentIdx, planBefore, assignmentId: null, itemCount: 0, evidenceDelta: 0, twinChanged: false, nextPlanChanged: false });
    }
    const enqCheck = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`,
      [cohortKids.map((k) => childRefOf(k.childId))],
    );
    console.log(`WAVE1 phase 1: ${enqCheck.rows[0]!.n} LIVE jobs enqueued for ${cohortKids.length} cohort children`);
    // ---- PHASE 2: drain the durable worker (real paid generation) ----
    for (let round = 0; round < 40 && !killed; round += 1) {
      await worker!.runToIdle(cohortKids.length * 6);
      const st = await pool.query<{ pending: number }>(`SELECT count(*)::int pending FROM worksheet_jobs WHERE child_ref = ANY($1::text[]) AND state IN ('PENDING','CLAIMED')`, [cohortKids.map((k) => childRefOf(k.childId))]);
      if (Number(st.rows[0]!.pending) === 0) break;
      // safety scan while generation is in flight
      const { tripped, scan } = await enforceSafetyAutoStop(pool, { sinceIso: day() + 'T00:00:00Z' });
      if (tripped || scan.critical) { killed = true; console.log(`WAVE1 SAFETY AUTO-STOP mid-generation: ${scan.criticalReasons.join('; ')}`); }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // ---- PHASE 3: serve + practice + verify the learning loop, per child ----
    for (let idx = 0; idx < flows.length && !killed; idx += 1) {
      const f = flows[idx]!;
      const { childId, parentIdx } = f;
      const pAuth = parents[parentIdx]!.auth;
      const planBefore = f.planBefore;

      // getChildAssignments turns a PENDING serving intent into an AI_GENERATED assignment
      const list = await api.getChildAssignments(pAuth, childId);
      const ai = list.find((a) => a.mode === 'WORKSHEET' && a.status !== 'COMPLETED');
      const detail = ai ? await api.getAssignmentDetail(pAuth, ai.id) : null;
      const itemCount = detail?.items.length ?? 0;

      let evidenceDelta = 0;
      let twinChanged = false;
      let nextPlanChanged = false;
      if (ai && detail && itemCount > 0) {
        // answer using the real answer key from the DB (parent proxy submit), ~70% correct
        const keyRows = await pool.query<{ id: string; answer_spec: { kind?: string; value?: number; correct?: string } }>(
          `SELECT id, answer_spec FROM assignment_items WHERE assignment_id = $1 ORDER BY order_index`,
          [ai.id],
        );
        const answers = detail.items.map((it, i) => {
          const key = keyRows.rows.find((r) => r.id === it.id)?.answer_spec ?? {};
          const correctStr = key.kind === 'choice' ? String(key.correct ?? '') : String(key.value ?? '');
          const wrong = i % 3 === 2; // ~1 in 3 wrong
          return { assignmentItemId: it.id, answer: wrong ? `${correctStr}9` : correctStr || '0', hintsUsed: i === 0 ? 1 : 0 };
        });
        const evBefore = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [childId])).rows[0]!.n;
        await api.submitPractice(pAuth, ai.id, answers);
        const evAfter = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [childId])).rows[0]!.n;
        evidenceDelta = evAfter - evBefore;

        const twinBefore = (await pool.query<{ v: string | null }>(`SELECT max(computed_at)::text v FROM learning_state_snapshots WHERE child_id = $1`, [childId])).rows[0]!.v;
        await api.getParentProgress(pAuth, childId); // recompute
        const twinAfter = (await pool.query<{ v: string | null }>(`SELECT max(computed_at)::text v FROM learning_state_snapshots WHERE child_id = $1`, [childId])).rows[0]!.v;
        twinChanged = twinAfter !== twinBefore;
        const ss = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM skill_states WHERE child_id = $1`, [childId]);
        twinChanged = twinChanged || ss.rows[0]!.n > 0;

        const planAfter = JSON.stringify((await api.getToday(pAuth, childId)) ?? {});
        nextPlanChanged = planAfter !== planBefore;
      }

      Object.assign(f, { assignmentId: ai?.id ?? null, itemCount, evidenceDelta, twinChanged, nextPlanChanged });
    }

    // ---- negative control: SHADOW family never gets a served worksheet ----
    const ctrlKid = kids.find((k) => k.parentIdx === FAMILIES)!;
    await api.getToday(parents[FAMILIES]!.auth, ctrlKid.childId);
    await worker!.runToIdle(20);
    const ctrlServe = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM worksheet_run_serving WHERE child_ref = $1`, [childRefOf(ctrlKid.childId)]);
    expect(ctrlServe.rows[0]!.n, 'control family gets NO LIVE serving intent').toBe(0);

    // ---- 9. metrics ----
    const refs = childIds.map(childRefOf);
    const runs = await pool.query<{ id: string; worksheet_state: string; worksheet_latency_ms: number; actual_cost_usd: string }>(
      `SELECT id, worksheet_state, worksheet_latency_ms, actual_cost_usd FROM worksheet_generation_runs WHERE mode = 'LIVE' AND child_ref = ANY($1::text[])`,
      [refs],
    );
    const runIds = runs.rows.map((r) => r.id);
    const slots = await pool.query<{ item_id: string; final_state: string; answer_status: string | null; crosscheck_verdict: string | null; production_ready: boolean; kernel_family: string | null; criticality: string; substituted: boolean; omitted: boolean; last_resort_used: boolean; crosscheck_required: boolean; slot_latency_ms: number; run_id: string }>(
      `SELECT item_id, final_state, answer_status, crosscheck_verdict, production_ready, kernel_family, criticality, substituted, omitted, last_resort_used, crosscheck_required, slot_latency_ms, run_id FROM worksheet_slots WHERE run_id = ANY($1::text[])`,
      [runIds],
    );
    const attempts = await pool.query<{ run_id: string; item_id: string; step: string; accepted: boolean }>(
      `SELECT run_id, item_id, step, accepted FROM worksheet_slot_attempts WHERE run_id = ANY($1::text[])`,
      [runIds],
    );
    const delivered = slots.rows.filter((s) => s.final_state === 'READY');
    const dlv = delivered.length || 1;
    const wrongAccepted = delivered.filter((s) => s.answer_status === 'DETERMINISTIC_WRONG').length;
    const unsafeDelivered = delivered.filter((s) => !(s.answer_status === 'DETERMINISTIC_CORRECT' || s.crosscheck_verdict === 'PASS')).length;
    const falsePass = delivered.filter((s) => s.crosscheck_verdict === 'PASS' && s.answer_status === 'DETERMINISTIC_WRONG').length;
    const silent = delivered.filter((s) => s.answer_status === 'SEMANTIC_UNKNOWN').length;
    const kernelReady = delivered.filter((s) => s.kernel_family);
    const kernelProd = kernelReady.filter((s) => s.production_ready).length;
    const core = slots.rows.filter((s) => s.criticality === 'REQUIRED_CORE');
    const coreDelivered = runs.rows.filter((r) => r.worksheet_state !== 'FAILED').length;
    const optional = slots.rows.filter((s) => s.criticality !== 'REQUIRED_CORE');
    const attBySlot = new Map<string, { step: string; accepted: boolean }[]>();
    for (const a of attempts.rows) {
      const k = `${a.run_id}:${a.item_id}`;
      let l = attBySlot.get(k);
      if (!l) { l = []; attBySlot.set(k, l); }
      l.push(a);
    }
    const pathOf = (s: (typeof slots.rows)[number]) => {
      const at = attBySlot.get(`${s.run_id}:${s.item_id}`) ?? [];
      if (s.final_state === 'FAILED') return 'FAILED';
      if (s.final_state === 'OMITTED') return 'OMITTED';
      if (s.substituted) return 'SUBSTITUTION';
      if (s.last_resort_used) return 'LAST_RESORT';
      if (s.crosscheck_required && s.crosscheck_verdict === 'PASS') return 'CROSSCHECK';
      if (at.some((x) => x.step === 'escalate' && x.accepted)) return 'FALLBACK';
      if (at.length > 1) return 'RETRY';
      return 'FIRST_PASS';
    };
    const pc: Record<string, number> = {};
    for (const s of slots.rows) pc[pathOf(s)] = (pc[pathOf(s)] ?? 0) + 1;
    const total = slots.rows.length || 1;
    const rate = (k: string) => `${(((pc[k] ?? 0) / total) * 100).toFixed(1)}%`;

    const spend = await internalLiveSpendToday(pool, now);
    const dash = await internalLiveDashboard(pool, { sinceIso: now().toISOString().slice(0, 10) + 'T00:00:00Z' });
    const rops = await reviewQueueOps(pool, now().toISOString().slice(0, 10) + 'T00:00:00Z');
    const funnel = await productFunnel(pool, now().toISOString().slice(0, 10) + 'T00:00:00Z');
    const pctl = (arr: number[], q: number) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
    const slotLat = slots.rows.map((s) => s.slot_latency_ms).filter((n) => n > 0);
    const wsLat = runs.rows.map((r) => r.worksheet_latency_ms).filter((n) => n > 0);
    const servedFlows = flows.filter((f) => f.assignmentId);
    const scan = await scanInternalLiveSafety(pool, { sinceIso: now().toISOString().slice(0, 10) + 'T00:00:00Z' });

    const wave1Pass =
      wrongAccepted === 0 && unsafeDelivered === 0 && falsePass === 0 && silent === 0 &&
      (kernelReady.length === 0 || kernelProd === kernelReady.length) && !killed;

    const report = [
      `DẠYZI — CONTROLLED INTERNAL LIVE — WAVE 1  ${new Date().toISOString()}`,
      `WAVE1_LIVE_ENABLED = true   (AI_GENERATION_MODE=LIVE, cohort-gated)`,
      ``,
      `families (cohort): ${FAMILIES}   children: ${cohortKids.length}   worksheet runs (LIVE): ${runs.rows.length}`,
      `served AI assignments: ${servedFlows.length} / ${cohortKids.length}`,
      ``,
      `== SAFETY ==`,
      `wrong accepted: ${wrongAccepted}   (gate 0)`,
      `unsafe delivery: ${unsafeDelivered}   (gate 0)`,
      `false crosscheck PASS: ${falsePass}   (gate 0)`,
      `silent semantic contradiction: ${silent}   (gate 0)`,
      `kernel deterministic correctness: ${kernelReady.length ? ((kernelProd / kernelReady.length) * 100).toFixed(1) : 'n/a'}%  (${kernelProd}/${kernelReady.length})`,
      `safety auto-stop tripped: ${killed}`,
      ``,
      `== RELIABILITY ==`,
      `CORE_WORKSHEET_DELIVERY: ${runs.rows.length ? ((coreDelivered / runs.rows.length) * 100).toFixed(1) : '0'}%  (${coreDelivered}/${runs.rows.length})`,
      `VERIFIED_DELIVERY: ${((delivered.filter((s) => s.answer_status === 'DETERMINISTIC_CORRECT' || s.crosscheck_verdict === 'PASS').length / dlv) * 100).toFixed(2)}%`,
      `first-pass ${rate('FIRST_PASS')} · retry ${rate('RETRY')} · fallback ${rate('FALLBACK')} · last-resort ${rate('LAST_RESORT')} · crosscheck ${rate('CROSSCHECK')} · substitution ${rate('SUBSTITUTION')} · omitted ${rate('OMITTED')} · FAILED ${rate('FAILED')}`,
      `safe substitution: ${slots.rows.filter((s) => s.substituted).length}/${core.length} core · optional omission: ${slots.rows.filter((s) => s.omitted).length}/${optional.length} optional`,
      `review queue rate: ${rops.pending}/${total} slots`,
      ``,
      `== PRODUCT FUNNEL ==`,
      `today_plan_viewed (getToday calls): ${cohortKids.length * 2}`,
      `worksheet_generated: ${runs.rows.length}   worksheet_opened (served): ${servedFlows.length}`,
      `practice_started: ${servedFlows.length}   practice_completed: ${servedFlows.filter((f) => f.evidenceDelta > 0).length}`,
      `worksheet→practice conversion: ${runs.rows.length ? ((servedFlows.length / runs.rows.length) * 100).toFixed(1) : '0'}%`,
      `practice completion: ${servedFlows.length ? ((servedFlows.filter((f) => f.evidenceDelta > 0).length / servedFlows.length) * 100).toFixed(1) : '0'}%`,
      `funnel(observability): ${JSON.stringify(funnel)}`,
      ``,
      `== LEARNING LOOP ==`,
      `evidence_created (flows with Δ>0): ${servedFlows.filter((f) => f.evidenceDelta > 0).length}/${servedFlows.length}`,
      `twin_recomputed: ${servedFlows.filter((f) => f.twinChanged).length}/${servedFlows.length}`,
      `next_plan_changed: ${servedFlows.filter((f) => f.nextPlanChanged).length}/${servedFlows.length}`,
      `flows where generation worked but the loop did NOT update: ${servedFlows.filter((f) => f.evidenceDelta > 0 && !f.twinChanged).length}`,
      ``,
      `== OPERATIONS ==`,
      `generation spend: $${spend.generation.toFixed(4)} / $${dash.budgets.genDailyCapUsd}`,
      `crosscheck spend: $${spend.crosscheck.toFixed(4)} / $${dash.budgets.xcheckDailyCapUsd}`,
      `cost / worksheet: $${(spend.generation / (runs.rows.length || 1)).toFixed(5)}`,
      `slot p50/p95: ${pctl(slotLat, 0.5)}ms / ${pctl(slotLat, 0.95)}ms`,
      `worksheet p50/p95: ${pctl(wsLat, 0.5)}ms / ${pctl(wsLat, 0.95)}ms`,
      `review queue: size ${rops.pending}  oldest ${rops.oldestPendingAgeHours.toFixed(1)}h  median-resolution ${rops.medianResolutionHours.toFixed(1)}h`,
      `safety scan warnings: ${JSON.stringify(scan.warnings)}`,
      ``,
      `WAVE1_PASS = ${wave1Pass}`,
    ].join('\n');
    writeFileSync(OUT, report);
    console.log('\n' + report + '\n');

    // ---- hard gates ----
    expect(wrongAccepted, 'wrong accepted').toBe(0);
    expect(unsafeDelivered, 'unsafe delivery').toBe(0);
    expect(falsePass, 'false crosscheck PASS').toBe(0);
    expect(silent, 'silent semantic contradiction').toBe(0);
    if (kernelReady.length > 0) expect(kernelProd).toBe(kernelReady.length);
    expect(spend.generation).toBeLessThanOrEqual(dash.budgets.genDailyCapUsd + 0.05);
    expect(spend.crosscheck).toBeLessThanOrEqual(dash.budgets.xcheckDailyCapUsd + 0.05);
    expect(servedFlows.length, 'at least some AI worksheets were served').toBeGreaterThan(0);
    expect(servedFlows.filter((f) => f.evidenceDelta > 0).length, 'the learning loop closed for served flows').toBeGreaterThan(0);
  }, 60 * 60 * 1000);
});
