import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AiGenerationMode } from '@copilot/domain';
import { loadAiGenerationConfig } from '@copilot/ai';

/**
 * CONTROLLED INTERNAL LIVE ROLLOUT (doc 69) — the control plane that sits in
 * front of the LOCKED generation architecture.
 *
 *   effective mode = LIVE   iff  AI_GENERATION_MODE=LIVE
 *                          AND  no active kill switch (env OR db)
 *                          AND  the family is in `internal_live_cohort`
 *                = SHADOW  iff  AI_GENERATION_MODE ∈ {SHADOW, LIVE} and not LIVE-eligible
 *                = OFF     otherwise
 *
 * Nothing here changes model routing, spends outside the operational caps, or
 * exposes a public user. It is all reversible config + audited DB state.
 */

export const INTERNAL_LIVE_VERSION = 'internal-live.v1';

/** sha256(id) → 16 hex — the same opaque, non-reversible ref used everywhere else. */
export const familyRef = (familyId: string): string => createHash('sha256').update(familyId).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// kill switch (env OR db — either active halts ALL new paid AI calls, no deploy)
// ---------------------------------------------------------------------------

export interface KillSwitchState {
  readonly active: boolean;
  readonly source: 'env' | 'db' | 'none';
  readonly reason: string | null;
  readonly since: string | null;
}

export function envKillSwitch(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AI_GENERATION_KILL_SWITCH ?? '').toLowerCase() === 'true';
}

export async function resolveKillSwitch(
  pool: Pool,
  env: Record<string, string | undefined> = process.env,
): Promise<KillSwitchState> {
  if (envKillSwitch(env)) {
    return { active: true, source: 'env', reason: 'AI_GENERATION_KILL_SWITCH=true', since: null };
  }
  try {
    const { rows } = await pool.query<{ kill_switch: boolean; kill_reason: string | null; killed_at: string | null }>(
      `SELECT kill_switch, kill_reason, killed_at FROM ai_generation_runtime WHERE id = 'singleton'`,
    );
    const r = rows[0];
    if (r?.kill_switch) {
      return { active: true, source: 'db', reason: r.kill_reason ?? 'runtime kill switch', since: r.killed_at };
    }
  } catch {
    // table missing (pre-migration) → treat as no kill switch
  }
  return { active: false, source: 'none', reason: null, since: null };
}

export async function setKillSwitch(
  pool: Pool,
  on: boolean,
  opts: { reason: string; source: 'manual' | 'safety-autostop'; actorRef: string },
): Promise<void> {
  if (on) {
    await pool.query(
      `UPDATE ai_generation_runtime
          SET kill_switch = true, kill_reason = $1, kill_source = $2, killed_by = $3,
              killed_at = now(), updated_at = now()
        WHERE id = 'singleton'`,
      [opts.reason, opts.source, opts.actorRef],
    );
  } else {
    await pool.query(
      `UPDATE ai_generation_runtime
          SET kill_switch = false, cleared_by = $1, cleared_at = now(), updated_at = now()
        WHERE id = 'singleton'`,
      [opts.actorRef],
    );
  }
}

// ---------------------------------------------------------------------------
// INTERNAL LIVE cohort (allowlist)
// ---------------------------------------------------------------------------

export interface CohortMember {
  readonly familyRef: string;
  readonly wave: number;
  readonly note: string | null;
  readonly addedAt: string;
}

export async function isInInternalLiveCohort(pool: Pool, ref: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM internal_live_cohort WHERE family_ref = $1 AND removed_at IS NULL`,
      [ref],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function listInternalLiveCohort(pool: Pool): Promise<readonly CohortMember[]> {
  const { rows } = await pool.query<{ family_ref: string; wave: number; note: string | null; added_at: string }>(
    `SELECT family_ref, wave, note, added_at FROM internal_live_cohort WHERE removed_at IS NULL ORDER BY added_at`,
  );
  return rows.map((r) => ({ familyRef: r.family_ref, wave: r.wave, note: r.note, addedAt: r.added_at }));
}

export async function addToInternalLiveCohort(
  pool: Pool,
  ref: string,
  opts: { wave?: number; note?: string; actorRef: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO internal_live_cohort (family_ref, wave, note, added_by, added_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (family_ref) DO UPDATE SET removed_at = NULL, wave = EXCLUDED.wave, note = EXCLUDED.note`,
    [ref, opts.wave ?? 1, opts.note ?? null, opts.actorRef],
  );
}

export async function removeFromInternalLiveCohort(pool: Pool, ref: string, actorRef: string): Promise<void> {
  await pool.query(
    `UPDATE internal_live_cohort SET removed_at = now() WHERE family_ref = $1 AND removed_at IS NULL`,
    [ref],
  );
  void actorRef;
}

