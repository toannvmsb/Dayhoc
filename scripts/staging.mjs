// Run a command against the STAGING Supabase Postgres (doc 67 §D3+).
// Loads STAGING_DATABASE_URL from repo-root .env, sets DATABASE_URL +
// PGSSLMODE=no-verify (the pooler cert is not in the local trust store), and
// spawns the given command. NEVER prints the connection string.
//
//   node scripts/staging.mjs -- npx node-pg-migrate up
//   node scripts/staging.mjs -- npx vitest run services/api/src/production
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
// `.env` FILLS values the shell did not already provide — an explicit shell
// env var (e.g. `AI_GENERATION_MODE=LIVE node scripts/staging.mjs …`) wins.
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#') && (process.env[m[1]] === undefined || process.env[m[1]] === '')) {
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const staging = env.STAGING_DATABASE_URL;
if (!staging || /[<>[\]]/.test(staging)) {
  console.error('STAGING_DATABASE_URL missing or still has <…> placeholders in .env');
  process.exit(2);
}
env.DATABASE_URL = staging;
env.PGSSLMODE = env.PGSSLMODE ?? 'no-verify';
env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const sep = process.argv.indexOf('--');
const cmd = sep >= 0 ? process.argv.slice(sep + 1) : process.argv.slice(2);
if (cmd.length === 0) {
  console.error('usage: node scripts/staging.mjs -- <command...>');
  process.exit(2);
}
console.error(`[staging] ${cmd.join(' ')}  (db: ${new URL(staging).host})`);
const r = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit', shell: true, cwd: root });
process.exit(r.status ?? 1);
