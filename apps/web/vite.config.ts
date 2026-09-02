import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

type ModuleInfoOf = (
  id: string,
) => { importers: readonly string[]; dynamicImporters: readonly string[] } | null

/** The one module allowed to pull a dependency tree in behind a lazy import. */
const PDF_RENDERER = 'features/reports/pdfExport'

/**
 * True when the ONLY way to reach this module is the report renderer's dynamic
 * `import()` - so nothing that loads before someone taps "make PDF" needs it.
 *
 * Walks the STATIC importers upwards. A package pulled in solely by an
 * `import()` has none, which is the base case; its own dependencies each have
 * a static importer, so the climb arrives at the same place. Anything the app
 * also imports normally climbs out to app code and is rejected.
 *
 * Note the base case tests WHO imported it dynamically. Accepting any dynamic
 * import would sweep up half the app: App.tsx is itself lazily imported by
 * main.tsx, so everything under it - Firebase included - is "lazy" by that
 * looser definition.
 *
 * `seen` is a cycle guard, not a result: returning true for a revisited module
 * only declines to disprove the claim, and a real static route out of the cycle
 * still makes `every()` false.
 */
function isPdfOnly(id: string, getModuleInfo: ModuleInfoOf, seen = new Set<string>()): boolean {
  if (seen.has(id)) return true
  seen.add(id)
  const info = getModuleInfo(id)
  if (!info) return false
  if (info.importers.length === 0) {
    // Reached only by `import()`. Every one of those importers must be the
    // renderer, or something that is itself only reachable from it - jsPDF
    // lazily imports canvg, dompurify and html2canvas from inside its own
    // modules, and that whole subtree (core-js included, ~100 KB gzipped)
    // belongs on the same side of the boundary as jsPDF does.
    return (
      info.dynamicImporters.length > 0 &&
      info.dynamicImporters.every(
        (p) => p.replace(/\\/g, '/').includes(PDF_RENDERER) || isPdfOnly(p, getModuleInfo, seen),
      )
    )
  }
  return info.importers.every((parent) => isPdfOnly(parent, getModuleInfo, seen))
}

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
        manualChunks(id, { getModuleInfo }) {
          if (!id.includes('node_modules')) return undefined
          /*
           * Hands anything behind the PDF renderer's lazy import back to
           * Rollup, which already knows how to chunk by dynamic-import
           * boundary. Manual naming makes it WORSE here: forcing the tree into
           * one 'pdf' chunk pulled canvg and core-js down with jsPDF on the
           * first tap (241 KB gz), where letting Rollup split leaves them in
           * chunks nothing ever asks for (jsPDF 127 + html2canvas 48 KB gz).
           *
           * What it must not do is fall through to `vendor`, which is an
           * INITIAL chunk: a lazily-imported module assigned there is dragged
           * into the first load silently, with the `await import()` still in
           * the source looking like it works. Matching 'jspdf' and
           * 'html2canvas' by name was not enough either - their dependency
           * trees (core-js, canvg, fast-png, @babel/runtime, fflate...) carry
           * neither name, and put 81 KB gz back on every first load. Asking
           * the module graph is the version a new transitive dependency cannot
           * quietly break (R-10).
           */
          if (isPdfOnly(id, getModuleInfo)) return undefined
          if (id.includes('@firebase') || id.includes('firebase')) return 'firebase'
          if (id.includes('react-router')) return 'router'
          if (id.includes('@tanstack')) return 'query'
          return 'vendor'
        },
      },
    },
  },
})
