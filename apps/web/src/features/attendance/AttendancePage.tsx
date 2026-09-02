import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Dates, summariseDay, isMarkableDate, payableUnitsFor } from '@mc/shared'
import type { Attendance, AttendanceStatus, DateKey, Paise, Period } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { QueryError } from '../../components/QueryError'
import { describeFirestoreError } from '../../lib/firestoreErrors'
import { useTranslation } from '../../i18n/useTranslation'
import { MonthAttendanceView, monthRangeKey } from './MonthAttendanceView'

/*
 * Single-glyph buttons rather than words: they stay identical in both
 * languages, fit a 44px target on the narrowest phone, and a supervisor learns
 * four symbols once. The accessible label is translated.
 */
const OPTIONS: {
  status: AttendanceStatus
  glyph: string
  labelKey: 'present' | 'halfDay' | 'absent' | 'leave'
  tone: string
}[] = [
  { status: 'PRESENT', glyph: 'P', labelKey: 'present', tone: 'bg-green-600 text-white' },
  { status: 'HALF_DAY', glyph: '½', labelKey: 'halfDay', tone: 'bg-amber-500 text-white' },
  { status: 'ABSENT', glyph: 'A', labelKey: 'absent', tone: 'bg-red-600 text-white' },
  { status: 'LEAVE', glyph: 'L', labelKey: 'leave', tone: 'bg-slate-500 text-white' },
]

type ViewMode = 'DAY' | 'MONTH'

/** Nothing has been worked tomorrow, so no control may land past today. */
function clampToToday(key: DateKey, today: DateKey): DateKey {
  return isMarkableDate(key, today) ? key : today
}

/**
 * Steps a whole month, keeping the day of the month where the target has one.
 *
 * Stepping back from 31-Mar lands on 28-Feb rather than an impossible date, and
 * stepping forward is still clamped: the current month is only partly in the
 * past.
 */
function shiftMonth(key: DateKey, months: -1 | 1, today: DateKey): DateKey {
  const days = Dates.daysInPeriod(Dates.periodOf(key))
  const edge = (months < 0 ? days[0] : days.at(-1)) as DateKey
  const target = Dates.daysInPeriod(Dates.periodOf(Dates.addDays(edge, months)))
  const sameDay = target[Number(key.slice(8, 10)) - 1] ?? (target.at(-1) as DateKey)
  return clampToToday(sameDay, today)
}

/** Replaces a labourer's mark for the day, or adds it. IDs are deterministic. */
function upsert(list: readonly Attendance[], record: Attendance): Attendance[] {
  const at = list.findIndex((r) => r.id === record.id)
  if (at === -1) return [...list, record]
  const next = [...list]
  next[at] = record
  return next
}

/** Firestore's "no connection" code. The write is queued, not lost. */
function isOfflineFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'unavailable'
  )
}

/**
 * Daily attendance. Section 12 wants this to be extremely fast, and section 13
 * wants it to work with no internet.
 *
 * Both are why marking is a plain write on a deterministic ID rather than a
 * transaction (R-02, ADR-006): Firestore queues it locally and replays it on
 * reconnect, and a replay overwrites the same document instead of duplicating.
 * The tick appears immediately - the supervisor is not kept waiting on a
 * network round-trip they may not have.
 */
