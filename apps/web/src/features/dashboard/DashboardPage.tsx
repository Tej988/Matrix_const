import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import { createMeasurementRepository } from '@mc/shared/repositories/measurements'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { Dates, Money, billOutstanding, summariseDay } from '@mc/shared'
import type { Paise, Project, ProjectSummary } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'
import { PaymentsChart, bucketByMonth } from './PaymentsChart'
import {
  IconAttendance,
  IconBill,
  IconReceived,
  IconWages,
  IconProject,
  IconAlert,
  IconMeasurement,
} from '../../components/icons'

/**
 * The dashboard. Spec §38.
 *
 * Two design rules drive the layout:
 *
 *   1. Lead with what needs a decision today, not with totals. A number that
 *      is merely large tells the owner nothing; "attendance not marked at Tata
 *      Project" tells him what to do next.
 *   2. Read summary documents, never raw collections, for the money figures
 *      (R-10). Today's attendance is the one live query, and it is bounded to
 *      active projects.
 *
 * Role-aware throughout: a supervisor's dashboard is about attendance, because
 * they cannot see money at all.
 */
export function DashboardPage() {
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t } = useTranslation()
  const today = Dates.todayKey()
  const showMoney = can('financials:view')

  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const billRepo = useMemo(() => createBillRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])
  const measurementRepo = useMemo(() => createMeasurementRepository(db), [])
  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  const active = (projects.data ?? []).filter(
    (p) => p.status === 'ACTIVE' || p.status === 'PLANNING',
  )

  /** One summary read per active project - the whole point of the summary doc. */
  const summaries = useQuery({
    queryKey: ['dashboard-summaries', active.map((p) => p.id).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(
        active.map(async (p) => [p.id, await projectRepo.getSummary(p.id)] as const),
      )
      return new Map(rows)
    },
    enabled: showMoney && active.length > 0,
  })

  /** Today's attendance across active sites, plus each roster to know if it is complete. */
  const attendanceToday = useQuery({
    queryKey: ['dashboard-attendance', today, active.map((p) => p.id).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(
        active.map(async (p) => {
          const [roster, marks] = await Promise.all([
            labourRepo.assignmentsForProject(p.id),
            attendanceRepo.forProjectAndDate(p.id, today),
          ])
          return [
            p.id,
            summariseDay(
              roster.map((a) => ({ id: a.labourId })),
              marks,
            ),
          ] as const
        }),
      )
      return new Map(rows)
    },
    enabled: active.length > 0,
  })

  /* All bills, not just unpaid - the chart needs the full history, and
     filtering here rather than in a second query keeps the read count flat. */
  const bills = useQuery({
    queryKey: ['dashboard-bills', active.map((p) => p.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(active.map((p) => billRepo.listForProject(p.id)))
      return all.flat().filter((b) => b.status !== 'CANCELLED')
    },
    enabled: showMoney && active.length > 0,
  })

  const unpaidBills = (bills.data ?? []).filter((b) => billOutstanding(b) > 0)

  const payments = useQuery({
    queryKey: ['dashboard-payments', active.map((p) => p.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(active.map((p) => paymentRepo.listClientPayments(p.id)))
      return all
        .flat()
        .filter((p) => p.status === 'CONFIRMED')
        .sort((a, b) => b.date.localeCompare(a.date))
    },
    enabled: showMoney && active.length > 0,
  })

  const monthly = bucketByMonth(
    (bills.data ?? []).map((b) => ({ date: b.billDate, amountPaise: b.netAmountPaise })),
    (payments.data ?? []).map((p) => ({ date: p.date, amountPaise: p.amountPaise })),
    6,
    today,
  )

  const pendingApproval = useQuery({
    queryKey: ['dashboard-measurements', active.map((p) => p.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(active.map((p) => measurementRepo.listForProject(p.id)))
      return all.flat().filter((m) => m.status === 'SUBMITTED')
    },
    enabled: can('measurement:read') && active.length > 0,
  })

  if (projects.isPending) {
    return <p className="p-4 text-slate-500">{t('loading')}</p>
  }

  // ---- what needs a decision today ----
  const unmarked = active.filter((p) => {
    const s = attendanceToday.data?.get(p.id)
    return s && s.total > 0 && !s.complete
  })

  const attention: { key: string; Icon: typeof IconAlert; text: string; to: string }[] = []

  if (unmarked.length > 0) {
    attention.push({
      key: 'attendance',
      Icon: IconAttendance,
      text:
        unmarked.length === 1
          ? `${t('attendancePartial')} — ${unmarked[0]?.name}`
          : `${t('attendancePartial')} — ${unmarked.length} ${t('activeSites').toLowerCase()}`,
      to: '/attendance',
    })
  }
  if ((pendingApproval.data?.length ?? 0) > 0) {
    attention.push({
      key: 'measurements',
      Icon: IconMeasurement,
      text: `${pendingApproval.data?.length} ${t('measurementsAwaitingApproval').toLowerCase()}`,
      to: '/projects',
    })
  }
  if (showMoney && unpaidBills.length > 0) {
    const due = Money.sum(unpaidBills.map(billOutstanding))
    attention.push({
      key: 'bills',
      Icon: IconBill,
      text: `${unpaidBills.length} ${t('pendingBills').toLowerCase()} — ${Money.formatPaise(due)}`,
      to: '/projects',
    })
  }
  const totalPayable = showMoney
    ? Money.sum(
        [...(summaries.data?.values() ?? [])]
          .filter((s): s is ProjectSummary => s !== null)
          .map((s) => Money.max(s.labourPayablePaise, Money.ZERO)),
      )
    : Money.ZERO
  if (showMoney && totalPayable > 0) {
    attention.push({
      key: 'wages',
      Icon: IconWages,
      text: `${t('labourToPay')} — ${Money.formatPaise(totalPayable)}`,
      to: '/wages',
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('greeting')}, {user.displayName.split(' ')[0]}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {Dates.formatDateKey(today, user.locale)}
        </p>
      </header>

      {/* 1. What needs a decision. Above every total, deliberately. */}
      {attention.length > 0 && (
        <section>
          <h2 className={sectionHeading}>{t('needsAttention')}</h2>
          <ul className="divide-y divide-amber-200 overflow-hidden rounded-xl border border-amber-300 bg-amber-50 dark:divide-amber-900 dark:border-amber-800 dark:bg-amber-950">
            {attention.map((a) => (
              <li key={a.key}>
                <Link
                  to={a.to}
                  className="flex items-center gap-3 p-4 text-amber-900 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                >
                  <a.Icon className="size-5 shrink-0" />
                  <span className="flex-1 text-sm font-medium">{a.text}</span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. Money across the business - owner, admin, accountant, viewer. */}
      {showMoney && summaries.data && (
        <section>
          <h2 className={sectionHeading}>{t('acrossProjects')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              Icon={IconProject}
              label={t('contractValue')}
              paise={sumField(summaries.data, 'contractValuePaise')}
            />
            <Tile
              Icon={IconBill}
              label={t('billed')}
              paise={sumField(summaries.data, 'totalBilledPaise')}
            />
            <Tile
              Icon={IconReceived}
              label={t('received')}
              paise={sumField(summaries.data, 'totalReceivedPaise')}
            />
            <Tile
              Icon={IconAlert}
              label={t('receivable')}
              paise={sumField(summaries.data, 'receivablePaise')}
              emphasis
            />
          </div>
        </section>
      )}

      {/* 3. The money rhythm. Received is the story; billed is context. */}
      {showMoney && (
        <section>
          <h2 className={sectionHeading}>
            {t('received')} · {t('billed')}
          </h2>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <PaymentsChart data={monthly} />
          </div>
        </section>
      )}

      {/* 4. Current working area. */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className={sectionHeading}>{t('activeSites')}</h2>
          <Link
            to="/projects"
            className="text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            {t('viewAll')}
          </Link>
        </div>

        {active.length === 0 ? (
          <EmptyCard text={t('noActiveProjects')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {active.map((p) => (
              <li key={p.id}>
                <SiteCard
                  project={p}
                  summary={summaries.data?.get(p.id) ?? null}
                  attendance={attendanceToday.data?.get(p.id)}
                  showMoney={showMoney}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Recent money in, and what is still owed. */}
      {showMoney && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className={sectionHeading}>{t('recentPayments')}</h2>
            {(payments.data?.length ?? 0) === 0 ? (
              <EmptyCard text={t('noPaymentsYet')} />
            ) : (
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {payments.data?.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 tabular-nums dark:text-slate-100">
                        <Amount paise={p.amountPaise} />
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {Dates.formatDateKey(p.date, user.locale)} · {p.method.toLowerCase()}
                      </p>
                    </div>
                    <IconReceived className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className={sectionHeading}>{t('pendingBills')}</h2>
            {unpaidBills.length === 0 ? (
              <EmptyCard text={t('noPendingBills')} />
            ) : (
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {unpaidBills.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {b.billNumber}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {b.clientName} · {Dates.formatDateKey(b.billDate, user.locale)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-slate-900 tabular-nums dark:text-slate-100">
                      <Amount paise={billOutstanding(b)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function sumField(
  summaries: Map<string, ProjectSummary | null>,
  field: keyof ProjectSummary,
): Paise {
  const values = [...summaries.values()]
    .filter((s): s is ProjectSummary => s !== null)
    .map((s) => s[field])
    // A project with no agreed total contributes nothing to a contract-value
    // roll-up (RISKS.md R-01). Filtered rather than left to coerce, so the
    // omission is a decision in the code and not an accident of `null + 0`.
    .filter((v): v is Paise => typeof v === 'number')
  return values.length > 0 ? Money.sum(values) : Money.ZERO
}

function SiteCard({
  project,
  summary,
  attendance,
  showMoney,
  t,
}: {
  project: Project
  summary: ProjectSummary | null
  attendance: ReturnType<typeof summariseDay> | undefined
  showMoney: boolean
  t: (k: 'present' | 'attendanceNotMarked' | 'attendanceDone' | 'receivable' | 'marked') => string
}) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500"
    >
      <p className="truncate font-medium text-slate-900 dark:text-slate-100">{project.name}</p>
      <p className="truncate text-sm text-slate-500 dark:text-slate-400">{project.clientName}</p>

      {/* Attendance is shown to every role - it is the pulse of a live site. */}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <IconAttendance className="size-4 shrink-0 text-slate-400" />
        {!attendance || attendance.total === 0 ? (
          <span className="text-slate-400">—</span>
        ) : attendance.marked === 0 ? (
          <span className="text-amber-700 dark:text-amber-400">{t('attendanceNotMarked')}</span>
        ) : (
          <span className="text-slate-600 dark:text-slate-300">
            {attendance.present + attendance.halfDay} / {attendance.total} {t('present')}
            {!attendance.complete && ' ·'}
            {!attendance.complete && (
              <span className="ml-1 text-amber-700 dark:text-amber-400">
                {attendance.total - attendance.marked} {t('marked')}?
              </span>
            )}
          </span>
        )}
      </div>

      {showMoney && summary && (
        <div className="mt-2 flex items-baseline justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">{t('receivable')}</span>
          <Amount paise={summary.receivablePaise} className="font-medium" />
        </div>
      )}
    </Link>
  )
}

function Tile({
  Icon,
  label,
  paise,
  emphasis = false,
}: {
  Icon: typeof IconAlert
  label: string
  paise: Paise
  emphasis?: boolean
}) {
  return (
    <div
      className={[
        'rounded-xl border p-4',
        emphasis
          ? 'border-slate-900 dark:border-slate-100'
          : 'border-slate-200 dark:border-slate-700',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Icon className="size-4" />
        <p className="text-xs tracking-wide uppercase">{label}</p>
      </div>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        <Amount paise={paise} />
      </p>
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
      {text}
    </div>
  )
}

const sectionHeading = 'mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase'
