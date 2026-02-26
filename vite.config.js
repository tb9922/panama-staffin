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
  }
})