export function AttendancePage() {
  const user = useCurrentUser()
  const online = useOnlineStatus()
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [date, setDate] = useState(Dates.todayKey() as string)
  const [view, setView] = useState<ViewMode>('DAY')
  const [markError, setMarkError] = useState<unknown>(null)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  const activeProjectId = projectId || projects.data?.[0]?.id || ''
  const dateKey = date as DateKey
  const today = Dates.todayKey()
  const period = Dates.periodOf(dateKey)

  const roster = useQuery({
    queryKey: ['roster', activeProjectId],
    queryFn: () => labourRepo.assignmentsForProject(activeProjectId),
    enabled: activeProjectId !== '',
  })

  const marks = useQuery({
    queryKey: ['attendance', activeProjectId, dateKey],
    queryFn: () => attendanceRepo.forProjectAndDate(activeProjectId, dateKey),
    enabled: activeProjectId !== '' && view === 'DAY',
  })

  const markable = isMarkableDate(dateKey, today)
  const atLatest =
    view === 'MONTH'
      ? period >= Dates.periodOf(today)
      : !isMarkableDate(Dates.addDays(dateKey, 1), today)

  function step(direction: -1 | 1) {
    setDate(
      view === 'MONTH'
        ? shiftMonth(dateKey, direction, today)
        : clampToToday(Dates.addDays(dateKey, direction), today),
    )
  }

  function mark(
    labour: { id: string; name: string; dailyRatePaise: Paise },
    status: AttendanceStatus,
  ) {
    const dayKey = ['attendance', activeProjectId, dateKey]
    const monthDays = Dates.daysInPeriod(period)
    const rangeKey = monthRangeKey(
      activeProjectId,
      monthDays[0] as DateKey,
      monthDays.at(-1) as DateKey,
    )

    // The write is queued locally whether or not there is a connection, so
    // nothing below waits on it.
    const { id, committed } = attendanceRepo.mark(
      {
        projectId: activeProjectId,
        labour: { id: labour.id, name: labour.name },
        dateKey,
        status,
        dailyRatePaise: labour.dailyRatePaise,
      },
      user.uid,
    )

    const record: Attendance = {
      id,
      projectId: activeProjectId,
      labourId: labour.id,
      labourName: labour.name,
      dateKey,
      status,
      dailyRatePaise: labour.dailyRatePaise,
      payableUnits: payableUnitsFor(status),
      markedBy: user.uid,
      syncSource: 'ONLINE',
    }

    const previousDay = queryClient.getQueryData<Attendance[]>(dayKey)
    const previousRange = queryClient.getQueryData<Attendance[]>(rangeKey)

    /*
     * The cache is written directly instead of being invalidated. Invalidating
     * put a Firestore round-trip between the tap and the tick - seconds of it
     * on a site connection - and spent a read to be told what we already knew.
     * An in-flight read is cancelled first, or it would land afterwards and
     * clobber the mark.
     */
    void queryClient.cancelQueries({ queryKey: dayKey })
    queryClient.setQueryData<Attendance[]>(dayKey, (list) => upsert(list ?? [], record))

    // Only patch the month register if it is already loaded. Seeding it from a
    // single mark would leave the grid claiming the rest of the month is blank.
    if (previousRange) {
      queryClient.setQueryData<Attendance[]>(rangeKey, (list) => upsert(list ?? [], record))
    }

    setMarkError(null)

    committed.catch((error: unknown) => {
      // Offline the write sits in Firestore's queue and syncs on reconnect.
      // Rolling back there would look like the mark was lost, which is exactly
      // what section 13 forbids.
      if (!online || isOfflineFailure(error)) return

      queryClient.setQueryData<Attendance[]>(dayKey, previousDay ?? [])
      if (previousRange) queryClient.setQueryData<Attendance[]>(rangeKey, previousRange)
      setMarkError(error)
    })
  }

  if (projects.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (projects.isError) {
    return (
      <QueryError error={projects.error} onRetry={() => void projects.refetch()} what="projects" />
    )
  }

  if (projects.data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
        <p className="text-slate-600 dark:text-slate-300">{t('notAssignedToProject')}</p>
      </div>
    )
  }

  const statusOf = (labourId: string): AttendanceStatus | undefined =>
    marks.data?.find((m) => m.labourId === labourId)?.status

  const summary = summariseDay(
    (roster.data ?? []).map((a) => ({ id: a.labourId })),
    marks.data ?? [],
  )

  const markProblem = markError === null ? null : describeFirestoreError(markError)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('attendanceTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {view === 'MONTH'
            ? Dates.formatPeriod(period, user.locale)
            : Dates.formatDateKey(dateKey, user.locale)}
          {view === 'DAY' && roster.data && ` · ${summary.marked}/${summary.total} ${t('marked')}`}
        </p>
      </header>

      {!online && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>{t('offlineTitle')}</strong> {t('offlineBody')}
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
          <span className={labelClass}>{view === 'MONTH' ? t('month') : t('date')}</span>
          {view === 'MONTH' ? (
            <input
              type="month"
              value={period}
              max={Dates.periodOf(today)}
              onChange={(e) => {
                // An empty value is the picker being cleared, not a month.
                if (!e.target.value) return
                const first = Dates.daysInPeriod(e.target.value as Period)[0] as DateKey
                setDate(clampToToday(first, today))
              }}
              className={inputClass}
            />
          ) : (
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value)
              }}
              className={inputClass}
            />
          )}
        </label>
      </div>

      {/*
       * Stepping is the common move - "yesterday", "the month before" - and a
       * date picker makes it four taps. These make it one.
       */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => step(-1)} className={navClass}>
          ‹ {t('back')}
        </button>
        <button type="button" onClick={() => setDate(today)} className={navClass}>
          {t('today')}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={atLatest}
          className={`${navClass} disabled:opacity-40`}
        >
          {t('next')} ›
        </button>

        <div
          role="group"
          className="ml-auto flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600"
        >
          <button
            type="button"
            onClick={() => setView('DAY')}
            aria-pressed={view === 'DAY'}
            className={view === 'DAY' ? toggleOnClass : toggleOffClass}
          >
            Day
          </button>
          <button
            type="button"
            onClick={() => setView('MONTH')}
            aria-pressed={view === 'MONTH'}
            className={view === 'MONTH' ? toggleOnClass : toggleOffClass}
          >
            {t('month')}
          </button>
        </div>
      </div>

      {view === 'DAY' && !markable && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {t('futureDate')}
        </p>
      )}

      {markProblem && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <strong>{markProblem.title}</strong> {markProblem.message}
        </p>
      )}

      {roster.isPending && <p className="text-slate-500">{t('loading')}</p>}
      {roster.isError && (
        <QueryError error={roster.error} onRetry={() => void roster.refetch()} what="the roster" />
      )}

      {roster.data && roster.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">{t('noLabourAssigned')}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('assignFromLabourPage')}
          </p>
        </div>
      )}

      {roster.data && roster.data.length > 0 && view === 'MONTH' && (
        <MonthAttendanceView
          projectId={activeProjectId}
          period={period}
          roster={roster.data}
          locale={user.locale}
        />
      )}

      {roster.data && roster.data.length > 0 && view === 'DAY' && (
        <>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {roster.data.map((a) => {
              const current = statusOf(a.labourId)
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">
                    {a.labourName}
                  </span>
                  <div className="flex gap-2">
                    {OPTIONS.map((o) => (
                      <button
                        key={o.status}
                        type="button"
                        // Marking before the day's marks have loaded would
                        // write over records we cannot see yet.
                        disabled={!markable || marks.isPending}
                        onClick={() =>
                          mark(
                            {
                              id: a.labourId,
                              name: a.labourName,
                              dailyRatePaise: a.dailyRatePaise,
                            },
                            o.status,
                          )
                        }
                        aria-label={`${a.labourName}: ${t(o.labelKey)}`}
                        aria-pressed={current === o.status}
                        className={[
                          'size-12 rounded-xl text-lg font-semibold transition disabled:opacity-40',
                          current === o.status
                            ? o.tone
                            : 'border border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
                        ].join(' ')}
                      >
                        {o.glyph}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap gap-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
            <span className="text-green-700 dark:text-green-400">
              {t('present')} {summary.present}
            </span>
            <span className="text-amber-700 dark:text-amber-400">
              {t('halfDay')} {summary.halfDay}
            </span>
            <span className="text-red-700 dark:text-red-400">
              {t('absent')} {summary.absent}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              {t('leave')} {summary.leave}
            </span>
            <span className="ml-auto font-medium text-slate-900 dark:text-slate-100">
              {summary.complete
                ? `${t('allMarked')} ✓`
                : `${summary.total - summary.marked} ${t('remaining')}`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-3 text-base dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
const navClass =
  'rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200'
const toggleOnClass =
  'bg-slate-900 px-4 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
const toggleOffClass = 'px-4 text-sm font-medium text-slate-600 dark:text-slate-300'
