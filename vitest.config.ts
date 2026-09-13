import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/web/lib/**/*.test.ts'],
    // The `*.integration.test.ts` suites all talk to ONE shared PostgreSQL and
    // some run privileged operations (`session_replication_role = replica` for
    // the child-deletion hard purge / ledger teardown). Running test files in
    // parallel workers races that shared session state. Keep files sequential;
    // tests within a file are already sequential by default.
    fileParallelism: false,
    // `getParentHome` / `getToday` / `studentGetToday` now round-trip to
    // `worksheet_run_serving` + the internal-live cohort/kill-switch checks on
    // every call (doc 70 — the LIVE enqueue/serve trigger moved onto the real
    // "Hôm nay" paths). Against the remote Supabase pooler the default 5s/10s
    // vitest timeouts are too tight for multi-step journey integration tests
    // that call those methods several times; local unit tests stay fast
    // regardless, so raising the ceiling only costs time on a genuine hang.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**'],
    },
  },
});
