import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Dates, summariseDay, isMarkableDate } from '@mc/shared'
import type { AttendanceStatus, DateKey, Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

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
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({})

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  const activeProjectId = projectId || projects.data?.[0]?.id || ''
  const dateKey = date as DateKey

  const roster = useQuery({
    queryKey: ['roster', activeProjectId],
    queryFn: () => labourRepo.assignmentsForProject(activeProjectId),
    enabled: activeProjectId !== '',
  })

  const marks = useQuery({
    queryKey: ['attendance', activeProjectId, dateKey],
    queryFn: () => attendanceRepo.forProjectAndDate(activeProjectId, dateKey),
    enabled: activeProjectId !== '',
  })

  const markable = isMarkableDate(dateKey, Dates.todayKey())

  function mark(
    labour: { id: string; name: string; dailyRatePaise: Paise },
    status: AttendanceStatus,
  ) {
    // Optimistic by design. The write is queued locally whether or not there is
    // a connection, so the UI must not wait for confirmation.
    setPending((p) => ({ ...p, [labour.id]: status }))

    const { committed } = attendanceRepo.mark(
      {
        projectId: activeProjectId,
        labour: { id: labour.id, name: labour.name },
        dateKey,
        status,
        dailyRatePaise: labour.dailyRatePaise,
      },
      user.uid,
    )

    committed
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: ['attendance', activeProjectId, dateKey],
        })
      })
      .catch(() => {
        // Offline: the write sits in the local queue and will sync. Keep the
        // optimistic state - clearing it would look like the mark was lost,
        // which is exactly what section 13 forbids.
      })
  }

  if (projects.isPending) return <p className="p-4 text-slate-500">Loading…</p>
  if (projects.isError) {
    return <QueryError error={projects.error} onRetry={() => void projects.refetch()} what="projects" />
  }

  if (projects.data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
        <p className="text-slate-600 dark:text-slate-300">
          You are not assigned to any project yet.
        </p>
      </div>
    )
  }

  const statusOf = (labourId: string): AttendanceStatus | undefined =>
    pending[labourId] ?? marks.data?.find((m) => m.labourId === labourId)?.status

  const summary = summariseDay(
    (roster.data ?? []).map((a) => ({ id: a.labourId })),
    marks.data ?? [],
  )

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('attendanceTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {Dates.formatDateKey(dateKey, user.locale)}
          {roster.data && ` · ${summary.marked}/${summary.total} ${t('marked')}`}
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
          <span className={labelClass}>{t('date')}</span>
          <input
            type="date"
            value={date}
            max={Dates.todayKey()}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {!markable && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {t('futureDate')}
        </p>
      )}

      {roster.isPending && <p className="text-slate-500">Loading roster…</p>}
      {roster.isError && (
        <QueryError error={roster.error} onRetry={() => void roster.refetch()} what="the roster" />
      )}

      {roster.data && roster.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">
            {t('noLabourAssigned')}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Assign them from the Labour page.
          </p>
        </div>
      )}

      {roster.data && roster.data.length > 0 && (
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
                        disabled={!markable}
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
