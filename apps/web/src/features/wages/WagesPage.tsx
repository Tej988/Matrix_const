import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createPaymentRepository, type LabourPaymentRecord } from '@mc/shared/repositories/payments'
import { createUserRepository, type UserRecord } from '@mc/shared/repositories/users'
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
import { ProofUpload, type ProofResult } from '../../components/ProofUpload'
import { QueryError } from '../../components/QueryError'

/**
 * Wages and labour payments. Sections 14 and 15.
 *
 * Every figure on this page comes from `calculateWage` and `labourLedger` -
 * deterministic functions over attendance records. Section 51 forbids anything
 * else computing them, advance recovery included.
 *
 * This is now the PAYROLL TABLE: one project, one month, everybody at once -
 * the view for paying a site out at month end. It is off the nav, because
 * "what has Ramesh earned and what has he been paid" is one question about one
 * person and it belongs on that person's page (`LabourDetailPage`), which is
 * where every row here links. The route stays; the table has no equivalent
 * anywhere else, and neither does the total line at the bottom.
 *
 * `PayForm` is exported and shared with the labour detail page. Two copies of a
 * form that decides what counts as an advance is two copies that disagree.
 */

/**
 * What the pay form was opened for.
 *
 * `payable` is a suggestion, not a limit, and it is routinely zero or negative:
 * before any attendance is marked nothing is earned, and "nothing owed yet" is
 * precisely the situation an advance exists for. An earlier version only
 * offered Pay when payable was positive, which meant a fresh project had no way
 * to record a payment at all.
 */
export interface PayTarget {
  labourId: string
  name: string
  payable: Paise
}

/** Everything the pay form collects. One object, so adding a field is one edit. */
export interface PaySubmission {
  amountPaise: Paise
  method: PaymentMethod
  reference: string
  date: DateKey
  paidByUid: string
  paidByName: string
  isAdvance: boolean
  documentId: string | null
  /** A proof was chosen and did not upload. The payment still goes in. */
  proofFailed: boolean
}