// ---------------------------------------------------------------------------
// effective generation mode
// ---------------------------------------------------------------------------

export type EffectiveGenerationMode = 'OFF' | 'SHADOW' | 'LIVE';

export interface EffectiveModeResult {
  readonly mode: EffectiveGenerationMode;
  readonly configuredMode: AiGenerationMode;
  readonly reason: string;
  readonly killSwitch: KillSwitchState;
}

/**
 * Resolve the mode that actually applies to ONE family. A `null` familyRef (no
 * owning family) can never be LIVE.
 */
export async function resolveEffectiveGenerationMode(
  pool: Pool,
  env: Record<string, string | undefined>,
  ref: string | null,
): Promise<EffectiveModeResult> {
  const configuredMode = loadAiGenerationConfig(env).mode;
  const killSwitch = await resolveKillSwitch(pool, env);

  if (configuredMode === 'OFF') {
    return { mode: 'OFF', configuredMode, reason: 'AI_GENERATION_MODE=OFF', killSwitch };
  }
  if (killSwitch.active) {
    // kill switch degrades LIVE → SHADOW (existing infra keeps working, no new
    // paid call from the LIVE serving path); SHADOW callers are gated separately
    // by the cost guard, so SHADOW itself is unaffected here beyond that.
    return {
      mode: configuredMode === 'LIVE' ? 'SHADOW' : configuredMode,
      configuredMode,
      reason: `kill switch active (${killSwitch.source}): ${killSwitch.reason}`,
      killSwitch,
    };
  }
  if (configuredMode === 'SHADOW') {
    return { mode: 'SHADOW', configuredMode, reason: 'AI_GENERATION_MODE=SHADOW', killSwitch };
  }
  // configuredMode === 'LIVE'
  if (!ref) {
    return { mode: 'SHADOW', configuredMode, reason: 'LIVE configured but no owning family — SHADOW', killSwitch };
  }
  const inCohort = await isInInternalLiveCohort(pool, ref);
  return inCohort
    ? { mode: 'LIVE', configuredMode, reason: 'AI_GENERATION_MODE=LIVE + family in INTERNAL_LIVE cohort', killSwitch }
    : { mode: 'SHADOW', configuredMode, reason: 'LIVE configured but family not in INTERNAL_LIVE cohort — SHADOW', killSwitch };
}

// ---------------------------------------------------------------------------
// INTERNAL LIVE operational budgets (separate from benchmark budgets)
// ---------------------------------------------------------------------------

