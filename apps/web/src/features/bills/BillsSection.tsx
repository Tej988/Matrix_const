import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { createMeasurementRepository } from '@mc/shared/repositories/measurements'
import { Dates, Money, isBillable, billOutstanding } from '@mc/shared'
import type { Bill, BillStatus, Measurement, Project } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { openBillForPrint } from './billPdf'

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
  const billRepo = useMemo(() => createBillRepository(db), [])
  const measurementRepo = useMemo(() => createMeasurementRepository(db), [])
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

  const billable = (measurements.data ?? []).filter(isBillable)

  const invalidateAll = () => {
    for (const key of ['bills', 'measurements', 'boq', 'project-summary']) {
      void queryClient.invalidateQueries({ queryKey: [key, project.id] })
    }
  }

  const generate = useMutation({
    mutationFn: async (chosen: Measurement[]) => {
      const perSheet = await Promise.all(chosen.map((m) => measurementRepo.listItems(m.id)))
      const dates = chosen.map((m) => m.date).sort()
      return billRepo.generate(
        {
          project,
          measurements: chosen,
          items: perSheet.flat(),
          billDate: Dates.todayKey(),
          periodFrom: dates[0] ?? Dates.todayKey(),
          periodTo: dates.at(-1) ?? Dates.todayKey(),
          numberPrefix: 'MC',
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
    mutationFn: async (bill: Bill) => {
      const items = await billRepo.listItems(bill.id)
      const ok = openBillForPrint(bill, items, {
        name: 'Matrix Construction',
        addressLines: ['Agra, Uttar Pradesh'],
      })
      if (!ok) throw new Error('Your browser blocked the print window. Allow pop-ups and retry.')
    },
    onError: (e) => setError((e as Error).message),
  })

  if (!can('bill:read')) return null
  if (bills.isPending) return <p className="text-slate-500">Loading bills…</p>
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bills</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {bills.data.length} {bills.data.length === 1 ? 'bill' : 'bills'}
            {billable.length > 0 && ` · ${billable.length} approved sheet${billable.length === 1 ? '' : 's'} ready to bill`}
          </p>
        </div>
        {can('bill:create') && billable.length > 0 && (
          <button
            type="button"
            onClick={() => setGenerating((v) => !v)}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {generating ? 'Cancel' : 'Create bill'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {generating && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Choose the approved measurements to bill. Each can only be billed once.
          </p>
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
              Bill total: <AmountWithWords paise={selectedTotal} />
              {project.taxProfile.mode !== 'NONE' && ' (before tax and deductions)'}
            </p>
          )}

          <button
            type="button"
            onClick={() => generate.mutate(selectedSheets)}
            disabled={selectedSheets.length === 0 || generate.isPending}
            className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {generate.isPending
              ? 'Generating…'
              : `Generate bill for ${selectedSheets.length} sheet${selectedSheets.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {bills.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">No bills yet.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {billable.length === 0
              ? 'Approve a measurement first — only approved work can be billed.'
              : 'Approved measurements are ready to bill.'}
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
                    <Amount paise={billOutstanding(b)} /> due
                  </p>
                )}
              </div>

              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[b.status]}`}>
                {b.status.replace('_', ' ').toLowerCase()}
              </span>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => print.mutate(b)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                >
                  Print
                </button>
                {b.status === 'GENERATED' && can('bill:create') && (
                  <button
                    type="button"
                    onClick={() => markSent.mutate(b)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                  >
                    Mark sent
                  </button>
                )}
                {can('bill:cancel') && b.status !== 'CANCELLED' && b.amountReceivedPaise === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const reason = window.prompt('Why is this bill being cancelled?')
                      if (reason) cancel.mutate({ bill: b, reason })
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400"
                  >
                    Cancel
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
