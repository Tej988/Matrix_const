/**
 * Shown when apps/web/.env.local is missing or incomplete. Deliberately plain -
 * it renders before Firebase, before routing, before anything that could itself
 * fail.
 */
export function SetupNeeded({ missing }: { missing: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-amber-600 uppercase">Setup needed</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Firebase configuration is incomplete
        </h1>
      </div>

      <p className="text-slate-600 dark:text-slate-300">
        These environment variables are missing or empty:
      </p>

      <pre className="overflow-x-auto rounded-lg bg-slate-100 p-4 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200">
        {missing}
      </pre>

      <ol className="list-decimal space-y-2 pl-5 text-slate-600 dark:text-slate-300">
        <li>
          Copy <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.local</code> in{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">apps/web/</code>.
        </li>
        <li>
          Fill in the Firebase web config. The fastest way is{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
            firebase apps:sdkconfig WEB
          </code>
          .
        </li>
        <li>Restart the dev server.</li>
      </ol>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        Full walkthrough in <code>docs/DEPLOYMENT.md</code>, sections 2 and 4. None of these
        values are secret &mdash; security comes from Firestore Rules, not from hiding the
        config.
      </p>
    </main>
  )
}
