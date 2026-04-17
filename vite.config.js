import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000, // ExcelJS (937KB) is lazy-loaded on export - not a perf concern
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    testTimeout: 15000,
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: [
            'src/lib/__tests__/**/*.test.js',
            'tests/**/*.test.js',
          ],
          setupFiles: ['src/test/setup.js'],
          testTimeout: 15000,
          // Fast bcrypt for tests - cost 4 vs production 12 (~1ms vs ~300ms per hash)
          env: { BCRYPT_ROUNDS: '4' },
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'pages',
          environment: 'jsdom',
          globals: true,
          include: ['src/pages/__tests__/**/*.test.jsx'],
          setupFiles: ['src/test/setup.js'],
          testTimeout: 15000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'contexts',
          environment: 'jsdom',
          globals: true,
          include: [
            'src/contexts/__tests__/**/*.test.{js,jsx}',
          ],
          testTimeout: 15000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/design.js', 'src/lib/bankHolidays.js'],
    },
  },
});
