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
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: [
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'ee/src/ee/components/ai/chat/**/*.test.tsx',
    ],
  },
});
