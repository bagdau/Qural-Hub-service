/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8000', changeOrigin: true } } },
  build: {
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 300,
    rolldownOptions: {
      output: {
        // стабильные «вендорные» куски кешируются браузером и не перекачиваются при каждом обновлении приложения
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/, priority: 30 },
            { name: 'query', test: /node_modules[\/]@tanstack[\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
})
