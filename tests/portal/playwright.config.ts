import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORTAL_PORT ?? 3100);
const baseURL = process.env.PORTAL_URL ?? `http://localhost:${port}`;

/**
 * The customer portal (apps/web) in a phone-sized Chromium.
 *   portal       stubs the public-quote Edge Function: page states, validation, XSS
 *   portal-live  the real local stack: critical paths against real data
 * Build apps/web first (`pnpm --filter @q2c/web build`, with SUPABASE_URL and
 * SUPABASE_ANON_KEY of the local stack); this starts `next start` on it.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: 'portal', testMatch: 'portal.spec.ts' },
    { name: 'portal-live', testMatch: 'live.spec.ts' },
  ],
  webServer: process.env.PORTAL_URL
    ? undefined
    : {
        command: `pnpm --filter @q2c/web exec next start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
