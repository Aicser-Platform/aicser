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
    include: [
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'src/app/**/__tests__/**/*.test.ts',
      'src/app/**/__tests__/**/*.test.tsx',
      'src/hooks/**/__tests__/**/*.test.ts',
      'src/hooks/**/__tests__/**/*.test.tsx',
      'ee/src/ee/components/ai/chat/**/*.test.tsx',
      'ee/src/ee/components/ai/chat/**/*.test.ts',
      'ee/src/ee/app/(dashboard)/chat/utils/**/*.test.ts',
      'ee/src/ee/services/**/*.test.ts',
      'ee/src/ee/app/\\(dashboard\\)/settings/components/**/*.test.tsx',
    ],
  },
});
