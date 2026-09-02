import { defineConfig } from 'vitest/config'

/**
 * Security Rules tests run against the Firestore emulator, so they live in
 * their own config and their own npm script. Keeping them out of `npm test`
 * means the fast unit suite stays fast; `npm run check` runs both.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['firebase/**/*.test.ts'],
    // The emulator is a shared resource; parallel suites would clear each
    // other's data between tests.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
})
