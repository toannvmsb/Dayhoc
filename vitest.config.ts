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
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**'],
    },
  },
});
