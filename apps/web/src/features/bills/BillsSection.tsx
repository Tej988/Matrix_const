import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { createMeasurementRepository } from '@mc/shared/repositories/measurements'
import { createSettingsRepository } from '@mc/shared/repositories/settings'
import { Dates, Money, isBillable, billOutstanding } from '@mc/shared'
import type { Bill, BillStatus, Measurement, Project } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import { openPrintWindow, writeBill } from './billPdf'
import {
  BUSINESS_NOT_SET_WARNING,
  hasBusinessName,
  letterheadFor,
  useBusinessProfile,
} from '../settings/BusinessProfileForm'

const STATUS_TONE: Record<BillStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  GENERATED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  SENT: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PAID: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800',
}

export function BillsSection({ project }: { project: Project }) {
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t } = useTranslation()
  const billRepo = useMemo(() => createBillRepository(db), [])
  const measurementRepo = useMemo(() => createMeasurementRepository(db), [])
  const settingsRepo = useMemo(() => createSettingsRepository(db), [])
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const bills = useQuery({
    queryKey: ['bills', project.id],
    queryFn: () => billRepo.listForProject(project.id),
  })

  const measurements = useQuery({
    queryKey: ['measurements', project.id],
    queryFn: () => measurementRepo.listForProject(project.id),
  })

  /* Only drives the warning below. The printer reads the profile again inside
     the mutation, so what lands on paper is never a stale cache. */
  const business = useBusinessProfile()
  const letterheadMissing = business.isSuccess && !hasBusinessName(business.data)

  const billable = (measurements.data ?? []).filter(isBillable)

  const invalidateAll = () => {
    for (const key of ['bills', 'measurements', 'boq', 'project-summary']) {
      void queryClient.invalidateQueries({ queryKey: [key, project.id] })
    }
  }

  const generate = useMutation({
    mutationFn: async (chosen: Measurement[]) => {
      const [perSheet, profile] = await Promise.all([
        Promise.all(chosen.map((m) => measurementRepo.listItems(m.id))),
        settingsRepo.getBusiness(),
      ])
      const dates = chosen.map((m) => m.date).sort()
      return billRepo.generate(
        {
          project,
          measurements: chosen,
          items: perSheet.flat(),
          billDate: Dates.todayKey(),
          periodFrom: dates[0] ?? Dates.todayKey(),
          periodTo: dates.at(-1) ?? Dates.todayKey(),
          // The prefix the owner set, not a literal. A bill number is
          // permanent, so it must not depend on what was compiled in.
          numberPrefix: profile.billPrefix,
        },
        { uid: user.uid, displayName: user.displayName },
      )
    },
    onSuccess: () => {
      setError(null)
      setSelected(new Set())
      setGenerating(false)
      invalidateAll()
    },
    onError: (e) => setError((e as Error).message),
  })

  const cancel = useMutation({
    mutationFn: ({ bill, reason }: { bill: Bill; reason: string }) =>
      billRepo.cancel(bill, reason, { uid: user.uid, displayName: user.displayName }),
    onSuccess: () => {
      setError(null)
      invalidateAll()
    },
    onError: (e) => setError((e as Error).message),
  })

  const markSent = useMutation({
    mutationFn: (bill: Bill) => billRepo.markSent(bill.id, user.uid),
    onSuccess: invalidateAll,
  })

  const print = useMutation({
    // The window is claimed by the caller, synchronously in the click handler,
    // and passed in. Opening it here - after the await - would lose
    // user-activation and every browser would block it silently.
    mutationFn: async ({ bill, win }: { bill: Bill; win: Window }) => {
      // Read alongside the line items rather than from the render-time cache:
      // a letterhead corrected a minute ago must be on this bill, and the
      // round trip is free next to the one we are already making.
      const [items, profile] = await Promise.all([
        billRepo.listItems(bill.id),
        settingsRepo.getBusiness(),
      ])
      writeBill(win, bill, items, letterheadFor(profile))
    },
    onError: (e, vars) => {
      // Otherwise the claimed window sits on "Preparing…" forever.
      vars.win.close()
      setError((e as Error).message)
    },
  })

  if (!can('bill:read')) return null
  if (bills.isPending) return <p className="text-slate-500">{t('loading')}</p>
  if (bills.isError) {
    return <QueryError error={bills.error} onRetry={() => void bills.refetch()} what="bills" />
  }

  const selectedSheets = billable.filter((m) => selected.has(m.id))
  const selectedTotal =
    selectedSheets.length > 0
      ? Money.sum(selectedSheets.map((m) => m.totalAmountPaise))
      : Money.ZERO

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('billsTitle')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('countBills', { n: bills.data.length })}
            {billable.length > 0 && ` · ${t('countSheetsReady', { n: billable.length })}`}
          </p>
        </div>
        {can('bill:create') && billable.length > 0 && (
          <button
            type="button"
            onClick={() => setGenerating((v) => !v)}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {generating ? t('cancel') : t('createBill')}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {letterheadMissing && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {BUSINESS_NOT_SET_WARNING}
        </p>
      )}

      {generating && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('chooseMeasurements')}</p>
          <ul className="space-y-2">
            {billable.map((m) => (
              <li key={m.id}>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s)
                        if (e.target.checked) next.add(m.id)
                        else next.delete(m.id)
                        return next
                      })
                    }
                    className="size-5"
                  />
                  <span className="flex-1">
                    <span className="block font-medium text-slate-900 dark:text-slate-100">
                      {m.title}
                    </span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">
                      {Dates.formatDateKey(m.date)}
                    </span>
                  </span>
                  <Amount paise={m.totalAmountPaise} />
                </label>
              </li>
            ))}
          </ul>

          {selectedSheets.length > 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              {t('billTotal')}: <AmountWithWords paise={selectedTotal} />
              {project.taxProfile.mode !== 'NONE' && ` ${t('beforeTaxAndDeductions')}`}
            </p>
          )}

          <button
            type="button"
            onClick={() => generate.mutate(selectedSheets)}
            disabled={selectedSheets.length === 0 || generate.isPending}
            className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {generate.isPending
              ? t('generating')
              : t('generateBillFor', { n: selectedSheets.length })}
          </button>
        </div>
      )}

      {bills.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">{t('noBills')}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {billable.length === 0 ? t('approveFirst') : t('readyToBill')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {bills.data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">{b.billNumber}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {Dates.formatDateKey(b.billDate)} · {b.clientName}
                  {b.cancellationReason && ` · ${b.cancellationReason}`}
                </p>
              </div>

              <div className="text-right">
                <Amount paise={b.netAmountPaise} className="font-medium" />
                {billOutstanding(b) > 0 && b.amountReceivedPaise > 0 && (
                  <p className="text-xs text-slate-500">
                    <Amount paise={billOutstanding(b)} /> {t('due')}
                  </p>
                )}
              </div>

              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[b.status]}`}
              >
                {b.status.replace('_', ' ').toLowerCase()}
              </span>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const win = openPrintWindow()
                    if (!win) {
                      setError(t('popupBlocked'))
                      return
                    }
                    print.mutate({ bill: b, win })
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                >
                  {t('print')}
                </button>
                {b.status === 'GENERATED' && can('bill:create') && (
                  <button
                    type="button"
                    onClick={() => markSent.mutate(b)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                  >
                    {t('markSent')}
                  </button>
                )}
                {can('bill:cancel') && b.status !== 'CANCELLED' && b.amountReceivedPaise === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const reason = window.prompt(t('whyCancelBill'))
                      if (reason) cancel.mutate({ bill: b, reason })
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400"
                  >
                    {t('cancel')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
