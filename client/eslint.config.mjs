import { dirname } from 'path';
import { fileURLToPath } from 'url';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Next 16 / eslint-config-next ships React Compiler rules at error severity.
 * Keep classic correctness rules strict; treat Compiler migrations as warn until
 * call sites are refactored (tracked in NEXT16_REACT19_UPGRADE.md).
 */
const reactCompilerMigrationRules = {
  'react-hooks/set-state-in-effect': 'warn',
  'react-hooks/set-state-in-render': 'warn',
  'react-hooks/refs': 'warn',
  'react-hooks/immutability': 'warn',
  'react-hooks/purity': 'warn',
  'react-hooks/static-components': 'warn',
  'react-hooks/preserve-manual-memoization': 'warn',
  'react-hooks/incompatible-library': 'warn',
  'react-hooks/globals': 'warn',
  'react-hooks/error-boundaries': 'warn',
  'react-hooks/component-hook-factories': 'warn',
  'react-hooks/config': 'warn',
  'react-hooks/gating': 'warn',
  'react-hooks/memo-dependencies': 'warn',
  'react-hooks/use-memo': 'warn',
  'react-hooks/void-use-memo': 'warn',
  'react-hooks/todo': 'warn',
  'react-hooks/syntax': 'warn',
  'react-hooks/unsupported-syntax': 'warn',
  'react-hooks/rule-suppression': 'warn',
  'react-hooks/capitalized-calls': 'warn',
  'react-hooks/hooks': 'warn',
  'react-hooks/invariant': 'warn',
  'react-hooks/memoized-effect-dependencies': 'warn',
  'react-hooks/no-deriving-state-in-effects': 'warn',
  'react-hooks/fbt': 'warn',
};

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-console': 'warn',
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react/display-name': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-key': 'warn',
      ...reactCompilerMigrationRules,
    },
  },
  {
    ignores: [
      '.next/**',
      '.next-local/**',
      '.next-ee-local/**',
      '.next-dev/**',
      'node_modules/**',
      'public/sw.js',
      'ee/**/node_modules/**',
      'scripts/patch-antd-ellipsis.js',
      'tmp/**',
      '**/*.tsbuildinfo',
    ],
  },
];

export default eslintConfig;
