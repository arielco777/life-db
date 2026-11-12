/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    setupFiles: ['tests/setup.ts'],
    // Timing tests (NFR-1) run alone, one file at a time: `npm run test:perf` (--mode perf).
    // Sharing the CPU with the other test files would make their timings meaningless.
    include:
      mode === 'perf'
        ? ['tests/**/*.perf.test.{ts,tsx}']
        : ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: mode === 'perf' ? [] : ['**/*.perf.test.{ts,tsx}', '**/node_modules/**'],
    fileParallelism: mode !== 'perf',
  },
}));
