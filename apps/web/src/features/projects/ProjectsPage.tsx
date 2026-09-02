import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Money } from '@mc/shared'
import type { Paise, Project } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import { NewProjectForm } from './NewProjectForm'

const STATUS_TONE: Record<Project['status'], string> = {
  PLANNING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  ON_HOLD: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  COMPLETED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  CLOSED: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

export function ProjectsPage() {
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createProjectRepository(db), [])
  const [adding, setAdding] = useState(false)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => repo.listForUser(user.uid, user.role),
  })

  if (projects.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (projects.isError) {
    return (
      <QueryError error={projects.error} onRetry={() => void projects.refetch()} what="projects" />
    )
  }

  const priced = projects.data
    .map((p) => p.contractValuePaise)
    .filter((v): v is Paise => v !== undefined)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {t('projectsTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('countProjects', { n: projects.data.length })}
          </p>
        </div>
        {can('project:write') && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            {adding ? t('cancel') : t('newProject')}
          </button>
        )}
      </header>

      {adding && <NewProjectForm onDone={() => setAdding(false)} />}

      {projects.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">
            {user.role === 'SUPERVISOR' ? t('notAssignedToProject') : t('noProjectsYet')}
          </p>
          {can('project:write') && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {t('addFirstProject')}
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {p.name}
                    </p>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                      {p.clientName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[p.status]}`}
                  >
                    {p.status.replace('_', ' ').toLowerCase()}
                  </span>
                </div>

                {/* Supervisors never see money - spec section 20. */}
                {can('financials:view') && (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {p.contractValuePaise === undefined ? (
                      // Not "₹0". A job priced by measurement has no total to
                      // show, and a zero would read as a worthless contract.
                      t('noContractValue')
                    ) : (
                      <>
                        {t('contractValue')}{' '}
                        <Amount
                          paise={p.contractValuePaise}
                          className="text-slate-900 dark:text-slate-100"
                        />
                      </>
                    )}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Counted over the projects that actually have a contract value, and
          hidden when none do - a "total contract value" that silently treats
          every measure-and-bill job as zero would understate the business by
          most of its work (R-01). */}
      {can('financials:view') && priced.length > 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('totalContractAcross', { n: priced.length })}{' '}
          <Amount
            paise={Money.sum(priced)}
            className="font-medium text-slate-900 dark:text-slate-100"
          />
        </p>
      )}
    </div>
  )
}
