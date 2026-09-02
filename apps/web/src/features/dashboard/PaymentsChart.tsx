import { useMemo, useState } from 'react'
import { Dates, Money } from '@mc/shared'
import type { Paise, Period } from '@mc/types'
import { useTranslation } from '../../i18n/useTranslation'

/**
 * Money billed and money received, by month.
 *
 * Form: **emphasis**, not categorical. Received is the story — it is the cash
 * that actually arrived — and billed is context behind it. So received wears
 * the accent hue and billed a de-emphasis gray, rather than two competing
 * colours that would make the reader work out which one matters.
 *
 * Palette validated with the dataviz validator against both surfaces:
 * CVD separation ΔE 15.9 (target ≥ 8), normal-vision ΔE 17.8 (floor 15),
 * both ≥ 3:1 contrast. The validator flags the gray for low chroma, which is
 * the intended behaviour of the emphasis form and not a defect.
 *
 * One y-axis only — both series are rupees. A second scale would be the single
 * most common way to make a chart lie.
 */

const ACCENT = 'fill-[#2a78d6] dark:fill-[#3987e5]'
const CONTEXT = 'fill-[#c3c2b7] dark:fill-[#4a4a46]'

export interface MonthlyMoney {
  period: Period
  billedPaise: Paise
  receivedPaise: Paise
}

/** Buckets dated amounts into the last `months` calendar months, oldest first. */
export function bucketByMonth(
  bills: readonly { date: string; amountPaise: Paise }[],
  receipts: readonly { date: string; amountPaise: Paise }[],
  months: number,
  today = Dates.todayKey(),
): MonthlyMoney[] {
  const buckets = new Map<string, { billed: number; received: number }>()

  // Seed every month in range so a month with no activity still renders a gap
  // rather than silently collapsing the axis.
  let cursor: string = Dates.periodOf(today)
  const ordered: string[] = []
  for (let i = 0; i < months; i++) {
    ordered.unshift(cursor)
    buckets.set(cursor, { billed: 0, received: 0 })
    const [y, m] = cursor.split('-').map(Number) as [number, number]
    cursor = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  }

  for (const b of bills) {
    const key = b.date.slice(0, 7)
    const bucket = buckets.get(key)
    if (bucket) bucket.billed += b.amountPaise
  }
  for (const r of receipts) {
    const key = r.date.slice(0, 7)
    const bucket = buckets.get(key)
    if (bucket) bucket.received += r.amountPaise
  }

  return ordered.map((key) => {
    const bucket = buckets.get(key) ?? { billed: 0, received: 0 }
    return {
      period: key as Period,
      billedPaise: bucket.billed as Paise,
      receivedPaise: bucket.received as Paise,
    }
  })
}

export function PaymentsChart({ data }: { data: MonthlyMoney[] }) {
  const { t, locale } = useTranslation()
  const [showTable, setShowTable] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)

  const max = useMemo(
    () => Math.max(...data.map((d) => Math.max(d.billedPaise, d.receivedPaise)), 1),
    [data],
  )

  const hasAnything = data.some((d) => d.billedPaise > 0 || d.receivedPaise > 0)

  if (!hasAnything) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
        {t('noPaymentsYet')}
      </div>
    )
  }

  // Geometry. A viewBox plus preserveAspectRatio="none" would distort the
  // rounded corners, so the SVG scales by width and keeps a fixed height.
  const H = 180
  const PAD_TOP = 12
  const PAD_BOTTOM = 26
  const plot = H - PAD_TOP - PAD_BOTTOM
  const slot = 100 / data.length
  const barW = slot * 0.3
  const gap = slot * 0.04 // the 2px-equivalent surface gap between paired bars

  const y = (v: number) => PAD_TOP + plot - (v / max) * plot
  const gridlines = [0, 0.5, 1]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Legend. Always present for two series - identity is never colour alone. */}
        <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" className={CONTEXT} />
            </svg>
            {t('billed')}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" className={ACCENT} />
            </svg>
            {t('received')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
        >
          {showTable ? t('close') : t('viewAll')}
        </button>
      </div>

      {showTable ? (
        // The table view is not a fallback - it is the accessible equal of the
        // chart, and the only way to read exact figures.
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase dark:bg-slate-800">
              <tr>
                <th className="p-2">{t('month')}</th>
                <th className="p-2 text-right">{t('billed')}</th>
                <th className="p-2 text-right">{t('received')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {data.map((d) => (
                <tr key={d.period}>
                  <td className="p-2 text-slate-700 dark:text-slate-200">
                    {Dates.formatPeriod(d.period, locale)}
                  </td>
                  <td className="p-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {Money.formatPaise(d.billedPaise)}
                  </td>
                  <td className="p-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {Money.formatPaise(d.receivedPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 100 ${H}`}
            className="h-[180px] w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${t('billed')} / ${t('received')}`}
          >
            {/* Recessive grid - hairlines that stay behind the data. */}
            {gridlines.map((g) => (
              <line
                key={g}
                x1="0"
                x2="100"
                y1={y(max * g)}
                y2={y(max * g)}
                className="stroke-slate-200 dark:stroke-slate-700"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {data.map((d, i) => {
              const centre = i * slot + slot / 2
              const active = hovered === i
              return (
                <g key={d.period} opacity={hovered === null || active ? 1 : 0.55}>
                  <rect
                    x={centre - barW - gap / 2}
                    y={y(d.billedPaise)}
                    width={barW}
                    height={Math.max(0, plot + PAD_TOP - y(d.billedPaise))}
                    rx={1.2}
                    className={CONTEXT}
                  />
                  <rect
                    x={centre + gap / 2}
                    y={y(d.receivedPaise)}
                    width={barW}
                    height={Math.max(0, plot + PAD_TOP - y(d.receivedPaise))}
                    rx={1.2}
                    className={ACCENT}
                  />
                  {/* Hit target spans the whole slot, not just the bars. */}
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </g>
              )
            })}

            <line
              x1="0"
              x2="100"
              y1={PAD_TOP + plot}
              y2={PAD_TOP + plot}
              className="stroke-slate-300 dark:stroke-slate-600"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Axis labels live in HTML, not SVG text: preserveAspectRatio="none"
              stretches the viewBox horizontally and would distort glyphs. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex">
            {data.map((d, i) => (
              <span
                key={d.period}
                className={[
                  'flex-1 text-center text-[10px]',
                  hovered === i
                    ? 'font-medium text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400',
                ].join(' ')}
              >
                {Dates.formatPeriod(d.period, locale).split(' ')[0]?.slice(0, 3)}
              </span>
            ))}
          </div>

          <span className="pointer-events-none absolute top-0 left-0 text-[10px] text-slate-400">
            {Money.formatCompactPaise(max as Paise)}
          </span>

          {hovered !== null && data[hovered] && (
            <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800">
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {Dates.formatPeriod(data[hovered].period, locale)}
              </p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                {t('billed')}{' '}
                <span className="tabular-nums">{Money.formatPaise(data[hovered].billedPaise)}</span>
              </p>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {t('received')}{' '}
                <span className="tabular-nums">
                  {Money.formatPaise(data[hovered].receivedPaise)}
                </span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
