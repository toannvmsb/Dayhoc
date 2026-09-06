// Runner for the doc 66 §3 internal shadow smoke (autonomous, pre-approved
// cumulative cap USD 2.00, per-worksheet USD 0.05).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY in .env');
Object.assign(env, { RUN_WS_SMOKE: '1', WS_SMOKE_DAILY_USD: '2.00', WS_SMOKE_PER_WS_USD: '0.05' });

const r = spawnSync('npx', ['vitest', 'run', 'packages/testing/src/benchmark/worksheet-shadow-smoke.live.test.ts', '--test-timeout=3600000'], { env, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
