import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createAttendanceRepository, createLabourRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createPaymentRepository, type LabourPaymentRecord } from '@mc/shared/repositories/payments'
import { createUserRepository } from '@mc/shared/repositories/users'
import {
  createDocumentRepository,
  documentViewUrl,
  type DocumentRecord,
} from '@mc/shared/repositories/documents'
import { Dates, Money, calculateWage, labourLedger, labourPaymentKey } from '@mc/shared'
import {
  LABOUR_ROLES,
  type Labour,
  type LabourAssignment,
  type LabourRole,
  type Paise,
} from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { useTranslation } from '../../i18n/useTranslation'
import { Amount } from '../../components/Money'
import { ProofUpload, type ProofResult } from '../../components/ProofUpload'
import { QueryError } from '../../components/QueryError'
import { MonthAttendanceView } from '../attendance/MonthAttendanceView'
import { PayForm, type PaySubmission } from '../wages/WagesPage'

/**
 * One person, everything about them.
 *
 * "What has Ramesh earned and what has he been paid" is ONE question about ONE
 * man, and it used to take two screens and a mental join to answer. His month,
 * his wages, his payments, his advances and his details are all here, in that
 * order, because that is the order the owner asks them in.
 *
 * Money is never computed on this page. `calculateWage` and `labourLedger` are
 * the only things allowed to produce a figure (spec section 51) and everything
 * below simply renders what they return. Nothing here is hidden from the
 * `/wages` payroll table either - both read the same records through the same
 * two functions, so they cannot disagree.
 */
