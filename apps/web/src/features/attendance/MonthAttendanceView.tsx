import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createAttendanceRepository } from '@mc/shared/repositories/labour'
import { Dates, calculateWage } from '@mc/shared'
import type {
  Attendance,
  AttendanceStatus,
  DateKey,
  LabourAssignment,
  Locale,
  Period,
} from '@mc/types'
import { db } from '../../lib/firebase'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

/**
 * The cache key for a month of attendance on one project.
 *
 * Exported because two other places write or read the same rows: the wages page
 * uses this exact shape, and the day view patches it optimistically after a
 * mark. One key means one fetch - Firestore reads are the scarce resource on
 * the free tier (RISKS.md R-10).
 */
export function monthRangeKey(projectId: string, from: DateKey, to: DateKey) {
  return ['attendance-range', projectId, from, to]
}

type Look = { glyph: string; tone: string; labelKey: StatusLabelKey }
type StatusLabelKey = 'present' | 'halfDay' | 'absent' | 'leave' | 'holiday'

/*
 * The same glyphs as the day view's buttons, so a supervisor who has learnt the
 * four symbols while marking reads the register without learning them again.
 */
const LOOK: Record<AttendanceStatus, Look> = {
  PRESENT: { glyph: 'P', tone: 'bg-green-600 text-white', labelKey: 'present' },
  HALF_DAY: { glyph: '½', tone: 'bg-amber-500 text-white', labelKey: 'halfDay' },
  ABSENT: { glyph: 'A', tone: 'bg-red-600 text-white', labelKey: 'absent' },
  LEAVE: { glyph: 'L', tone: 'bg-slate-500 text-white', labelKey: 'leave' },
  HOLIDAY: { glyph: 'H', tone: 'bg-sky-600 text-white', labelKey: 'holiday' },
}

const LEGEND: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY']

/**
 * The month register - one row per labourer, one column per day, the shape the
 * owner already checks on paper at month end.
 *
 * The whole month is ONE range query rather than thirty-one day queries: on the
 * Spark tier the difference is a rounding error against the daily read quota
 * versus a real dent in it.
 *
 * Read-only by design. Marking stays on the day view, where a 44px button per
 * status is reachable; a 32px cell in a 31-column grid is not something to
 * tap by accident on a phone in the sun.
 */
export function MonthAttendanceView({
  projectId,
  period,
  roster,
  locale,
}: {
  projectId: string
  period: Period
  roster: readonly LabourAssignment[]
  locale: Locale
}) {
  const { t } = useTranslation()
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])

  const days = useMemo(() => Dates.daysInPeriod(period), [period])
  const from = days[0] as DateKey
  const to = days.at(-1) as DateKey
  const today = Dates.todayKey()

  const marks = useQuery({
    queryKey: monthRangeKey(projectId, from, to),
    queryFn: () => attendanceRepo.forProjectInRange(projectId, from, to),
    enabled: projectId !== '',
  })

  /*
   * Totals come from `calculateWage` rather than being counted here, because
   * spec section 51 puts every payable figure behind one deterministic
   * function - including the half-day fraction and its rounding.
   */
  const grid = useMemo(() => {
    const byLabour = new Map<string, Attendance[]>()
    for (const record of marks.data ?? []) {
      const own = byLabour.get(record.labourId)
      if (own) own.push(record)
      else byLabour.set(record.labourId, [record])
    }

    const rows = roster.map((assignment) => {
      const own = byLabour.get(assignment.labourId) ?? []
      return {
        assignment,
        byDate: new Map(own.map((r) => [r.dateKey, r] as const)),
        payableDays: calculateWage(own).payableDays,
      }
    })

    // Only rows still on the roster count towards the column totals, so the
    // bottom line always adds up to what is shown above it.
    const perDay = new Map<DateKey, Attendance[]>()
    const onRoster: Attendance[] = []
    for (const row of rows) {
      for (const record of row.byDate.values()) {
        onRoster.push(record)
        const bucket = perDay.get(record.dateKey)
        if (bucket) bucket.push(record)
        else perDay.set(record.dateKey, [record])
      }
    }

    const dayTotals = new Map<DateKey, number>()
    for (const [day, records] of perDay) dayTotals.set(day, calculateWage(records).payableDays)

    return { rows, dayTotals, monthTotal: calculateWage(onRoster).payableDays }
  }, [marks.data, roster])

  if (marks.isPending) return <p className="text-slate-500">{t('loading')}</p>
  if (marks.isError) {
    return (
      <QueryError
        error={marks.error}
        onRetry={() => void marks.refetch()}
        what={t('attendanceTitle')}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* The grid scrolls inside this box. The page itself never moves sideways. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${headCell} sticky left-0 text-left`}>
                <span className="block w-32 truncate">{t('name')}</span>
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={`${headCell} w-8 text-center tabular-nums ${
                    day === today ? todayTone : ''
                  }`}
                >
                  {Number(day.slice(8))}
                </th>
              ))}
              <th scope="col" className={`${headCell} px-3 text-right`}>
                {t('payable')}
              </th>
            </tr>
          </thead>

          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.assignment.id}>
                <th
                  scope="row"
                  className={`${bodyCell} sticky left-0 bg-white text-left font-medium text-slate-900 dark:bg-slate-900 dark:text-slate-100`}
                >
                  <span className="block w-32 truncate">{row.assignment.labourName}</span>
                </th>
                {days.map((day) => {
                  const record = row.byDate.get(day)
                  const look = record ? LOOK[record.status] : null
                  return (
                    <td
                      key={day}
                      className={`${bodyCell} w-8 text-center ${day === today ? todayTone : ''}`}
                    >
                      {look ? (
                        <span
                          title={`${row.assignment.labourName} · ${Dates.formatDateKey(
                            day,
                            locale,
                          )} · ${t(look.labelKey)}`}
                          className={`mx-auto flex size-7 items-center justify-center rounded-md text-xs font-semibold ${look.tone}`}
                        >
                          {look.glyph}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                      )}
                    </td>
                  )
                })}
                <td
                  className={`${bodyCell} px-3 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100`}
                >
                  {row.payableDays}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                className={`${footCell} sticky left-0 text-left font-medium text-slate-700 dark:text-slate-300`}
              >
                <span className="block w-32 truncate">{t('total')}</span>
              </th>
              {days.map((day) => {
                const total = grid.dayTotals.get(day)
                return (
                  <td
                    key={day}
                    className={`${footCell} w-8 text-center tabular-nums ${
                      day === today ? todayTone : ''
                    }`}
                  >
                    {total === undefined ? '' : total}
                  </td>
                )
              })}
              <td className={`${footCell} px-3 text-right font-semibold tabular-nums`}>
                {grid.monthTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
        {LEGEND.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`flex size-5 items-center justify-center rounded text-[11px] font-semibold ${LOOK[status].tone}`}
            >
              {LOOK[status].glyph}
            </span>
            {t(LOOK[status].labelKey)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="text-slate-300 dark:text-slate-600">
            ·
          </span>
          {t('remaining')}
        </li>
      </ul>
    </div>
  )
}

/* border-separate, not border-collapse: collapsed borders are painted by the
   table and vanish under a sticky cell as it scrolls over them. */
const headCell =
  'border-b border-slate-200 bg-slate-50 px-1 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
const bodyCell = 'border-b border-slate-100 px-1 py-1.5 dark:border-slate-800'
const footCell =
  'border-t border-slate-200 bg-slate-50 px-1 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
const todayTone = 'bg-blue-50 dark:bg-blue-950'
