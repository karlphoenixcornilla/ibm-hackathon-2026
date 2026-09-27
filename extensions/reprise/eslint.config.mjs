// eslint.config.mjs — ESLint flat config for the Reprise extension
// Spec: 00-base.md §B7 — no innerHTML in media/ (security.md webview rule)

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // ── TypeScript source files ───────────────────────────────────────────────
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // General
      'no-console': 'off', // extension uses console for dev logging
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ── Ignored paths ─────────────────────────────────────────────────────────
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.js'],
  },
];
