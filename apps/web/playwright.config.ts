import { defineConfig, devices } from '@playwright/test';

/**
 * M8 — full-web golden-journey E2E. Drives the real Next.js app (port 3100)
 * against the same portable Postgres the API tests use. The dev server reads
 * apps/web/.env.local (DATABASE_URL + DZ_DEV_AUTH=1).
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace @copilot/web',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: '../..',
  },
});
