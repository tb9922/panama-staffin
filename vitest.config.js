import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    include: ['src/lib/__tests__/**/*.test.js', 'tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/design.js', 'src/lib/bankHolidays.js'],
    },
  },
});
