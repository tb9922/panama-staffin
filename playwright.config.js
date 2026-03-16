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
      testIgnore: ['auth.setup.js', 'viewer.spec.js', 'auth.spec.js'],
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
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...process.env, NODE_ENV: 'test' },
    },
    {
      command: 'npx vite',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
