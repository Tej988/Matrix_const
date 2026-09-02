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
  type LabourLedger,
} from '@mc/shared'
import { PAYMENT_METHODS, type DateKey, type PaymentMethod, type Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { useTranslation } from '../../i18n/useTranslation'
import { Amount, AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'

/**
 * Wages and labour payments. Sections 14 and 15.
 *
 * Every figure on this page comes from `calculateWage` and `labourLedger` -
 * deterministic functions over attendance records. Section 51 forbids anything
 * else computing them, advance recovery included.
 */

/** What the pay form was opened for. `due` is a suggested amount, not a limit. */
interface PayTarget {
  labourId: string
  name: string
  due: Paise
  isAdvance: boolean
}

export function WagesPage() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState(Dates.currentPeriod() as string)
  const [paying, setPaying] = useState<PayTarget | null>(null)
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
      isAdvance: boolean
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
            // An advance and a wage payment of the same amount, to the same
            // person, on the same day are two real payments. Without this they
            // would hash alike and the second would be rejected as a duplicate.
            reference: input.isAdvance ? `ADVANCE ${input.reference}` : input.reference,
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

  if (projects.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (projects.isError) {
    return (
      <QueryError
        error={projects.error}
        onRetry={() => void projects.refetch()}
        what={t('projectsTitle')}
      />
    )
  }

  const rows = (roster.data ?? []).map((a) => {
    const records = (attendance.data ?? []).filter((r) => r.labourId === a.labourId)
    const wage = calculateWage(records)
    const paid = (payments.data ?? []).filter(
      (p) => p.labourId === a.labourId && p.status === 'CONFIRMED',
    )
    const ledger = labourLedger(
      [wage.earnedAmountPaise],
      paid.map((p) => ({ amountPaise: p.amountPaise, isAdvance: p.isAdvance === true })),
    )
    return { assignment: a, wage, ledger }
  })

  const totals = {
    earned: rows.length ? Money.sum(rows.map((r) => r.ledger.earnedPaise)) : Money.ZERO,
    paid: rows.length ? Money.sum(rows.map((r) => r.ledger.paidPaise)) : Money.ZERO,
    advance: rows.length
      ? Money.sum(rows.map((r) => r.ledger.advanceOutstandingPaise))
      : Money.ZERO,
    payable: rows.length ? Money.sum(rows.map((r) => r.ledger.netPayablePaise)) : Money.ZERO,
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('wagesTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {Dates.formatPeriod(period as ReturnType<typeof Dates.currentPeriod>)}
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('project')}</span>
          <select
            value={activeProjectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputClass}
          >
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('month')}</span>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {(roster.isPending || attendance.isPending) && (
        <p className="text-slate-500">{t('loading')}</p>
      )}

      {rows.length === 0 && !roster.isPending && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">{t('noLabourAssigned')}</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="p-3">{t('name')}</th>
                  <th className="p-3 text-right">{t('days')}</th>
                  <th className="p-3 text-right">{t('rate')}</th>
                  <th className="p-3 text-right">{t('earned')}</th>
                  <th className="p-3 text-right">{t('paid')}</th>
                  <th className="p-3 text-right">{t('advance')}</th>
                  <th className="p-3 text-right">{t('netPayable')}</th>
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
                      <span className="ml-1 text-xs whitespace-nowrap text-slate-400">
                        {wage.presentDays} {t('present')}
                        {wage.halfDays > 0 && `, ${wage.halfDays} ${t('halfDay')}`}
                        {wage.absentDays > 0 && `, ${wage.absentDays} ${t('absent')}`}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Amount paise={assignment.dailyRatePaise} />
                      {wage.mixedRates && (
                        <span className="ml-1 text-xs text-amber-600">{t('mixed')}</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Amount paise={ledger.earnedPaise} />
                    </td>
                    <td className="p-3 text-right text-slate-500">
                      <Amount paise={ledger.paidPaise} />
                    </td>
                    <AdvanceCell ledger={ledger} />
                    <td className="p-3 text-right font-medium">
                      <Amount paise={ledger.netPayablePaise} signed />
                      {ledger.isAdvance && ledger.advanceOutstandingPaise === 0 && (
                        <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">
                          {t('advance')}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        {ledger.netPayablePaise > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPaying({
                                labourId: assignment.labourId,
                                name: assignment.labourName,
                                due: ledger.netPayablePaise,
                                isAdvance: false,
                              })
                            }
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                          >
                            {t('pay')}
                          </button>
                        )}
                        {/* Offered whatever the payable says - nothing owed yet
                            is exactly the situation an advance is for. */}
                        <button
                          type="button"
                          onClick={() =>
                            setPaying({
                              labourId: assignment.labourId,
                              name: assignment.labourName,
                              due: Money.ZERO,
                              isAdvance: true,
                            })
                          }
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium whitespace-nowrap text-slate-700 dark:border-slate-600 dark:text-slate-200"
                        >
                          {t('payAdvance')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                <tr className="font-medium text-slate-900 dark:text-slate-100">
                  <td className="p-3" colSpan={3}>
                    {t('total')}
                  </td>
                  <td className="p-3 text-right">
                    <Amount paise={totals.earned} />
                  </td>
                  <td className="p-3 text-right">
                    <Amount paise={totals.paid} />
                  </td>
                  <td className="p-3 text-right">
                    <Amount paise={totals.advance} />
                  </td>
                  <td className="p-3 text-right">
                    <Amount paise={totals.payable} signed />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">{t('deterministicNote')}</p>
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
              isAdvance: paying.isAdvance,
            })
          }
          pending={pay.isPending}
        />
      )}
    </div>
  )
}