export function WagesPage() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])
  const userRepo = useMemo(() => createUserRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState(Dates.currentPeriod() as string)
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** A payment that saved while its proof did not - ADR-009's retry path. */
  const [orphanedProof, setOrphanedProof] = useState<{ paymentId: string; name: string } | null>(
    null,
  )

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  // Shares the cache key with the users screen - the list is small and changes
  // about once a month.
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => userRepo.list(),
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
    mutationFn: (input: PaySubmission & { labourId: string; labourName: string }) =>
      paymentRepo.recordLabourPayment(
        {
          labourId: input.labourId,
          labourName: input.labourName,
          projectId: activeProjectId,
          amountPaise: input.amountPaise,
          date: input.date,
          method: input.method,
          reference: input.reference,
          isAdvance: input.isAdvance,
          paidByUid: input.paidByUid,
          paidByName: input.paidByName,
          // Absent rather than null: exactOptionalPropertyTypes, and Firestore
          // would otherwise store a null nobody wants to read back.
          ...(input.documentId ? { documentId: input.documentId } : {}),
          idempotencyKey: labourPaymentKey({
            labourId: input.labourId,
            projectId: activeProjectId,
            amountPaise: input.amountPaise,
            date: input.date,
            // An advance and a wage payment of the same amount, to the same
            // person, on the same day are two real payments. Without this they
            // would hash alike and the second would be rejected as a duplicate.
            reference: input.isAdvance ? `ADVANCE ${input.reference}` : input.reference,
          }),
        },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: (paymentId, input) => {
      setPaying(null)
      setError(null)
      /*
       * The money is in. If the photo did not make it, that is a separate,
       * smaller problem and it gets its own separate retry - it does not undo
       * anything and it does not reopen the pay form. ADR-009.
       */
      setOrphanedProof(input.proofFailed ? { paymentId, name: input.labourName } : null)
      void queryClient.invalidateQueries({ queryKey: ['labour-payments', activeProjectId] })
      void queryClient.invalidateQueries({ queryKey: ['project-summary', activeProjectId] })
    },
    onError: (e) => setError((e as Error).message),
  })

  /** Catches a proof up to a payment that is already recorded. Touches no figures. */
  const attachProof = useMutation({
    mutationFn: (input: { paymentId: string; documentId: string }) =>
      paymentRepo.attachDocumentToLabourPayment(
        { ...input, projectId: activeProjectId },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: () => {
      setOrphanedProof(null)
      void queryClient.invalidateQueries({ queryKey: ['labour-payments', activeProjectId] })
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
    // Newest first, matching the query's ordering.
    const advances = paid.filter((p) => p.isAdvance === true)
    return { assignment: a, wage, ledger, advances }
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
                {rows.map(({ assignment, wage, ledger, advances }) => (
                  <tr key={assignment.id}>
                    <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                      {/* The row is a summary; the person is the whole story.
                          One tap from a figure that looks wrong to the
                          attendance and payments behind it. */}
                      <Link
                        to={`/labour/${assignment.labourId}`}
                        className="flex min-h-11 items-center hover:underline"
                      >
                        {assignment.labourName}
                      </Link>
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
                    <AdvanceCell ledger={ledger} advances={advances} />
                    <td className="p-3 text-right font-medium">
                      <Amount paise={ledger.netPayablePaise} signed />
                      {ledger.isAdvance && ledger.advanceOutstandingPaise === 0 && (
                        <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">
                          {t('advance')}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {/* One button, always. Two - Pay and Pay advance - made
                          the user classify the payment before they had typed an
                          amount, and hid Pay entirely when nothing was owed yet.
                          The form works out which it is from the amount, and
                          shows a toggle for the times it guesses wrong
                          (section 28: the primary user is not an engineer). */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setPaying({
                              labourId: assignment.labourId,
                              name: assignment.labourName,
                              payable: ledger.netPayablePaise,
                            })
                          }
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                        >
                          {t('pay')}
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

      {orphanedProof && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
        >
          <p className="text-sm text-amber-900 dark:text-amber-200">
            Payment saved for {orphanedProof.name}. The proof did not upload — the money is recorded
            either way. Attach it here when you can.
          </p>
          <ProofUpload
            projectId={activeProjectId}
            linkedRefType="labourPayment"
            linkedRefId={orphanedProof.paymentId}
            onChange={(result: ProofResult) => {
              if (result.documentId) {
                attachProof.mutate({
                  paymentId: orphanedProof.paymentId,
                  documentId: result.documentId,
                })
              }
            }}
          />
          <button
            type="button"
            onClick={() => setOrphanedProof(null)}
            className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-600 dark:text-amber-200"
          >
            {t('close')}
          </button>
        </div>
      )}

      {paying && (
        <PayForm
          labour={paying}
          projectId={activeProjectId}
          users={users.data ?? []}
          currentUser={user}
          onCancel={() => setPaying(null)}
          onSubmit={(submission) =>
            pay.mutate({
              ...submission,
              labourId: paying.labourId,
              labourName: paying.name,
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
function AdvanceCell({
  ledger,
  advances,
}: {
  ledger: LabourLedger
  advances: readonly LabourPaymentRecord[]
}) {
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
        <AdvanceDetail advances={advances} />
      </td>
    )
  }

  if (ledger.advanceRecoveredPaise > 0) {
    return (
      <td className="p-3 text-right text-slate-500">
        <Amount paise={ledger.advanceRecoveredPaise} />
        <span className="block text-xs text-slate-400">{t('advanceRecovered')}</span>
        <AdvanceDetail advances={advances} />
      </td>
    )
  }

  return <td className="p-3 text-right text-slate-300 dark:text-slate-600">&mdash;</td>
}

/**
 * When and by whom. An advance is a private arrangement between a supervisor
 * and a worker, and "₹2,000 outstanding" with no date or name is the number
 * both of them will dispute a month later.
 *
 * `paidByName` is absent on payments recorded before the field existed; those
 * lines show the date alone rather than inventing a name.
 */
function AdvanceDetail({ advances }: { advances: readonly LabourPaymentRecord[] }) {
  const { locale } = useTranslation()

  if (advances.length === 0) return null

  return (
    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
      {advances.map((a) => (
        <span key={a.id} className="block whitespace-nowrap">
          {Dates.formatDateKey(a.date, locale)}
          {a.paidByName ? ` · ${a.paidByName}` : ''}
        </span>
      ))}
    </span>
  )
}

/**
 * The pay form. Shared with the labour detail page, which is where most
 * payments are recorded now - the rules about what counts as an advance, what a
 * failed proof does to a payment, and who is recorded as having paid live here
 * once.
 *
 * `projectId` is a prop rather than page state because a payment always belongs
 * to a project: this page has one selected, and the person page picks the one
 * they are working on.
 */
export function PayForm({
  labour,
  projectId,
  users,
  currentUser,
  onCancel,
  onSubmit,
  pending,
}: {
  labour: PayTarget
  projectId: string
  users: readonly UserRecord[]
  currentUser: UserRecord
  onCancel: () => void
  onSubmit: (submission: PaySubmission) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const today = Dates.todayKey()

  // Suggest what is owed; leave it blank when nothing is, because a suggested
  // zero is a figure someone will submit by accident.
  const [amountInput, setAmountInput] = useState(
    labour.payable > 0 ? String(Money.toRupees(labour.payable)) : '',
  )
  const [method, setMethod] = useState<PaymentMethod>('PHONEPE')
  const [reference, setReference] = useState('')
  const [dateInput, setDateInput] = useState<string>(today)
  const [paidByUid, setPaidByUid] = useState(currentUser.uid)
  const [advanceOverride, setAdvanceOverride] = useState<boolean | null>(null)
  const [proof, setProof] = useState<ProofResult>({ documentId: null, failed: false })

  let amount: Paise | null = null
  try {
    amount = amountInput.trim() ? Money.parseRupees(amountInput) : null
  } catch {
    amount = null
  }

  let payDate: DateKey | null = null
  try {
    payDate = Dates.dateKey(dateInput)
  } catch {
    payDate = null
  }
  // A payment cannot have happened tomorrow. The `max` attribute covers the
  // picker; a typed date still has to be caught here.
  const futureDated = payDate !== null && payDate > today

  /*
   * Paying more than is currently owed IS an advance against future work,
   * whatever the person recording it decides to call it - so it is derived,
   * not asked. The toggle stays visible because only they know their intent:
   * a bonus, or a round figure they will square up next week.
   */
  const owed = labour.payable > 0 ? labour.payable : Money.ZERO
  const derivedAdvance = amount !== null && amount > owed
  const isAdvance = advanceOverride ?? derivedAdvance

  // A cash payment with no reference cannot be distinguished from a duplicate
  // of itself later, so we ask for confirmation rather than guessing.
  const ambiguous = needsDisambiguation(reference) && method === 'CASH'

  /* Whoever is recording this is the likeliest payer, so they are the default -
     but a supervisor paying on site and an accountant typing it up that evening
     are two different people, and the record should say which. */
  const payers = users.filter((u) => u.status === 'ACTIVE')
  const payerOptions = payers.some((u) => u.uid === currentUser.uid)
    ? payers
    : [currentUser, ...payers]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!amount || !payDate || futureDated) return
        onSubmit({
          amountPaise: amount,
          method,
          reference,
          date: payDate,
          paidByUid,
          paidByName:
            payerOptions.find((u) => u.uid === paidByUid)?.displayName ?? currentUser.displayName,
          isAdvance,
          documentId: proof.documentId,
          proofFailed: proof.failed,
        })
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">
        {isAdvance ? t('advanceTitle') : t('pay')} &mdash; {labour.name}
        {labour.payable > 0 && (
          <>
            {' '}
            &mdash; <Amount paise={labour.payable} /> {t('due')}
          </>
        )}
      </p>

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
          <span className={labelClass}>{t('date')}</span>
          <input
            type="date"
            value={dateInput}
            max={today}
            onChange={(e) => setDateInput(e.target.value)}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('paidBy')}</span>
          <select
            value={paidByUid}
            onChange={(e) => setPaidByUid(e.target.value)}
            className={inputClass}
          >
            {payerOptions.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {/* Kept alongside the photo, not replaced by it: the idempotency key
              is derived from the reference, and two identical cash payments
              with none are genuinely indistinguishable (needsDisambiguation). */}
          <span className={labelClass}>{t('reference')}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('reference')}
            className={inputClass}
          />
        </label>
      </div>

      <ProofUpload projectId={projectId} linkedRefType="labourPayment" onChange={setProof} />

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={isAdvance}
          onChange={(e) => setAdvanceOverride(e.target.checked)}
          className="h-4 w-4"
        />
        {t('payAdvance')}
      </label>

      {isAdvance && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          {t('advanceExplain')}
        </p>
      )}

      {amount !== null && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          <AmountWithWords paise={amount} />
        </p>
      )}

      {futureDated && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          A payment cannot be dated later than today.
        </p>
      )}

      {ambiguous && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t('cashNoReferenceWarning')}
        </p>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">{t('doesNotSendMoney')}</p>

      <div className="flex gap-3">
        {/* Deliberately NOT disabled while a proof is uploading or has failed.
            The attachment is evidence; the payment is the record. ADR-009. */}
        <button
          type="submit"
          disabled={amount === null || amount <= 0 || payDate === null || futureDated || pending}
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
