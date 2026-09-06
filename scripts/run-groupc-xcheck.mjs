// Runner for the doc 66 §6 SMALL PAID Group-C crosscheck verification.
// Pre-approved crosscheck spend cap USD 0.50 total. gpt-4.1-mini verifier.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY in .env');
Object.assign(env, {
  RUN_GROUPC_XCHECK: '1',
  GROUPC_XCHECK_CAP_USD: process.env.GROUPC_XCHECK_CAP_USD ?? '0.50',
  CROSSCHECK_MODEL: process.env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini',
});

const r = spawnSync(
  'npx',
  ['vitest', 'run', 'packages/testing/src/benchmark/groupc-crosscheck.live.test.ts', '--test-timeout=1800000'],
  { env, stdio: 'inherit', shell: true },
);
process.exit(r.status ?? 1);