export function LabourDetailPage() {
  const { labourId = '' } = useParams()
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t, locale } = useTranslation()
  const queryClient = useQueryClient()

  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])
  const userRepo = useMemo(() => createUserRepository(db), [])
  const documentRepo = useMemo(() => createDocumentRepository(db), [])

  /*
   * A supervisor gets the roster and the register and no money at all - not a
   * masked figure, not a dash where a figure would be: the wage sections are
   * not rendered. Route access is `labour:read`; the wallet is separate.
   */
  const showMoney = can('financials:view')
  const canEdit = can('labour:write')
  const canPay = showMoney && can('labourPayment:write')

  const [periodInput, setPeriodInput] = useState(Dates.currentPeriod() as string)
  const [editing, setEditing] = useState(false)
  /** Non-null while the pay form is open; the value is the project to book it to. */
  const [payProjectId, setPayProjectId] = useState<string | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A payment that saved while its proof did not - ADR-009's retry path. */
  const [orphanedProof, setOrphanedProof] = useState<{
    paymentId: string
    projectId: string
  } | null>(null)

  // Clearing the month input yields '', which is not a period. Falling back to
  // the current month keeps a half-typed date from taking the page down.
  const period = useMemo(() => {
    try {
      return Dates.period(periodInput)
    } catch {
      return Dates.currentPeriod()
    }
  }, [periodInput])

  const days = Dates.daysInPeriod(period)
  const from = days[0] as ReturnType<typeof Dates.todayKey>
  const to = days.at(-1) as ReturnType<typeof Dates.todayKey>

  const labour = useQuery({
    queryKey: ['labour', labourId],
    queryFn: () => labourRepo.get(labourId),
  })

  const assignments = useQuery({
    queryKey: ['labour-assignments', labourId],
    queryFn: () => labourRepo.assignmentsForLabour(labourId),
  })

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  /*
   * Attendance by PERSON, not by project. Someone who spent half the month on
   * one site and half on another earned wages on both, and a per-project query
   * would quietly report half of what they are owed.
   *
   * Only fetched for roles that can see money: it feeds the wage figures and
   * nothing else, and it crosses project boundaries - which Rules would refuse
   * a supervisor anyway. Their register comes from the per-project views below.
   */
  const attendance = useQuery({
    queryKey: ['attendance-for-labour', labourId, from, to],
    queryFn: () => attendanceRepo.forLabourInRange(labourId, from, to),
    enabled: showMoney,
  })

  // Every payment ever made to them, across projects. Deliberately not
  // month-filtered: an advance handed over in March is recovered in April, and
  // a window that hides it makes the ledger lie.
  const payments = useQuery({
    queryKey: ['labour-payments-for', labourId],
    queryFn: () => paymentRepo.paymentsForLabour(labourId),
    enabled: showMoney,
  })

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => userRepo.list(),
    enabled: canPay,
  })

  // Sorted so the key is stable across renders and the cache is hit, not reset.
  const proofIds = useMemo(
    () =>
      [
        ...new Set((payments.data ?? []).flatMap((p) => (p.documentId ? [p.documentId] : []))),
      ].sort(),
    [payments.data],
  )

  const proofs = useQuery({
    queryKey: ['documents', proofIds],
    queryFn: () => documentRepo.getMany(proofIds),
    enabled: proofIds.length > 0,
  })

  const pay = useMutation({
    mutationFn: (input: PaySubmission & { projectId: string; labourName: string }) =>
      paymentRepo.recordLabourPayment(
        {
          labourId,
          labourName: input.labourName,
          projectId: input.projectId,
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
            labourId,
            projectId: input.projectId,
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
      setPayProjectId(null)
      setError(null)
      /*
       * The money is in. If the photo did not make it, that is a separate,
       * smaller problem with its own retry - it does not undo anything and it
       * does not reopen the pay form. ADR-009.
       */
      setOrphanedProof(input.proofFailed ? { paymentId, projectId: input.projectId } : null)
      void queryClient.invalidateQueries({ queryKey: ['labour-payments-for', labourId] })
      void queryClient.invalidateQueries({ queryKey: ['labour-payments', input.projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project-summary', input.projectId] })
    },
    onError: (e) => setError((e as Error).message),
  })

  /** Catches a proof up to a payment that is already recorded. Touches no figures. */
  const attachProof = useMutation({
    mutationFn: (input: { paymentId: string; documentId: string; projectId: string }) =>
      paymentRepo.attachDocumentToLabourPayment(input, {
        uid: user.uid,
        displayName: user.displayName,
      }),
    onSuccess: () => {
      setOrphanedProof(null)
      void queryClient.invalidateQueries({ queryKey: ['labour-payments-for', labourId] })
    },
    onError: (e) => setError((e as Error).message),
  })

  const save = useMutation({
    mutationFn: (patch: Partial<Omit<Labour, 'id'>>) =>
      labourRepo.update(labourId, patch, user.uid),
    onSuccess: () => {
      setEditing(false)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['labour', labourId] })
      void queryClient.invalidateQueries({ queryKey: ['labour'] })
    },
    onError: (e) => setError((e as Error).message),
  })

  const setWorking = useMutation({
    mutationFn: (working: boolean) =>
      working
        ? labourRepo.reactivate(labourId, user.uid)
        : labourRepo.deactivate(labourId, Dates.todayKey(), user.uid),
    onSuccess: () => {
      setConfirmingRemoval(false)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['labour', labourId] })
      void queryClient.invalidateQueries({ queryKey: ['labour'] })
      void queryClient.invalidateQueries({ queryKey: ['labour-assignments', labourId] })
      // Deactivating ends their assignments, so every project roster - and the
      // attendance screen built on it - is now stale.
      void queryClient.invalidateQueries({ queryKey: ['roster'] })
    },
    onError: (e) => setError((e as Error).message),
  })

  if (labour.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (labour.isError || !labour.data) {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {t('labourNotFound')}
        </p>
        <Link to="/labour" className="text-slate-600 underline dark:text-slate-300">
          ← {t('labourTitle')}
        </Link>
      </div>
    )
  }

  const person = labour.data
  const working = person.status !== 'INACTIVE'

  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id

  /*
   * Assignments are readable by anyone active, projects are not: a supervisor
   * sees only the sites they are on. Filtering by what they can actually open
   * keeps the page from naming a project by its raw id and from mounting a
   * register whose attendance query Rules will refuse.
   */
  const rosterPending = assignments.isPending || projects.isPending
  const visibleAssignments = (assignments.data ?? []).filter((a) =>
    (projects.data ?? []).some((p) => p.id === a.projectId),
  )
  const currentAssignments = visibleAssignments.filter((a) => a.status === 'ACTIVE')

  /*
   * Every figure below comes out of these two calls and nothing else. `earned`
   * is the selected month; `paid` is everything ever, which is the same shape
   * the payroll table uses - a month of work set against the running account,
   * so an advance from a previous month still shows as outstanding.
   */
  const wage = calculateWage(attendance.data ?? [])
  const confirmed = (payments.data ?? []).filter((p) => p.status === 'CONFIRMED')
  const ledger = labourLedger(
    [wage.earnedAmountPaise],
    confirmed.map((p) => ({ amountPaise: p.amountPaise, isAdvance: p.isAdvance === true })),
  )

  /* A payment belongs to a project. Their current sites are the likely answer;
     everything they could be booked against is the fallback, so somebody who
     has just come off a site can still be squared up. */
  const payProjects =
    currentAssignments.length > 0
      ? currentAssignments.map((a) => ({ id: a.projectId, name: projectName(a.projectId) }))
      : (projects.data ?? []).map((p) => ({ id: p.id, name: p.name }))

  return (
    <div className="space-y-6">
      <div>
        <Link to="/labour" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← {t('labourTitle')}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {person.name}
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          {person.role.replace('_', ' ').toLowerCase()}
          {person.phone && (
            <>
              {' · '}
              <a href={`tel:${person.phone}`} className="hover:underline">
                {person.phone}
              </a>
            </>
          )}
          {showMoney && (
            <>
              {' · '}
              <Amount paise={person.defaultDailyWagePaise} /> {t('perDay')}
            </>
          )}
        </p>
        {person.joiningDate && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('started')} {Dates.formatDateKey(person.joiningDate, locale)}
          </p>
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

      {!working && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-200">{t('formerWorkerBanner')}</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setWorking.mutate(true)}
              disabled={setWorking.isPending}
              className="min-h-11 rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50 dark:border-amber-600 dark:text-amber-200"
            >
              {t('workingAgain')}
            </button>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {t('project')}
        </h2>
        {rosterPending ? (
          <p className="text-slate-500">{t('loading')}</p>
        ) : currentAssignments.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('notOnAnySite')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
            {currentAssignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link
                  to={`/projects/${a.projectId}`}
                  className="flex min-h-11 items-center font-medium text-slate-900 hover:underline dark:text-slate-100"
                >
                  {projectName(a.projectId)}
                </Link>
                <span className="text-slate-500 dark:text-slate-400">
                  {t('started')} {Dates.formatDateKey(a.startDate, locale)}
                  {showMoney && (
                    <>
                      {' · '}
                      <Amount paise={a.dailyRatePaise} /> {t('perDay')}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <label className="block max-w-xs">
        <span className={labelClass}>{t('monthForAttendance')}</span>
        <input
          type="month"
          value={periodInput}
          onChange={(e) => setPeriodInput(e.target.value)}
          className={inputClass}
        />
      </label>

      {showMoney && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('wagesTitle')} · {Dates.formatPeriod(period, locale)}
            </h2>
            {/* The payroll table is still the right tool for paying a whole
                site out at once, so it keeps its route and a way back to it. */}
            <Link
              to="/wages"
              className="text-sm text-slate-500 underline underline-offset-2 dark:text-slate-400"
            >
              {t('wagesTitle')} →
            </Link>
          </div>

          {attendance.isPending || payments.isPending ? (
            <p className="text-slate-500">{t('loading')}</p>
          ) : (
            <>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Stat label={t('days')}>
                  <span className="tabular-nums">{wage.payableDays}</span>
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {wage.presentDays} {t('present')}
                    {wage.halfDays > 0 && `, ${wage.halfDays} ${t('halfDay')}`}
                    {wage.absentDays > 0 && `, ${wage.absentDays} ${t('absent')}`}
                  </span>
                </Stat>
                <Stat label={t('earned')}>
                  <Amount paise={ledger.earnedPaise} />
                  {wage.mixedRates && (
                    <span className="ml-2 text-xs font-normal text-amber-600">{t('mixed')}</span>
                  )}
                </Stat>
                <Stat label={t('paid')}>
                  <Amount paise={ledger.paidPaise} />
                </Stat>
                <Stat label={t('advanceOutstanding')}>
                  {ledger.advanceOutstandingPaise > 0 ? (
                    <Amount
                      paise={ledger.advanceOutstandingPaise}
                      className="text-blue-700 dark:text-blue-300"
                    />
                  ) : (
                    <span className="text-slate-400">{t('none')}</span>
                  )}
                  {ledger.advanceRecoveredPaise > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      <Amount paise={ledger.advanceRecoveredPaise} /> {t('advanceRecovered')}
                    </span>
                  )}
                </Stat>
                <Stat label={t('netPayable')}>
                  <Amount paise={ledger.netPayablePaise} signed />
                </Stat>
              </dl>

              <p className="text-xs text-slate-500 dark:text-slate-400">{t('deterministicNote')}</p>
            </>
          )}

          {canPay && payProjects.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('assignBeforePaying')}</p>
          )}

          {/* One button, always visible. Not gated on anything being owed:
              before any attendance is marked nothing is earned, and "nothing
              owed yet" is precisely the situation an advance exists for. */}
          {canPay && payProjectId === null && payProjects.length > 0 && (
            <button
              type="button"
              onClick={() => setPayProjectId(payProjects[0]?.id ?? '')}
              className="min-h-11 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {t('pay')}
            </button>
          )}

          {canPay && payProjectId !== null && (
            <div className="space-y-3">
              {payProjects.length > 1 && (
                <label className="block">
                  <span className={labelClass}>{t('project')}</span>
                  <select
                    value={payProjectId}
                    onChange={(e) => setPayProjectId(e.target.value)}
                    className={inputClass}
                  >
                    {payProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {/* The same form the payroll table uses, down to the derived
                  advance rule and the proof that cannot block a payment. */}
              <PayForm
                labour={{
                  labourId,
                  name: person.name,
                  payable: ledger.netPayablePaise,
                }}
                projectId={payProjectId}
                users={users.data ?? []}
                currentUser={user}
                onCancel={() => setPayProjectId(null)}
                onSubmit={(submission) =>
                  pay.mutate({
                    ...submission,
                    projectId: payProjectId,
                    labourName: person.name,
                  })
                }
                pending={pay.isPending}
              />
            </div>
          )}

          {orphanedProof && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
            >
              <p className="text-sm text-amber-900 dark:text-amber-200">
                {t('proofFailedFor', { name: person.name })}
              </p>
              <ProofUpload
                projectId={orphanedProof.projectId}
                linkedRefType="labourPayment"
                linkedRefId={orphanedProof.paymentId}
                onChange={(result: ProofResult) => {
                  if (result.documentId) {
                    attachProof.mutate({
                      paymentId: orphanedProof.paymentId,
                      documentId: result.documentId,
                      projectId: orphanedProof.projectId,
                    })
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setOrphanedProof(null)}
                className="min-h-11 rounded-lg border border-amber-400 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-600 dark:text-amber-200"
              >
                {t('close')}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {t('attendanceTitle')} · {Dates.formatPeriod(period, locale)}
        </h2>
        <AttendanceRegisters
          assignments={visibleAssignments}
          pending={rosterPending}
          period={period}
          locale={locale}
          projectName={projectName}
        />
      </section>

      {showMoney && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('paymentHistory')}
          </h2>
          {payments.isError ? (
            <QueryError
              error={payments.error}
              onRetry={() => void payments.refetch()}
              what={t('paymentHistory')}
            />
          ) : (
            <PaymentHistory
              payments={payments.data ?? []}
              proofs={proofs.data}
              projectName={projectName}
            />
          )}
        </section>
      )}

      {canEdit && (
        <section className="space-y-3">
          {editing ? (
            <EditLabourForm
              labour={person}
              pending={save.isPending}
              onCancel={() => setEditing(false)}
              onSave={(patch) => save.mutate(patch)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
            >
              {t('edit')}
            </button>
          )}

          {working && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              {confirmingRemoval ? (
                <>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    {t('confirmLeftExplain', { name: person.name })}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setWorking.mutate(false)}
                      disabled={setWorking.isPending}
                      className="min-h-11 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      {setWorking.isPending ? t('saving') : t('confirmLeft')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemoval(false)}
                      className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Not "delete". There is no delete: Rules deny it on labour,
                      and wage history has to stay auditable (ADR-007). The
                      label says what actually happens. */}
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoval(true)}
                    className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  >
                    {t('noLongerWithUs')}
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('noLongerWithUsHint')}
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">{t('privacyNote')}</p>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}

/**
 * The month register, one per site they have been on.
 *
 * `MonthAttendanceView` is imported rather than reimplemented - a second
 * rendering of the same grid would be a second set of glyphs to keep in step
 * with the marking screen. Passing a roster of one turns the whole-site
 * register into one person's row.
 *
 * ENDED assignments are included on purpose: someone who left a site in the
 * middle of the month still worked there, and dropping the row would hide the
 * days behind the wages above.
 */
function AttendanceRegisters({
  assignments,
  pending,
  period,
  locale,
  projectName,
}: {
  assignments: readonly LabourAssignment[]
  pending: boolean
  period: ReturnType<typeof Dates.currentPeriod>
  locale: ReturnType<typeof useTranslation>['locale']
  projectName: (id: string) => string
}) {
  const { t } = useTranslation()

  if (pending) return <p className="text-slate-500">{t('loading')}</p>
  if (assignments.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t('noAttendanceNoSite')}</p>
  }

  return (
    <div className="space-y-4">
      {assignments.map((a) => (
        <div key={a.id} className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {projectName(a.projectId)}
            {a.status === 'ENDED' && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                {a.endDate ? Dates.formatDateKey(a.endDate, locale) : t('inactive')}
              </span>
            )}
          </p>
          <MonthAttendanceView
            projectId={a.projectId}
            period={period}
            roster={[a]}
            locale={locale}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Every payment, newest first. The proof is a link when the file is still
 * there and nothing at all when it is not - under ADR-009 a payment outliving
 * its attachment is normal, not an error to report.
 */
function PaymentHistory({
  payments,
  proofs,
  projectName,
}: {
  payments: readonly LabourPaymentRecord[]
  proofs: Map<string, DocumentRecord> | undefined
  projectName: (id: string) => string
}) {
  const { t, locale } = useTranslation()

  if (payments.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t('noPaymentsYet')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
          <tr>
            <th className="p-3">{t('date')}</th>
            <th className="p-3">{t('project')}</th>
            <th className="p-3 text-right">{t('amount')}</th>
            <th className="p-3">{t('method')}</th>
            <th className="p-3">{t('paidBy')}</th>
            <th className="p-3">{t('viewProof')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {payments.map((p) => {
            const proof = p.documentId ? proofs?.get(p.documentId) : undefined
            const url = proof ? documentViewUrl(proof) : null
            return (
              <tr key={p.id}>
                <td className="p-3 whitespace-nowrap text-slate-700 dark:text-slate-200">
                  {Dates.formatDateKey(p.date, locale)}
                </td>
                <td className="p-3 text-slate-500 dark:text-slate-400">
                  {projectName(p.projectId)}
                </td>
                <td className="p-3 text-right font-medium text-slate-900 dark:text-slate-100">
                  <Amount paise={p.amountPaise} />
                  {p.isAdvance === true && (
                    <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">
                      {t('advance')}
                    </span>
                  )}
                  {/* A payment that is not CONFIRMED is not in the ledger
                      above, so it says so rather than looking like one. */}
                  {p.status !== 'CONFIRMED' && (
                    <span className="ml-2 text-xs font-normal text-amber-600">
                      {p.status.toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="p-3 text-slate-500 dark:text-slate-400">
                  {p.method.replace('_', ' ').toLowerCase()}
                </td>
                <td className="p-3 text-slate-500 dark:text-slate-400">
                  {/* Absent on payments recorded before the field existed.
                      Those show nothing rather than inventing a name. */}
                  {p.paidByName ?? '—'}
                </td>
                <td className="p-3">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center underline underline-offset-2"
                    >
                      {proof?.fileName}
                    </a>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Name, phone, work and rate. Changing the rate never restates past work -
    attendance snapshots the rate on the day it was marked (section 42). */
function EditLabourForm({
  labour,
  pending,
  onCancel,
  onSave,
}: {
  labour: Labour
  pending: boolean
  onCancel: () => void
  onSave: (patch: Partial<Omit<Labour, 'id'>>) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(labour.name)
  const [phone, setPhone] = useState(labour.phone ?? '')
  const [role, setRole] = useState<LabourRole>(labour.role)
  const [wageInput, setWageInput] = useState(String(Money.toRupees(labour.defaultDailyWagePaise)))

  let wage: Paise | null = null
  try {
    wage = wageInput.trim() ? Money.parseRupees(wageInput) : null
  } catch {
    wage = null
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!wage || name.trim() === '') return
        onSave({
          name: name.trim(),
          role,
          defaultDailyWagePaise: wage,
          // An empty string, not an absent key: the repository drops undefined,
          // so leaving the field out is how a cleared phone number silently
          // comes back on the next read.
          phone: phone.trim(),
        })
      }}
      className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700"
    >
      <label className="block">
        <span className={labelClass}>{t('name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>{`${t('phone')} (${t('optional')})`}</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{t('work')}</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as LabourRole)}
          className={inputClass}
        >
          {LABOUR_ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>{t('dailyWage')}</span>
        <input
          value={wageInput}
          onChange={(e) => setWageInput(e.target.value)}
          inputMode="decimal"
          className={inputClass}
        />
        {wage !== null && (
          <span className="mt-1 block text-sm text-slate-500">
            <Amount paise={wage} /> {t('perDay')}
          </span>
        )}
      </label>
      <p className="text-xs text-slate-500 sm:col-span-2 dark:text-slate-400">
        {t('rateVariesHint')}
      </p>
      <div className="flex gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending || wage === null || name.trim() === ''}
          className="min-h-11 flex-1 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}

const inputClass =
  'w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
