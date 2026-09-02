import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import {
  Dates,
  Money,
  calculateWage,
  labourLedger,
  labourPaymentKey,
  needsDisambiguation,
} from '@mc/shared'
import { PAYMENT_METHODS, type DateKey, type PaymentMethod, type Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'

/**
 * Wages and labour payments. Sections 14 and 15.
 *
 * Every figure on this page comes from `calculateWage` and `labourLedger` -
 * deterministic functions over attendance records. Section 51 forbids anything
 * else computing them.
 */
export function WagesPage() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()

  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState(Dates.currentPeriod() as string)
  const [paying, setPaying] = useState<{ labourId: string; name: string; due: Paise } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  const activeProjectId = projectId || projects.data?.[0]?.id || ''
  const days = Dates.daysInPeriod(period as ReturnType<typeof Dates.currentPeriod>)
  const from = days[0] as DateKey
  const to = days.at(-1) as DateKey

  const roster = useQuery({
    queryKey: ['roster', activeProjectId],
    queryFn: () => labourRepo.assignmentsForProject(activeProjectId),
    enabled: activeProjectId !== '',
  })

  const attendance = useQuery({
    queryKey: ['attendance-range', activeProjectId, from, to],
    queryFn: () => attendanceRepo.forProjectInRange(activeProjectId, from, to),
    enabled: activeProjectId !== '',
  })

  const payments = useQuery({
    queryKey: ['labour-payments', activeProjectId],
    queryFn: () => paymentRepo.listLabourPayments(activeProjectId),
    enabled: activeProjectId !== '',
  })

  const pay = useMutation({
    mutationFn: (input: {
      labourId: string
      labourName: string
      amountPaise: Paise
      method: PaymentMethod
      reference: string
    }) =>
      paymentRepo.recordLabourPayment(
        {
          ...input,
          projectId: activeProjectId,
          date: Dates.todayKey(),
          idempotencyKey: labourPaymentKey({
            labourId: input.labourId,
            projectId: activeProjectId,
            amountPaise: input.amountPaise,
            date: Dates.todayKey(),
            reference: input.reference,
          }),
        },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: () => {
      setPaying(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['labour-payments', activeProjectId] })
      void queryClient.invalidateQueries({ queryKey: ['project-summary', activeProjectId] })
    },
    onError: (e) => setError((e as Error).message),
  })

  if (projects.isPending) return <p className="p-4 text-slate-500">Loading…</p>
  if (projects.isError) {
    return <QueryError error={projects.error} onRetry={() => void projects.refetch()} what="projects" />
  }

  const rows = (roster.data ?? []).map((a) => {
    const records = (attendance.data ?? []).filter((r) => r.labourId === a.labourId)
    const wage = calculateWage(records)
    const paid = (payments.data ?? []).filter(
      (p) => p.labourId === a.labourId && p.status === 'CONFIRMED',
    )
    const ledger = labourLedger([wage.earnedAmountPaise], paid.map((p) => p.amountPaise))
    return { assignment: a, wage, ledger }
  })

  const totals = {
    earned: rows.length ? Money.sum(rows.map((r) => r.ledger.earnedPaise)) : Money.ZERO,
    paid: rows.length ? Money.sum(rows.map((r) => r.ledger.paidPaise)) : Money.ZERO,
    payable: rows.length ? Money.sum(rows.map((r) => r.ledger.payablePaise)) : Money.ZERO,
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Wages</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {Dates.formatPeriod(period as ReturnType<typeof Dates.currentPeriod>)}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Project</span>
          <select value={activeProjectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Month</span>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {(roster.isPending || attendance.isPending) && <p className="text-slate-500">Loading…</p>}

      {rows.length === 0 && !roster.isPending && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">No labour assigned to this project.</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3 text-right">Days</th>
                  <th className="p-3 text-right">Rate</th>
                  <th className="p-3 text-right">Earned</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Payable</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {rows.map(({ assignment, wage, ledger }) => (
                  <tr key={assignment.id}>
                    <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                      {assignment.labourName}
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {wage.payableDays}
                      <span className="ml-1 text-xs text-slate-400">
                        {wage.presentDays}P
                        {wage.halfDays > 0 && ` ${wage.halfDays}½`}
                        {wage.absentDays > 0 && ` ${wage.absentDays}A`}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Amount paise={assignment.dailyRatePaise} />
                      {wage.mixedRates && <span className="ml-1 text-xs text-amber-600">mixed</span>}
                    </td>
                    <td className="p-3 text-right">
                      <Amount paise={ledger.earnedPaise} />
                    </td>
                    <td className="p-3 text-right text-slate-500">
                      <Amount paise={ledger.paidPaise} />
                    </td>
                    <td className="p-3 text-right font-medium">
                      <Amount paise={ledger.payablePaise} signed />
                      {ledger.isAdvance && (
                        <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">advance</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {ledger.payablePaise > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPaying({
                              labourId: assignment.labourId,
                              name: assignment.labourName,
                              due: ledger.payablePaise,
                            })
                          }
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                        >
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                <tr className="font-medium text-slate-900 dark:text-slate-100">
                  <td className="p-3" colSpan={3}>
                    Total
                  </td>
                  <td className="p-3 text-right"><Amount paise={totals.earned} /></td>
                  <td className="p-3 text-right"><Amount paise={totals.paid} /></td>
                  <td className="p-3 text-right"><Amount paise={totals.payable} signed /></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Every figure here is computed from attendance records by a deterministic function.
            Nothing on this page is estimated.
          </p>
        </>
      )}

      {paying && (
        <PayForm
          labour={paying}
          onCancel={() => setPaying(null)}
          onSubmit={(amountPaise, method, reference) =>
            pay.mutate({
              labourId: paying.labourId,
              labourName: paying.name,
              amountPaise,
              method,
              reference,
            })
          }
          pending={pay.isPending}
        />
      )}
    </div>
  )
}

function PayForm({
  labour,
  onCancel,
  onSubmit,
  pending,
}: {
  labour: { name: string; due: Paise }
  onCancel: () => void
  onSubmit: (amount: Paise, method: PaymentMethod, reference: string) => void
  pending: boolean
}) {
  const [amountInput, setAmountInput] = useState(String(labour.due / 100))
  const [method, setMethod] = useState<PaymentMethod>('PHONEPE')
  const [reference, setReference] = useState('')

  let amount: Paise | null = null
  try {
    amount = amountInput.trim() ? Money.parseRupees(amountInput) : null
  } catch {
    amount = null
  }

  // A cash payment with no reference cannot be distinguished from a duplicate
  // of itself later, so we ask for confirmation rather than guessing.
  const ambiguous = needsDisambiguation(reference) && method === 'CASH'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (amount) onSubmit(amount, method, reference)
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">
        Pay {labour.name} &mdash; <Amount paise={labour.due} /> due
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Amount</span>
          <input value={amountInput} onChange={(e) => setAmountInput(e.target.value)} inputMode="decimal" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputClass}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Reference</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === 'PHONEPE' ? 'PhonePe txn ID' : 'Reference'}
            className={inputClass}
          />
        </label>
      </div>

      {amount !== null && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          <AmountWithWords paise={amount} />
        </p>
      )}

      {ambiguous && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          A cash payment with no reference cannot be told apart from a repeat of itself later.
          Add a note or receipt number if you can.
        </p>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        This records a payment you have already made. It does not send money.
      </p>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={amount === null || amount <= 0 || pending}
          className="flex-1 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? 'Recording…' : 'Record payment'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600">
          Cancel
        </button>
      </div>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
