// Run a command against the PILOT Supabase Postgres (doc 70).
// Reads PILOT_DATABASE_URL from repo-root .env (gitignored), sets DATABASE_URL
// + PGSSLMODE=no-verify (the pooler cert is not in the local trust store), and
// spawns the given command. NEVER prints the connection string.
//
//   node scripts/pilot-db.mjs -- npm run db:migrate
//   node scripts/pilot-db.mjs -- npx node-pg-migrate up --dry-run
//   node scripts/pilot-db.mjs -- node scripts/seed-pilot.mjs   # non-prod fixtures only
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
// `.env` FILLS values the shell did not already provide.
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#') && (process.env[m[1]] === undefined || process.env[m[1]] === '')) {
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const pilot = env.PILOT_DATABASE_URL;
if (!pilot || /[<>[\]]/.test(pilot)) {
  console.error('PILOT_DATABASE_URL missing or still has <…> placeholders in .env');
  console.error('Add a line to .env:  PILOT_DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-...pooler.supabase.com:5432/postgres');
  process.exit(2);
}
env.DATABASE_URL = pilot;
env.PGSSLMODE = env.PGSSLMODE ?? 'no-verify';
env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const sep = process.argv.indexOf('--');
const cmd = sep >= 0 ? process.argv.slice(sep + 1) : process.argv.slice(2);
if (cmd.length === 0) {
  console.error('usage: node scripts/pilot-db.mjs -- <command...>');
  process.exit(2);
}
console.error(`[pilot-db] ${cmd.join(' ')}  (db: ${new URL(pilot).host})`);
const r = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit', shell: true, cwd: root });
process.exit(r.status ?? 1);
