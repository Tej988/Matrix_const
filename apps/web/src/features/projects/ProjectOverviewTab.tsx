import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { calculateOutstanding, isOverBilled, isOverPaid } from '@mc/shared'
import type { Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'
import { useProjectTab } from './ProjectDetailPage'

/**
 * The figures. The default tab, because "how does this job stand" is what the
 * owner opens a project to find out; everything else is the work that
 * produced these numbers.
 */
export function ProjectOverviewTab() {
  const { project } = useProjectTab()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createProjectRepository(db), [])
  const showMoney = can('financials:view')

  const summary = useQuery({
    queryKey: ['project-summary', project.id],
    queryFn: () => repo.getSummary(project.id),
    enabled: showMoney,
  })

  if (!showMoney) {
    return (
      <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {t('noMoneyForRole')}
      </p>
    )
  }

  if (summary.isPending) return <p className="text-slate-500">{t('loading')}</p>
  if (!summary.data) return null

  const s = summary.data

  /*
   * Derived from the summary rather than trusted from it. The summary is
   * maintained by client-side transactions and can drift (R-04), so the
   * outstanding figures are recomputed here from the stored totals - which
   * makes an inconsistency visible instead of authoritative.
   */
  const outstanding = calculateOutstanding({
    contractValuePaise: s.contractValuePaise,
    totalBilledPaise: s.totalBilledPaise,
    totalReceivedPaise: s.totalReceivedPaise,
  })

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        {/*
          A project with no agreed total says so in words. Showing ₹0 here, or
          leaving the tile out, would both read as "the contract is worth
          nothing" rather than "this job is priced by measurement" (R-01).
        */}
        {s.contractValuePaise === null ? (
          <NoteStat
            label={t('contractValue')}
            value={t('noContractValue')}
            hint={t('noContractValueHint')}
          />
        ) : (
          <Stat label={t('contractValue')} paise={s.contractValuePaise} />
        )}
        <Stat label={t('billed')} paise={s.totalBilledPaise} />
        <Stat label={t('received')} paise={s.totalReceivedPaise} />
      </section>

      {/*
        The R-01 resolution, on screen. Receivable always - it needs no
        contract value and is therefore the only answer to "kitna baaki hai"
        on most of this business's jobs. The two contract-derived figures
        appear only when there is a contract to derive them from.
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
          {outstanding.unbilledBalancePaise !== null && (
            <Line
              label={t('unbilledBalance')}
              hint={t('unbilledHint')}
              paise={outstanding.unbilledBalancePaise}
            />
          )}
          {outstanding.contractRemainingPaise !== null && (
            <Line
              label={t('contractRemaining')}
              hint={t('contractRemainingHint')}
              paise={outstanding.contractRemainingPaise}
            />
          )}
        </dl>

        {outstanding.unbilledBalancePaise === null && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('onlyReceivableApplies')}
          </p>
        )}

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
          <Line label={t('labourEarned')} paise={s.labourEarnedPaise} />
          <Line label={t('labourPaid')} paise={s.labourPaidPaise} />
          <Line label={t('labourPayable')} paise={s.labourPayablePaise} emphasis />
          <Line label={t('otherExpenses')} paise={s.otherExpensesPaise} />
          <Line label={t('cashPosition')} hint={t('cashPositionHint')} paise={s.netPositionPaise} />
        </dl>
      </section>

      <p className="text-xs text-slate-400">
        {t('figuresComputed')} {s.computedAt.toLocaleString('en-IN')}
      </p>
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

/** The same tile shape, holding a sentence where an amount would be. */
function NoteStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
      <p className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{value}</p>
      <p className="text-xs text-slate-400">{hint}</p>
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
