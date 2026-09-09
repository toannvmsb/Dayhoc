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
 * Exit code: 0 clean, 10 tripped (kill switch now active), 1 error.
 */
import { Pool } from 'pg';
import { enforceSafetyAutoStop, resolveKillSwitch } from '../services/api/dist/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('set DATABASE_URL');
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
    console.log(JSON.stringify({ ok: true, killSwitch: 'already-active', source: pre.source, reason: pre.reason }));
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
  process.exit(res.tripped ? 10 : 0);
} catch (e) {
  console.error('[pilot-cron-safety] error', e);
  process.exit(1);
} finally {
  await pool.end().catch(() => undefined);
}
