/**
 * Last-resort screen for a failure that happened before the app could mount.
 * Deliberately dependency-free: no router, no Firebase, no context - anything
 * it relied on might be the very thing that broke.
 */
export function FatalError({
  error,
  componentStack,
}: {
  error: unknown
  componentStack?: string | null
}) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 p-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-red-600 uppercase">
          The app could not start
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {message}
        </h1>
      </div>

      {stack && (
        <pre className="max-h-64 overflow-auto rounded-lg bg-slate-100 p-4 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {stack}
        </pre>
      )}

      {componentStack && (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Component tree
          </p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-slate-100 p-4 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {componentStack}
          </pre>
        </div>
      )}

      <div className="text-sm text-slate-600 dark:text-slate-300">
        <p className="font-medium">Things worth checking:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Is Google sign-in enabled in the Firebase console under Authentication &rarr; Sign-in
            method?
          </li>
          <li>
            Does <code>apps/web/.env.local</code> match the current Firebase project?
          </li>
          <li>
            Only one copy of the Firebase SDK should be installed &mdash; run{' '}
            <code>npm ls firebase</code>.
          </li>
        </ul>
      </div>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="self-start rounded-xl bg-slate-900 px-5 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Reload
      </button>
    </main>
  )
}
