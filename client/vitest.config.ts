import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  resolve: {
    alias: [
      // @/ee must come before @ so the more-specific alias wins
      { find: /^@\/ee$/, replacement: path.resolve(__dirname, './src/ee-fallback.ts') },
      { find: /^@\/ee\/(.*)$/, replacement: path.resolve(__dirname, './ee/src/ee/$1') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Every unit test in the app: a hand-kept folder list silently skipped ~40 test files that
    // sat next to their code, so a green run did not mean they passed.
    include: ['src/**/*.test.{ts,tsx}', 'ee/src/**/*.test.{ts,tsx}'],
  },
});
