// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.next/**',
      'apps/mobile/**',
      'apps/web/**', // Next.js app — linted by `next lint` with its own config
      // Vendored Claude Design export — reference artifact, not our source.
      'docs/design/handoff/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // TypeScript's own checker handles these correctly (incl. type-only positions);
      // the core rules misfire on interface method signatures and Node globals.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      // Engineering rule: avoid `any` (see CLAUDE.md coding conventions).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Config & test files may be looser.
    files: ['**/*.config.*', '**/*.test.ts', 'packages/testing/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
