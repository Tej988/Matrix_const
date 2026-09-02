import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@mc/types': r('./packages/types/src/index.ts'),
      '@mc/shared': r('./packages/shared/src/index.ts'),
      '@mc/validation': r('./packages/validation/src/index.ts'),
    },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['packages/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/shared/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      /* The business layer is the money. TESTING.md section 2. */
      thresholds: {
        'packages/shared/src/business/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
})
