import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    testTimeout: 10000,
    include: [
      'src/pages/__tests__/**/*.test.{js,jsx}',
      'src/components/__tests__/**/*.test.{js,jsx}',
      'src/hooks/__tests__/**/*.test.{js,jsx}',
    ],
    setupFiles: ['src/test/setup.js'],
    globals: true,
    css: false,
  },
});
