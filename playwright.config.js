import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // sequential — tests share DB state
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
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
      testIgnore: ['auth.setup.js', 'viewer.spec.js'],
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
  ],

  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
