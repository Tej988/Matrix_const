import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { createMeasurementRepository } from '@mc/shared/repositories/measurements'
import { Dates, validateMeasurement, remainingQty, type DraftLine } from '@mc/shared'
import { UNIT_LABELS } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'

interface Row {
  key: number
  boqItemId: string
  location: string
  qty: string
}

let nextKey = 1

/**
 * Entering a measurement sheet.
 *
 * The section 4 check runs live as you type, so an over-quantity line is
 * refused at the keyboard rather than at approval. It is re-checked inside the
 * approval transaction regardless (R-13) - this is convenience, not the
 * enforcement point.
 */
export function NewMeasurementForm({
  projectId,
  onDone,
}: {
  projectId: string
  onDone: () => void
}) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const boqRepo = useMemo(() => createBoqRepository(db), [])
  const repo = useMemo(() => createMeasurementRepository(db), [])

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(Dates.todayKey() as string)
  const [rows, setRows] = useState<Row[]>([{ key: 0, boqItemId: '', location: '', qty: '' }])

  const boq = useQuery({
    queryKey: ['boq', projectId],
    queryFn: () => boqRepo.listForProject(projectId),
  })

  const items = boq.data ?? []

  const draft: DraftLine[] = rows
    .filter((r) => r.boqItemId !== '' && r.qty.trim() !== '')
    .map((r) => ({
      boqItemId: r.boqItemId,
      location: r.location.trim() || '—',
      currentQty: Number(r.qty.replace(/,/g, '')),
    }))
    .filter((l) => Number.isFinite(l.currentQty) && l.currentQty > 0)

  const validation = validateMeasurement(draft, items)

  const create = useMutation({
    mutationFn: () =>
      repo.create(
        {
          projectId,
          period: Dates.periodOf(Dates.dateKey(date)),
          date: Dates.dateKey(date),
          title: title.trim() || `Measurement ${Dates.formatDateKey(Dates.dateKey(date))}`,
          lines: validation.lines,
        },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: onDone,
  })

  if (boq.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t('addRateCardFirst')}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="August 2026 measurement"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('date')}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className={labelClass}>{t('workMeasured')}</span>
        {rows.map((row, idx) => {
          const item = items.find((i) => i.id === row.boqItemId)
          const left = item ? remainingQty(item) : null
          return (
            <div key={row.key} className="grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr_auto]">
              <select
                value={row.boqItemId}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, i) => (i === idx ? { ...r, boqItemId: e.target.value } : r)),
                  )
                }
                className={inputClass}
              >
                <option value="">{t('chooseWorkItem')}</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({remainingQty(i).toLocaleString('en-IN')} {UNIT_LABELS[i.unit]} left)
                  </option>
                ))}
              </select>
              <input
                value={row.location}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, i) => (i === idx ? { ...r, location: e.target.value } : r)),
                  )
                }
                placeholder="Block A"
                className={inputClass}
              />
              <input
                value={row.qty}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)))
                }
                inputMode="decimal"
                placeholder={left !== null ? `max ${left}` : 'Qty'}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                disabled={rows.length === 1}
                className="rounded-lg px-3 text-slate-400 disabled:opacity-30"
                aria-label={t('removeLine')}
              >
                ✕
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() =>
            setRows((rs) => [...rs, { key: nextKey++, boqItemId: '', location: '', qty: '' }])
          }
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
        >
          {t('addLine')}
        </button>
      </div>

      {/* Section 4 enforcement, surfaced while typing. */}
      {validation.rejections.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {validation.rejections.map((r, i) => (
            <p key={i}>
              <strong>{r.boqItemName}</strong>{' '}
              {r.reason === 'EXCEEDS_CONTRACT'
                ? `at ${r.location}: only ${r.allowedQty.toLocaleString('en-IN')} left against the contract, ${r.excessQty.toLocaleString('en-IN')} too many.`
                : 'has an invalid quantity.'}
            </p>
          ))}
        </div>
      )}

      {validation.lines.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          {validation.lines.map((l, i) => (
            <p key={i} className="flex justify-between gap-2 text-slate-700 dark:text-slate-200">
              <span>
                {l.boqItemName} · {l.location} · {l.currentQty.toLocaleString('en-IN')}{' '}
                {UNIT_LABELS[l.unit]}
              </span>
              <Amount paise={l.amountPaise} />
            </p>
          ))}
          <p className="mt-2 flex justify-between gap-2 border-t border-slate-200 pt-2 font-medium text-slate-900 dark:border-slate-600 dark:text-slate-100">
            <span>{t('sheetTotal')}</span>
            <Amount paise={validation.totalAmountPaise} />
          </p>
        </div>
      )}

      {create.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(create.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={!validation.ok || create.isPending}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {create.isPending ? t('saving') : t('saveAsDraft')}
      </button>
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        {t('savedAsDraftHint')}
      </p>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
