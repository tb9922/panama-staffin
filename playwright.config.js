import { defineConfig } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT || 3137);
const uiPort = Number(process.env.E2E_UI_PORT || 5173);
const apiBaseURL = process.env.E2E_API_BASE || `http://localhost:${apiPort}`;
const uiBaseURL = process.env.E2E_BASE_URL || `http://localhost:${uiPort}`;
const stressIgnore = process.env.PANAMA_INCLUDE_STRESS === '1' ? [] : ['**/stress/**', '**\\stress\\**'];

process.env.E2E_API_BASE = apiBaseURL;
process.env.E2E_BASE_URL = uiBaseURL;

export default defineConfig({
  globalSetup: './scripts/seed-e2e.js',
  testDir: 'tests/e2e',
  testIgnore: stressIgnore,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // sequential — tests share DB state
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: uiBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup — runs first, saves cookie state for other projects
    { name: 'setup', testMatch: 'auth.setup.js' },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: '.playwright/admin-state.json',
      },
      dependencies: ['setup'],
      testIgnore: ['auth.setup.js', 'viewer.spec.js', 'auth.spec.js', ...stressIgnore],
    },
    {
      name: 'viewer',
      use: {
        browserName: 'chromium',
        storageState: '.playwright/viewer-state.json',
      },
      dependencies: ['setup'],
      testMatch: 'viewer.spec.js',
    },
    // Auth flow tests run LAST — logout deny-lists admin tokens which would
    // block subsequent chromium tests (isDenied checks by username).
    {
      name: 'auth-flow',
      use: { browserName: 'chromium' },
      dependencies: ['chromium', 'viewer'],
      testMatch: 'auth.spec.js',
    },
  ],

  webServer: [
    {
      command: 'node server.js',
      port: apiPort,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PANAMA_E2E_SERVER: '1',
        ENABLE_STAFF_PORTAL: '1',
        PORT: String(apiPort),
        HOST: '127.0.0.1',
        ALLOWED_ORIGIN: uiBaseURL,
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${uiPort}`,
      port: uiPort,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, VITE_DEV_API_TARGET: apiBaseURL },
    },
  ],
});
