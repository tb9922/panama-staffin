import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:3001';
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    chunkSizeWarningLimit: 1000, // ExcelJS (937KB) is lazy-loaded on export - not a perf concern
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          sentry: ['@sentry/react'],
          pdf: ['jspdf', 'jspdf-autotable'],
          excel: ['exceljs'],
        },
      },
    },
  },
  server: {
    ...(allowedHosts.length ? { allowedHosts } : {}),
    proxy: {
      '/api': apiTarget,
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
          testTimeout: 30000,
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
