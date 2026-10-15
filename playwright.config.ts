import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * The browser tests: the built application, served the way start.cmd serves it,
 * driven through every screen. Any console error fails a test.
 *
 * `npm run build` first; `npm run test:ui` runs them.
 */
const PRESET = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(PRESET) ? PRESET : undefined);

export default defineConfig({
  testDir: 'tests-ui',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { executablePath },
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'node server/serve.mjs 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
