// One-shot runner for the SMALL paid verification (doc 60 §8, approved 2026-09-06).
// Loads OPENAI_API_KEY from .env and spawns the gated vitest with a hard cap.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY in .env');

Object.assign(env, {
  RUN_ITEM_ROUND2: '1',
  ROUND2_SPEC_IDS: 'BENCH-LT-G4-02,BENCH-LT-G4-07,BENCH-LT-G7-04,BENCH-LT-G7-03,HC06,HC03',
  ROUND2_MODELS: 'gpt-5-mini,gpt-4.1-mini,gpt-4o-mini',
  ROUND2_BUDGET_USD: '0.30',
  ROUND2_HARD_CAP_USD: '0.35',
  ROUND2_OUT_TAG: '_VERIFY',
});

const r = spawnSync(
  'npx',
  ['vitest', 'run', 'packages/testing/src/benchmark/item-round2.live.test.ts', '--test-timeout=3600000'],
  { env, stdio: 'inherit', shell: true },
);
process.exit(r.status ?? 1);
