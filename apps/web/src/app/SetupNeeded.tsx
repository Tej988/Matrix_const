import { useTranslation } from '../i18n/useTranslation'

/**
 * Shown when apps/web/.env.local is missing or incomplete. Deliberately plain -
 * it renders before Firebase, before routing, before anything that could itself
 * fail.
 */
export function SetupNeeded({ missing }: { missing: string }) {
  const { t } = useTranslation()

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-amber-600 uppercase">
          {t('setupNeeded')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('firebaseConfigIncomplete')}
        </h1>
      </div>

      <p className="text-slate-600 dark:text-slate-300">{t('envVarsMissing')}</p>

      <pre className="overflow-x-auto rounded-lg bg-slate-100 p-4 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200">
        {missing}
      </pre>

      <ol className="list-decimal space-y-2 pl-5 text-slate-600 dark:text-slate-300">
        <li>
          {t('setupCopy')}{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.example</code>{' '}
          {t('setupTo')}{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.local</code>{' '}
          {t('setupIn')}{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">apps/web/</code>
          {t('fullStop')}
        </li>
        <li>
          {t('setupFillConfig')}{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
            firebase apps:sdkconfig WEB
          </code>
          {t('fullStop')}
        </li>
        <li>{t('setupRestart')}</li>
      </ol>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('setupWalkthroughIn')} <code>docs/DEPLOYMENT.md</code>
        {t('setupWalkthroughRest')}
      </p>
    </main>
  )
}
