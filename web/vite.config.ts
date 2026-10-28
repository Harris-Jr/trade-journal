/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `@core` points at the backend's pure, browser-safe engine modules (metrics,
// analytics, import). Demo mode runs the SAME code as the server, so demo numbers
// match backend results. (We never import the server/db modules — those use Node builtins.)
const core = fileURLToPath(new URL('../src', import.meta.url));

// The dev server proxies /api → the backend on localhost:3000, so the browser
// talks same-origin (no CORS) and the API stays bound to localhost in dev.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: {
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