export interface InternalLiveBudgets {
  readonly genDailyCapUsd: number;
  readonly xcheckDailyCapUsd: number;
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseFloat(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadInternalLiveBudgets(env: Record<string, string | undefined> = process.env): InternalLiveBudgets {
  return {
    genDailyCapUsd: num(env.INTERNAL_LIVE_GEN_DAILY_CAP_USD, 2.0),
    xcheckDailyCapUsd: num(env.INTERNAL_LIVE_XCHECK_DAILY_CAP_USD, 0.5),
  };
}

export type SpendKind = 'generation' | 'crosscheck';

export async function internalLiveSpendToday(
  pool: Pool,
  now: () => Date = () => new Date(),
): Promise<{ generation: number; crosscheck: number; calls: { generation: number; crosscheck: number } }> {
  const day = now().toISOString().slice(0, 10);
  const { rows } = await pool.query<{ kind: SpendKind; spent_usd: string; calls: number }>(
    `SELECT kind, spent_usd, calls FROM internal_live_spend WHERE spend_date = $1`,
    [day],
  );
  const out = { generation: 0, crosscheck: 0, calls: { generation: 0, crosscheck: 0 } };
  for (const r of rows) {
    out[r.kind] = Number(r.spent_usd);
    out.calls[r.kind] = r.calls;
  }
  return out;
}

export async function recordInternalLiveSpend(
  pool: Pool,
  kind: SpendKind,
  usd: number,
  calls = 1,
  now: () => Date = () => new Date(),
): Promise<void> {
  const day = now().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO internal_live_spend (spend_date, kind, spent_usd, calls, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (spend_date, kind)
       DO UPDATE SET spent_usd = internal_live_spend.spent_usd + EXCLUDED.spent_usd,
                     calls = internal_live_spend.calls + EXCLUDED.calls,
                     updated_at = now()`,
    [day, kind, Math.max(0, usd), Math.max(0, calls)],
  );
}

export interface BudgetGateResult {
  readonly ok: boolean;
  readonly kind: SpendKind;
  readonly spentTodayUsd: number;
  readonly capUsd: number;
  readonly reason: string | null;
}

/** Pre-call gate. Budget exhaustion degrades safely: the caller falls back to
 *  SHADOW / OFF rather than erroring the product flow. */
export async function internalLiveBudgetGate(
  pool: Pool,
  env: Record<string, string | undefined>,
  kind: SpendKind,
  estUsd: number,
  now: () => Date = () => new Date(),
): Promise<BudgetGateResult> {
  const budgets = loadInternalLiveBudgets(env);
  const cap = kind === 'generation' ? budgets.genDailyCapUsd : budgets.xcheckDailyCapUsd;
  const spend = await internalLiveSpendToday(pool, now);
  const spent = spend[kind];
  if (spent + Math.max(0, estUsd) > cap) {
    return {
      ok: false,
      kind,
      spentTodayUsd: spent,
      capUsd: cap,
      reason: `INTERNAL_LIVE ${kind} daily cap $${cap} reached ($${spent.toFixed(4)} spent) — degrading to SHADOW`,
    };
  }
  return { ok: true, kind, spentTodayUsd: spent, capUsd: cap, reason: null };
}

// ---------------------------------------------------------------------------
// safety auto-stop
// ---------------------------------------------------------------------------

export interface SafetyScan {
  readonly windowRuns: number;
  readonly deliveredItems: number;
  /** delivered item whose answer a deterministic check PROVED wrong. CRITICAL. */
  readonly wrongAccepted: number;
  /** delivered item that is neither deterministically correct nor crosscheck-PASS. CRITICAL. */
  readonly unsafeDelivered: number;
  /** crosscheck said PASS but the deterministic kernel says WRONG. CRITICAL. */
  readonly falseCrosscheckPass: number;
  /** delivered item with answer_status SEMANTIC_UNKNOWN. CRITICAL. */
  readonly silentContradiction: number;
  readonly kernelCorrectnessPct: number | null;
  readonly reviewQueuePending: number;
  readonly avgCostPerWorksheetUsd: number;
  readonly p95WorksheetLatencyMs: number;
  readonly critical: boolean;
  readonly criticalReasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface SafetyScanOpts {
  /** only scan runs since this ISO time (default: last 24h). */
  readonly sinceIso?: string;
  /** which mode's runs to scan (default LIVE). */
  readonly mode?: 'LIVE' | 'SHADOW';
  readonly maxReviewPending?: number; // WARNING threshold (default 100)
  readonly maxCostPerWorksheetUsd?: number; // WARNING threshold (default 0.08)
  readonly maxP95LatencyMs?: number; // WARNING threshold (default 180000)
  readonly now?: () => Date;
}

export async function scanInternalLiveSafety(pool: Pool, opts: SafetyScanOpts = {}): Promise<SafetyScan> {
  const now = opts.now ?? (() => new Date());
  const since = opts.sinceIso ?? new Date(now().getTime() - 86_400_000).toISOString();
  const mode = opts.mode ?? 'LIVE';

  const aggQ = await pool.query<{
    runs: string; delivered: string; wrong: string; unsafe: string; false_pass: string; sem_unknown: string;
    kernel_ready: string; kernel_prod: string; cost: string; p95: string;
  }>(
    `WITH r AS (SELECT * FROM worksheet_generation_runs WHERE mode = $1 AND created_at >= $2),
          s AS (SELECT sl.* FROM worksheet_slots sl JOIN r ON r.id = sl.run_id)
     SELECT
       (SELECT count(*) FROM r) runs,
       (SELECT count(*) FROM s WHERE final_state = 'READY') delivered,
       (SELECT count(*) FROM s WHERE final_state = 'READY' AND answer_status = 'DETERMINISTIC_WRONG') wrong,
       (SELECT count(*) FROM s WHERE final_state = 'READY'
          AND NOT (answer_status = 'DETERMINISTIC_CORRECT' OR crosscheck_verdict = 'PASS')) unsafe,
       (SELECT count(*) FROM s WHERE final_state = 'READY'
          AND crosscheck_verdict = 'PASS' AND answer_status = 'DETERMINISTIC_WRONG') false_pass,
       (SELECT count(*) FROM s WHERE final_state = 'READY' AND answer_status = 'SEMANTIC_UNKNOWN') sem_unknown,
       (SELECT count(*) FROM s WHERE kernel_family IS NOT NULL AND final_state = 'READY') kernel_ready,
       (SELECT count(*) FROM s WHERE kernel_family IS NOT NULL AND final_state = 'READY' AND production_ready) kernel_prod,
       (SELECT coalesce(avg(actual_cost_usd), 0) FROM r) cost,
       (SELECT coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY worksheet_latency_ms), 0) FROM r) p95`,
    [mode, since],
  );

  const rqQ = await pool.query<{ n: string }>(
    `SELECT count(*)::int n FROM review_queue WHERE state = 'PENDING' AND created_at >= $1`,
    [since],
  );

  const agg = aggQ.rows[0]!;
  const rq = rqQ.rows[0]!;
  const kernelReady = Number(agg.kernel_ready);
  const kernelCorrectnessPct = kernelReady > 0 ? (Number(agg.kernel_prod) / kernelReady) * 100 : null;
  const wrongAccepted = Number(agg.wrong);
  const unsafeDelivered = Number(agg.unsafe);
  const falseCrosscheckPass = Number(agg.false_pass);
  const silentContradiction = Number(agg.sem_unknown);
  const reviewQueuePending = Number(rq.n);
  const avgCostPerWorksheetUsd = Number(agg.cost);
  const p95WorksheetLatencyMs = Number(agg.p95);

  const criticalReasons: string[] = [];
  if (wrongAccepted > 0) criticalReasons.push(`${wrongAccepted} delivered item(s) with a PROVEN-wrong answer`);
  if (unsafeDelivered > 0) criticalReasons.push(`${unsafeDelivered} unverified item(s) delivered`);
  if (falseCrosscheckPass > 0) criticalReasons.push(`${falseCrosscheckPass} crosscheck-PASS item(s) contradicted by the kernel`);
  if (silentContradiction > 0) criticalReasons.push(`${silentContradiction} SEMANTIC_UNKNOWN item(s) delivered`);

  const warnings: string[] = [];
  if (kernelCorrectnessPct !== null && kernelCorrectnessPct < 100) {
    warnings.push(`kernel correctness ${kernelCorrectnessPct.toFixed(1)}% < 100%`);
  }
  if (reviewQueuePending > (opts.maxReviewPending ?? 100)) {
    warnings.push(`review queue pending ${reviewQueuePending} > ${opts.maxReviewPending ?? 100}`);
  }
  if (avgCostPerWorksheetUsd > (opts.maxCostPerWorksheetUsd ?? 0.08)) {
    warnings.push(`avg cost/worksheet $${avgCostPerWorksheetUsd.toFixed(4)} > $${opts.maxCostPerWorksheetUsd ?? 0.08}`);
  }
  if (p95WorksheetLatencyMs > (opts.maxP95LatencyMs ?? 180_000)) {
    warnings.push(`p95 worksheet latency ${p95WorksheetLatencyMs}ms > ${opts.maxP95LatencyMs ?? 180_000}ms`);
  }

  return {
    windowRuns: Number(agg.runs),
    deliveredItems: Number(agg.delivered),
    wrongAccepted,
    unsafeDelivered,
    falseCrosscheckPass,
    silentContradiction,
    kernelCorrectnessPct,
    reviewQueuePending,
    avgCostPerWorksheetUsd,
    p95WorksheetLatencyMs,
    critical: criticalReasons.length > 0,
    criticalReasons,
    warnings,
  };
}

/**
 * Run a safety scan and, if any CRITICAL condition is present, activate the
 * runtime kill switch and record the event. Idempotent — re-running while
 * already killed just records the fresh scan. Returns the scan + whether it
 * tripped the switch this call.
 */
export async function enforceSafetyAutoStop(
  pool: Pool,
  opts: SafetyScanOpts = {},
): Promise<{ tripped: boolean; scan: SafetyScan }> {
  const scan = await scanInternalLiveSafety(pool, opts);
  for (const w of scan.warnings) {
    await pool.query(
      `INSERT INTO internal_live_safety_events (id, severity, signal, detail, window_runs) VALUES ($1,'WARNING','alert',$2,$3)`,
      [randomUUID(), w, scan.windowRuns],
    ).catch(() => undefined);
  }
  if (!scan.critical) return { tripped: false, scan };

  const already = await resolveKillSwitch(pool);
  const reason = `AUTO-STOP: ${scan.criticalReasons.join('; ')}`;
  await pool.query(
    `INSERT INTO internal_live_safety_events (id, severity, signal, detail, window_runs, kill_switch_activated)
     VALUES ($1,'CRITICAL','safety-autostop',$2,$3,true)`,
    [randomUUID(), reason, scan.windowRuns],
  ).catch(() => undefined);
  if (!already.active) {
    await setKillSwitch(pool, true, { reason, source: 'safety-autostop', actorRef: 'safety-monitor' });
    return { tripped: true, scan };
  }
  return { tripped: false, scan };
}

// ---------------------------------------------------------------------------
// child-deletion purge (call from the deletion workflow) — replica-role safe
// ---------------------------------------------------------------------------

export async function purgeInternalLiveForChild(client: PoolClient, childRef: string): Promise<number> {
  const res = await client.query(`DELETE FROM internal_live_qa_sample WHERE child_ref = $1`, [childRef]);
  return res.rowCount ?? 0;
}
