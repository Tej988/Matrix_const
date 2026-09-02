import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createReconcileRepository } from '@mc/shared/repositories/reconcile'
import { Dates, AI_STATUS } from '@mc/shared'
import type { Paise, Project } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import { resetTour } from '../tour/Tour'

/**
 * Settings, and the reconciliation tool that R-04 exists for.
 *
 * Since there is no server, project summaries are maintained by client-side
 * transactions and can drift. This page re-derives them from source documents
 * and shows a diff before writing anything - a button someone presses, never
 * silent self-healing.
 */
export function SettingsPage() {
  const user = useCurrentUser()
  const { t, locale, setLocale } = useTranslation()
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const reconcileRepo = useMemo(() => createReconcileRepository(db), [])
  const [checked, setChecked] = useState<Awaited<
    ReturnType<ReturnType<typeof createReconcileRepository>['preview']>
  > | null>(null)
  const [checkedProject, setCheckedProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  const check = useMutation({
    mutationFn: async (project: Project) => {
      const result = await reconcileRepo.preview(project, user.uid, Dates.now())
      setCheckedProject(project)
      return result
    },
    onSuccess: (r) => {
      setChecked(r)
      setError(null)
    },
    onError: (e) => setError((e as Error).message),
  })

  const apply = useMutation({
    mutationFn: async () => {
      if (!checked) throw new Error(t('nothingToApply'))
      await reconcileRepo.apply(checked.derived, checked.drift, {
        uid: user.uid,
        displayName: user.displayName,
      })
    },
    onSuccess: () => {
      setChecked(null)
      setCheckedProject(null)
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('settingsTitle')}
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('language')}
        </h2>
        <div className="flex gap-2">
          {(['en', 'hi'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={[
                'rounded-xl px-5 py-3 font-medium',
                locale === l
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'border border-slate-300 dark:border-slate-600',
              ].join(' ')}
            >
              {l === 'en' ? 'English' : 'हिन्दी'}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('checkTheFigures')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('reconcileExplain')}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {projects.isError && (
          <QueryError
            error={projects.error}
            onRetry={() => void projects.refetch()}
            what="projects"
          />
        )}

        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {(projects.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">
                {p.name}
              </span>
              <button
                type="button"
                onClick={() => check.mutate(p)}
                disabled={check.isPending}
                className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-600"
              >
                {check.isPending ? t('checking') : t('check')}
              </button>
            </li>
          ))}
        </ul>

        {checked && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="font-medium text-slate-900 dark:text-slate-100">{checkedProject?.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('countRecordsRead', { n: checked.documentsRead })}
            </p>

            {checked.drift.length === 0 ? (
              <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
                {t('everythingMatches')}
              </p>
            ) : (
              <>
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {t('countFiguresDisagree', { n: checked.drift.length })}
                </p>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="py-2">{t('figure')}</th>
                      <th className="py-2 text-right">{t('stored')}</th>
                      <th className="py-2 text-right">{t('correct')}</th>
                      <th className="py-2 text-right">{t('difference')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {checked.drift.map((d) => (
                      <tr key={String(d.field)}>
                        <td className="py-2 text-slate-700 dark:text-slate-200">
                          {humanise(String(d.field))}
                        </td>
                        <td className="py-2 text-right text-slate-500">
                          <Amount paise={d.stored} />
                        </td>
                        <td className="py-2 text-right font-medium">
                          <Amount paise={d.derived} />
                        </td>
                        <td className="py-2 text-right">
                          <Amount paise={d.differencePaise} signed />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={() => apply.mutate()}
                  disabled={apply.isPending}
                  className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {apply.isPending ? t('correcting') : t('correctStoredFigures')}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('introduction')}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('tourHint')}</p>
        <button
          type="button"
          onClick={() => {
            resetTour()
            window.location.reload()
          }}
          className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
        >
          {t('showTourAgain')}
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('aiAssistant')}
        </h2>
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <strong>{t('notAvailable')}</strong> {AI_STATUS.reason}
          <br />
          The tool layer is built and tested — when billing is enabled, connecting a provider is an
          adapter, not a rewrite.
        </p>
      </section>
    </div>
  )
}

function humanise(field: string): string {
  return field
    .replace(/Paise$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

export type { Paise }
