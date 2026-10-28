import { defineConfig } from 'vitest/config';

// `node:sqlite` is a newer Node builtin that Vite's resolver doesn't yet know, so
// we externalize it (otherwise Vite tries to bundle a "sqlite" package). Forked
// processes keep the native SQLite binding well-behaved.
export default defineConfig({
  test: {
    // Backend tests only; the web app has its own vitest project under web/.
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    server: {
      deps: {
        external: [/^node:sqlite$/, 'node:sqlite'],
      },
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
});
