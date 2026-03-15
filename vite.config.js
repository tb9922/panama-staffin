import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1000, // ExcelJS (937KB) is lazy-loaded on export — not a perf concern
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
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
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/design.js', 'src/lib/bankHolidays.js'],
    },
  },
})
