/**
 * DẠYZI pilot — safety auto-stop cron (doc 69 §4 / doc 70 §2, §7).
 *
 * Run every ~10 minutes. Scans the recent LIVE window for the four
 * never-acceptable signals (wrong accepted / unsafe delivery / false crosscheck
 * PASS / silent semantic contradiction). A CRITICAL scan flips the DB kill
 * switch immediately — no human approval, no redeploy — and writes an
 * `internal_live_safety_events` row. Warnings are logged, not blocking.
 *
 *   DATABASE_URL=postgres://... node scripts/pilot-cron-safety.mjs
 *
 * Exit code: 0 = ran OK (whether or not it had to stop LIVE), 1 = script error
 * (bad config / DB unreachable). A trip is logged as a `CRITICAL` line; watch
 * the logs or the kill-switch status for that — do not rely on the exit code,
 * some schedulers (Railway) flag any non-zero exit as "Crashed".
 */
import { Pool } from 'pg';
import { enforceSafetyAutoStop, resolveKillSwitch } from '../services/api/dist/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    '[pilot-cron-safety] DATABASE_URL is not set. On Railway: open this service → ' +
      'Variables → add DATABASE_URL (and the rest of the pilot env block from doc 70).',
  );
  process.exit(1);
}

const WINDOW_MIN = Number(process.env.PILOT_SAFETY_WINDOW_MIN ?? 60);
const sinceIso = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

try {
  const pre = await resolveKillSwitch(pool, process.env);
  if (pre.active) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ok: true, killSwitch: 'already-active', source: pre.source, reason: pre.reason }));
    process.exit(0);
  }
  const res = await enforceSafetyAutoStop(pool, { sinceIso });
  const post = await resolveKillSwitch(pool, process.env);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      sinceIso,
      tripped: res.tripped,
      scan: res.scan,
      killSwitchActive: post.active,
    }),
  );
  if (res.tripped) {
    console.error(
      `[pilot-cron-safety] CRITICAL — LIVE generation auto-stopped. kill switch is now ACTIVE. ` +
        `reasons: ${res.scan.criticalReasons?.join('; ') || 'see scan'}. Investigate before clearing it.`,
    );
  }
  process.exit(0); // ran successfully — a trip is a success for this job
} catch (e) {
  console.error('[pilot-cron-safety] error', e);
  process.exit(1);
} finally {
  await pool.end().catch(() => undefined);
}
