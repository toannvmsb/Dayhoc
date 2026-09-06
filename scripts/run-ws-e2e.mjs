// Runner for the SMALL paid worksheet E2E (doc 63 §K, approved 2026-09-06).
// Loads OPENAI_API_KEY from .env and spawns the gated vitest with a hard cap.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY in .env');

Object.assign(env, { RUN_WORKSHEET_E2E: '1', WS_E2E_CAP_USD: '0.50' });

const r = spawnSync(
  'npx',
  ['vitest', 'run', 'packages/testing/src/benchmark/worksheet-e2e.live.test.ts', '--test-timeout=3600000'],
  { env, stdio: 'inherit', shell: true },
);
process.exit(r.status ?? 1);
