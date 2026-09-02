import { useMemo } from 'react'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Dates, type Permission } from '@mc/shared'
import type { Project } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth } from '../auth/authContext'
import { useTranslation } from '../../i18n/useTranslation'
import type { StringKey } from '../../i18n/strings'

/**
 * A project, split into tabs.
 *
 * Everything here used to be one scroll: the figures, then bills, then
 * receipts and expenses, then the rate card, then measurements. Five dense
 * sections stacked on a phone, and the owner's read of it was fair - "that
 * makes this more ambiguous, the audience is a contractor who may not have
 * much technical knowledge".
 *
 * Tabs rather than new nav entries. The nav was deliberately cut back to six
 * daily items, and none of these screens means anything without a project
 * chosen first - a top-level "Bills" would have to ask "which project?" before
 * it could show anything, which is a step backwards.
 *
 * The tab lives in the URL (`/projects/:id/bills`), so Back works, a tab can
 * be sent to someone on WhatsApp, and a refresh lands where you were.
 */

export interface ProjectTabContext {
  project: Project
}

/** Typed access to the project the tab is rendering inside. */
export function useProjectTab(): ProjectTabContext {
  return useOutletContext<ProjectTabContext>()
}

interface ProjectTab {
  to: string
  labelKey: StringKey
  /**
   * Absent means everyone who can open the project. A tab the role cannot use
   * is not rendered disabled - it is not rendered, so a supervisor sees three
   * tabs and no hint that money screens exist (spec section 20).
   */
  permission?: Permission
}

const TABS: readonly ProjectTab[] = [
  { to: 'overview', labelKey: 'tabOverview' },
  { to: 'bills', labelKey: 'tabBills', permission: 'bill:read' },
  { to: 'money', labelKey: 'tabMoney', permission: 'clientPayment:read' },
  { to: 'rate-card', labelKey: 'tabRateCard', permission: 'boq:read' },
  { to: 'measurements', labelKey: 'tabMeasurements', permission: 'measurement:read' },
]

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createProjectRepository(db), [])

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => repo.get(projectId),
  })

  if (project.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (project.isError || !project.data) {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {t('projectNotFound')}
        </p>
        <Link to="/projects" className="text-slate-600 underline dark:text-slate-300">
          {t('backToProjects')}
        </Link>
      </div>
    )
  }

  const p = project.data
  const visible = TABS.filter((tab) => !tab.permission || can(tab.permission))
  const context: ProjectTabContext = { project: p }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/projects" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← {t('projectsTitle')}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{p.name}</h1>
        <p className="text-slate-500 dark:text-slate-400">
          {p.clientName}
          {p.code && <span className="ml-2 font-mono text-xs">{p.code}</span>}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {p.status.replace('_', ' ').toLowerCase()} · {t('started')}{' '}
          {Dates.formatDateKey(p.startDate)}
          {p.siteAddress && ` · ${p.siteAddress}`}
        </p>
      </div>

      {/*
        Bleeds to the screen edge on a phone so the last tab is visibly cut off
        rather than looking like the end of the list - that overhang is the
        only affordance saying "scroll me". Targets are 44px tall, the minimum
        a thumb hits reliably on site.
      */}
      <nav
        aria-label={t('projectSections')}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 pb-2 sm:mx-0 sm:px-0 dark:border-slate-700"
      >
        {visible.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              [
                'flex min-h-11 shrink-0 items-center rounded-lg px-4 text-sm font-medium transition',
                isActive
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              ].join(' ')
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </div>
  )
}
