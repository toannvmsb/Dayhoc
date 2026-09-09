/**
 * DẠYZI pilot — daily maintenance cron (doc 69 §8 / doc 70 §2, §9).
 *
 * Run once a day. Two janitorial sweeps, both idempotent:
 *   - purge expired QA-sample snapshots (nulls the content, keeps the
 *     operational row + marks it purged) — retention is 7 days for pilot.
 *   - drop held worksheet content for serving intents never claimed within 48h.
 *
 *   DATABASE_URL=postgres://... node scripts/pilot-cron-maintenance.mjs
 */
import { Pool } from 'pg';
import { purgeExpiredQaSamples, purgeStaleServingIntents } from '../services/api/dist/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('set DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

try {
  const qaPurged = await purgeExpiredQaSamples(pool);
  const servingExpired = await purgeStaleServingIntents(pool);
  console.log(JSON.stringify({ ts: new Date().toISOString(), qaSnapshotsPurged: qaPurged, servingIntentsExpired: servingExpired }));
  process.exit(0);
} catch (e) {
  console.error('[pilot-cron-maintenance] error', e);
  process.exit(1);
} finally {
  await pool.end().catch(() => undefined);
}
