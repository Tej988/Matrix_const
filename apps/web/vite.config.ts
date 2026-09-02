import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    /*
     * Firebase MUST resolve to exactly one copy. Two copies means the Firestore
     * handle created in apps/web fails the instance check inside a repository
     * in packages/shared, and the app dies at mount with a blank screen.
     * That already happened once: a transitive dependency pulled firebase 12 to
     * the root while apps/web kept 11 nested.
     */
    dedupe: ['firebase', 'react', 'react-dom'],
    /*
     * Array form, and order matters: the subpath patterns must come first or
     * the bare aliases would swallow `@mc/shared/repositories/users`.
     *
     * Subpath imports exist so that pulling in a repository does not drag
     * Firebase into a module that only wanted the pure business layer.
     */
    alias: [
      { find: /^@mc\/shared\/(.*)$/, replacement: r('../../packages/shared/src') + '/$1' },
      { find: /^@mc\/types\/(.*)$/, replacement: r('../../packages/types/src') + '/$1' },
      { find: /^@mc\/validation\/(.*)$/, replacement: r('../../packages/validation/src') + '/$1' },
      { find: '@mc/shared', replacement: r('../../packages/shared/src/index.ts') },
      { find: '@mc/types', replacement: r('../../packages/types/src/index.ts') },
      { find: '@mc/validation', replacement: r('../../packages/validation/src/index.ts') },
      { find: '@', replacement: r('./src') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /*
         * Function form splits by package rather than by named entry point.
         * Total bytes are unchanged (~1.4 MB raw / ~376 KB gzipped either way);
         * what this buys is cache stability - an app-code deploy leaves the
         * firebase, vendor, router and query chunks untouched, so an installed
         * PWA re-downloads ~8 KB instead of ~170 KB.
         *
         * Firebase alone is 220 KB gzipped and dominates the payload. It cannot
         * be lazy-loaded because auth gates the first paint. Revisit if the
         * first-load cost hurts supervisors on poor site connections; the PWA
         * cache makes it a one-time cost per device.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@firebase') || id.includes('firebase')) return 'firebase'
          if (id.includes('react-router')) return 'router'
          if (id.includes('@tanstack')) return 'query'
          return 'vendor'
        },
      },
    },
  },
})
