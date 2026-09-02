import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Dates, calculateOutstanding, isOverBilled, isOverPaid } from '@mc/shared'
import type { Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'
import { BoqSection } from '../boq/BoqSection'
import { MeasurementsSection } from '../measurements/MeasurementsSection'
import { BillsSection } from '../bills/BillsSection'
import { FinanceSection } from '../payments/FinanceSection'

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createProjectRepository(db), [])
  const showMoney = can('financials:view')

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => repo.get(projectId),
  })

  const summary = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => repo.getSummary(projectId),
    enabled: showMoney,
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

  /*
   * Derived from the summary rather than trusted from it. The summary is
   * maintained by client-side transactions and can drift (R-04), so the three
   * outstanding figures are recomputed here from the stored totals - which
   * makes an inconsistency visible instead of authoritative.
   */
  const outstanding = summary.data
    ? calculateOutstanding({
        contractValuePaise: summary.data.contractValuePaise,
        totalBilledPaise: summary.data.totalBilledPaise,
        totalReceivedPaise: summary.data.totalReceivedPaise,
      })
    : null

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

      {!showMoney && (
        <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {t('noMoneyForRole')}
        </p>
      )}

      {showMoney && summary.isPending && <p className="text-slate-500">{t('loading')}</p>}

      {showMoney && summary.data && outstanding && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label={t('contractValue')} paise={summary.data.contractValuePaise} />
            <Stat label={t('billed')} paise={summary.data.totalBilledPaise} />
            <Stat label={t('received')} paise={summary.data.totalReceivedPaise} />
          </section>

          {/*
            The R-01 resolution, on screen. Three separate figures with three
            separate labels, because "outstanding" alone means all three and
            the spec used it for two of them.
          */}
          <section>
            <h2 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('whatIsOutstanding')}
            </h2>
            <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              <Line
                label={t('receivable')}
                hint={t('receivableHint')}
                paise={outstanding.receivablePaise}
                emphasis
              />
              <Line
                label={t('unbilledBalance')}
                hint={t('unbilledHint')}
                paise={outstanding.unbilledBalancePaise}
              />
              <Line
                label={t('contractRemaining')}
                hint={t('contractRemainingHint')}
                paise={outstanding.contractRemainingPaise}
              />
            </dl>

            {isOverBilled(outstanding) && (
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {t('overBilled')}
              </p>
            )}
            {isOverPaid(outstanding) && (
              <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                {t('overPaid')}
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('labourAndCosts')}
            </h2>
            <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              <Line label={t('labourEarned')} paise={summary.data.labourEarnedPaise} />
              <Line label={t('labourPaid')} paise={summary.data.labourPaidPaise} />
              <Line label={t('labourPayable')} paise={summary.data.labourPayablePaise} emphasis />
              <Line label={t('otherExpenses')} paise={summary.data.otherExpensesPaise} />
              <Line
                label={t('cashPosition')}
                hint={t('cashPositionHint')}
                paise={summary.data.netPositionPaise}
              />
            </dl>
          </section>

          <p className="text-xs text-slate-400">
            {t('figuresComputed')} {summary.data.computedAt.toLocaleString('en-IN')}
          </p>
        </>
      )}

      {/*
        Billing and money first. Rate card and measurements are set-up and
        data-entry; bills and receipts are what the owner opens a project to
        check. Ordered by how often each is read, not by the order the data
        flows through them.
      */}
      <BillsSection project={p} />

      <FinanceSection project={p} />

      <BoqSection projectId={p.id} contractValuePaise={p.contractValuePaise} />

      <MeasurementsSection projectId={p.id} />
    </div>
  )
}

function Stat({ label, paise }: { label: string; paise: Paise }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        <Amount paise={paise} />
      </p>
    </div>
  )
}

function Line({
  label,
  hint,
  paise,
  emphasis = false,
}: {
  label: string
  hint?: string
  paise: Paise
  emphasis?: boolean
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <dt>
        <span
          className={
            emphasis
              ? 'font-medium text-slate-900 dark:text-slate-100'
              : 'text-slate-600 dark:text-slate-300'
          }
        >
          {label}
        </span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </dt>
      <dd
        className={
          emphasis
            ? 'font-semibold text-slate-900 dark:text-slate-100'
            : 'text-slate-700 dark:text-slate-200'
        }
      >
        <Amount paise={paise} signed />
      </dd>
    </div>
  )
}