/**
 * An outstanding advance is money the business is owed back. It gets its own
 * column instead of being folded into a negative payable, where the minus sign
 * is the only thing distinguishing it from an ordinary balance.
 */
function AdvanceCell({ ledger }: { ledger: LabourLedger }) {
  const { t } = useTranslation()

  if (ledger.advanceOutstandingPaise > 0) {
    return (
      <td className="p-3 text-right">
        <Amount
          paise={ledger.advanceOutstandingPaise}
          className="text-blue-700 dark:text-blue-300"
        />
        <span className="block text-xs text-blue-600 dark:text-blue-400">
          {t('advanceOutstanding')}
        </span>
      </td>
    )
  }

  if (ledger.advanceRecoveredPaise > 0) {
    return (
      <td className="p-3 text-right text-slate-500">
        <Amount paise={ledger.advanceRecoveredPaise} />
        <span className="block text-xs text-slate-400">{t('advanceRecovered')}</span>
      </td>
    )
  }

  return <td className="p-3 text-right text-slate-300 dark:text-slate-600">&mdash;</td>
}

function PayForm({
  labour,
  onCancel,
  onSubmit,
  pending,
}: {
  labour: PayTarget
  onCancel: () => void
  onSubmit: (amount: Paise, method: PaymentMethod, reference: string) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  // An advance has no amount to suggest: nothing has been earned to base one on.
  const [amountInput, setAmountInput] = useState(
    labour.due > 0 ? String(Money.toRupees(labour.due)) : '',
  )
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
        {labour.isAdvance ? t('advanceTitle') : t('pay')} &mdash; {labour.name}
        {labour.due > 0 && (
          <>
            {' '}
            &mdash; <Amount paise={labour.due} /> {t('due')}
          </>
        )}
      </p>

      {labour.isAdvance && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          {t('advanceExplain')}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>{t('amount')}</span>
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('method')}</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className={inputClass}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('reference')}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('reference')}
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
          {t('cashNoReferenceWarning')}
        </p>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">{t('doesNotSendMoney')}</p>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={amount === null || amount <= 0 || pending}
          className="flex-1 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? t('preparing') : t('recordPayment')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
