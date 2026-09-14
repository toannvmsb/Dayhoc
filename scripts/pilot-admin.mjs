// DẠYZI pilot — operator CLI (doc 70). Runs against the PILOT database directly
// (PILOT_DATABASE_URL in .env), so the pilot can be run without juggling bearer
// tokens / the admin REST API. Every action is a plain DB write the app already
// understands.
//
//   node scripts/pilot-admin.mjs status
//   node scripts/pilot-admin.mjs grant-admin  toannv.msb@gmail.com
//   node scripts/pilot-admin.mjs add-family   parent@example.com  "Gia đình A"
//   node scripts/pilot-admin.mjs consent      parent@example.com          # all that parent's children
//   node scripts/pilot-admin.mjs requeue      parent@example.com          # after granting consent post-hoc
//   node scripts/pilot-admin.mjs list
//   node scripts/pilot-admin.mjs safety                                   # read-only scan
//   node scripts/pilot-admin.mjs kill on  "reason"       |  kill off
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#') && (process.env[m[1]] === undefined || process.env[m[1]] === '')) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const DB = process.env.PILOT_DATABASE_URL;
if (!DB || /[<>[\]]/.test(DB)) {
  console.error('PILOT_DATABASE_URL missing / has <…> placeholders in .env'); process.exit(2);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const api = await import('../services/api/dist/index.js');
const pool = new Pool({ connectionString: DB, ssl: DB.includes('supabase') ? { rejectUnauthorized: false } : undefined, max: 2 });
const [cmd, a1, a2] = process.argv.slice(2);

const userByEmail = async (email) => {
  const r = await pool.query(`SELECT id, display_name FROM users WHERE lower(primary_email) = lower($1)`, [email]);
  if (!r.rows[0]) throw new Error(`no user with email ${email}`);
  return r.rows[0];
};
const familyOf = async (userId) => {
  const r = await pool.query(
    `SELECT f.id FROM families f JOIN family_memberships m ON m.family_id = f.id
      WHERE m.user_id = $1 ORDER BY (m.member_role = 'OWNER') DESC LIMIT 1`, [userId]);
  if (!r.rows[0]) throw new Error('user has no family yet — create a child profile first');
  return r.rows[0].id;
};
const childrenOf = async (userId) => (
  await pool.query(
    `SELECT c.id, c.display_name FROM child_profiles c
       JOIN parent_child_relationships r ON r.child_id = c.id
      WHERE r.parent_user_id = $1 AND r.status = 'ACTIVE' AND c.deletion_state <> 'deleted'`, [userId])
).rows;

try {
  switch (cmd) {
    case 'status': {
      const ks = await api.resolveKillSwitch(pool, process.env);
      const sp = await api.internalLiveSpendToday(pool);
      const b = api.loadInternalLiveBudgets(process.env);
      const fams = await api.listPilotFamilies(pool);
      console.log(JSON.stringify({
        killSwitch: ks,
        spendTodayUsd: { generation: sp.generation, crosscheck: sp.crosscheck },
        capsUsd: b,
        pilotFamilies: fams.length,
      }, null, 2));
      break;
    }
    case 'grant-admin': {
      const u = await userByEmail(a1);
      await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'ADMIN') ON CONFLICT DO NOTHING`, [u.id]);
      console.log(`ADMIN granted to ${a1} (${u.id}). No re-login needed.`);
      break;
    }
    case 'add-family': {
      const u = await userByEmail(a1);
      const famId = await familyOf(u.id);
      const ref = api.pilotFamilyRef(famId);
      await api.addPilotFamily(pool, ref, { note: a2 ?? `pilot: ${a1}`, actorRef: 'pilot-admin-cli' });
      console.log(`family of ${a1} added to PILOT cohort (ref ${ref}, consent required).`);
      break;
    }
    case 'consent': {
      const u = await userByEmail(a1);
      const kids = await childrenOf(u.id);
      if (kids.length === 0) throw new Error('that parent has no child profiles');
      for (const k of kids) {
        const had = await api.hasPilotConsent(pool, k.id);
        if (had) { console.log(`- ${k.display_name}: already has consent`); continue; }
        await api.recordPilotConsent(pool, { childId: k.id, grantedByUserId: u.id });
        console.log(`- ${k.display_name}: consent recorded`);
      }
      break;
    }
    case 'requeue': {
      // clear this child's worksheet_jobs bookkeeping (NOT the generated-content
      // history in worksheet_generation_runs) so the next "Hôm nay" open enqueues
      // a fresh job today. Use when a run already completed+cost money but got
      // SKIPPED at serving (e.g. consent was granted AFTER that run finished) —
      // the durable queue's per-day dedup key would otherwise block a re-enqueue
      // until tomorrow.
      const u = await userByEmail(a1);
      const kids = await childrenOf(u.id);
      if (kids.length === 0) throw new Error('that parent has no child profiles');
      for (const k of kids) {
        const ref = api.pilotChildRef(k.id);
        const del = await pool.query(`DELETE FROM worksheet_jobs WHERE child_ref = $1`, [ref]);
        console.log(`- ${k.display_name}: cleared ${del.rowCount} job row(s) — next "Hôm nay" open enqueues fresh today`);
      }
      break;
    }
    case 'list': {
      const fams = await api.listPilotFamilies(pool);
      const cohort = await api.listInternalLiveCohort(pool);
      console.log(JSON.stringify({ pilotFamilies: fams, internalCohort: cohort }, null, 2));
      break;
    }
    case 'safety': {
      const scan = await api.scanInternalLiveSafety(pool, {
        sinceIso: new Date(Date.now() - 24 * 3600_000).toISOString(),
      });
      console.log(JSON.stringify(scan, null, 2));
      break;
    }
    case 'kill': {
      const on = a1 === 'on';
      if (a1 !== 'on' && a1 !== 'off') throw new Error('usage: kill on "reason"  |  kill off');
      await api.setKillSwitch(pool, on, {
        reason: a2 ?? (on ? 'manual (pilot-admin-cli)' : 'cleared (pilot-admin-cli)'),
        source: 'manual', actorRef: 'pilot-admin-cli',
      });
      console.log(`kill switch → ${on ? 'ACTIVE (all new paid AI calls halted)' : 'off'}`);
      break;
    }
    default:
      console.error('commands: status | grant-admin <email> | add-family <email> [note] | consent <parent-email> | requeue <parent-email> | list | safety | kill <on|off> [reason]');
      process.exit(2);
  }
} catch (e) {
  console.error('error:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await pool.end().catch(() => undefined);
}
