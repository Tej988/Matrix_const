import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Layering and determinism rules are enforced here rather than by convention,
 * so a violation is a build failure instead of a code-review opinion.
 * See ARCHITECTURE.md section 4 and RISKS.md R-12.
 */
export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '**/coverage', 'apps/mobile'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* The business layer is pure. It receives data and returns data.
     No React, no Firebase, no repositories, no I/O. This is what makes
     spec section 51's determinism requirement testable rather than aspirational. */
  {
    files: ['packages/shared/src/business/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-*'], message: 'The business layer must not import React.' },
            { group: ['firebase', 'firebase/*'], message: 'The business layer must not touch Firestore. Take data as an argument.' },
            { group: ['**/repositories/**'], message: 'The business layer must not call repositories. Dependencies point one way.' },
          ],
        },
      ],
    },
  },

  /* Every date must be anchored to Asia/Kolkata via packages/shared/src/datetime.
     A device-local `new Date()` on a phone with a wrong clock silently corrupts
     a wage period - RISKS.md R-12. */
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    ignores: ['packages/shared/src/datetime/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use packages/shared/src/datetime instead. Raw dates are device-local; ours are IST-anchored (R-12).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use packages/shared/src/datetime instead of Date.now() (R-12).',
        },
      ],
    },
  },

  /* UI renders computed results; it does not compute money. Spec section 50. */
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/business/**'],
              message: 'Import business functions from the @mc/shared entry point, not by deep path.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,js}', 'firebase/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
