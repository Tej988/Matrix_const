import { Dates } from '@mc/shared'
import { useTranslation } from '../../i18n/useTranslation'
import type { PrintableReport } from './reportPdf'

/**
 * The report on screen, before anyone commits it to paper.
 *
 * Deliberately rendered on white with black text in both themes: this is a
 * preview of a printed page, and a dark-mode version of it would be a preview
 * of something that does not exist. It is fed the same PrintableReport the
 * print window gets, so the letterhead above the table is the letterhead that
 * comes out of the printer - not an approximation of it.
 */

/**
 * A month of attendance for forty labourers is over a thousand rows. Putting
 * all of them into the DOM on a cheap phone to be scrolled past is pointless;
 * the PDF and the spreadsheet carry the lot, and the preview says so.
 */
const PREVIEW_ROW_LIMIT = 200

export function ReportPreview({ report }: { report: PrintableReport }) {
  const { t } = useTranslation()
  const { header } = report
  const numeric = new Set(report.numericColumns)
  const align = (i: number) => (numeric.has(i) ? 'text-right tabular-nums' : 'text-left')

  const contact = [
    header.email ? `Email: ${header.email}` : '',
    header.phone ? `Mob: ${header.phone}` : '',
  ].filter((s) => s !== '')

  const shown = report.rows.slice(0, PREVIEW_ROW_LIMIT)
  const hidden = report.rows.length - shown.length

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white text-black shadow-sm dark:border-slate-600">
      <div className="p-5 text-[13px] sm:p-8">
        <div className="border-b-2 border-black pb-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">{header.businessName}</h2>
          {header.tagline && (
            <p className="mt-0.5 text-[11px] font-bold tracking-wide uppercase">{header.tagline}</p>
          )}
          {header.addressLines.map((line, i) => (
            <p key={i} className="leading-snug">
              {line}
            </p>
          ))}
          {contact.length > 0 && <p className="leading-snug">{contact.join('  |  ')}</p>}
          {header.gstin && <p className="mt-1 font-bold">GST NO. {header.gstin}</p>}
        </div>

        <div className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1">
          <p>
            <strong>Ref:</strong>{' '}
            <span className="inline-block min-w-[8rem] border-b border-black px-1">
              {header.ref ?? ''}
            </span>
          </p>
          <p>
            <strong>Date:</strong>{' '}
            <span className="inline-block min-w-[8rem] border-b border-black px-1">
              {Dates.formatDateKey(header.date)}
            </span>
          </p>
        </div>

        <div className="mt-4 text-center">
          <h3 className="text-base font-bold underline">{header.title}</h3>
          {header.subtitle && <p className="mt-0.5 text-slate-700">{header.subtitle}</p>}
        </div>

        {report.stats && report.stats.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {report.stats.map((s) => (
              <div
                key={s.label}
                className="min-w-[7.5rem] rounded border border-slate-400 px-3 py-2"
              >
                <p className="text-[9px] tracking-wider uppercase text-slate-600">{s.label}</p>
                <p className="text-[13px] font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Nine amount columns will not fit a phone. Scroll the table, never
            the page - a horizontally scrolling page is unusable. */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {report.columns.map((h, i) => (
                  <th
                    key={i}
                    className={`border border-slate-400 bg-slate-100 px-2 py-1.5 text-[9px] font-bold tracking-wider whitespace-nowrap uppercase ${align(i)}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td
                    colSpan={report.columns.length}
                    className="border border-slate-400 px-2 py-6 text-center text-slate-600"
                  >
                    No records for this selection.
                  </td>
                </tr>
              ) : (
                shown.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i} className={`border border-slate-400 px-2 py-1 ${align(i)}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {report.totals && (
              <tfoot>
                <tr>
                  {report.totals.map((cell, i) => (
                    <td
                      key={i}
                      className={`border border-slate-400 bg-slate-100 px-2 py-1.5 font-bold ${align(i)}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {hidden > 0 && (
          <p className="mt-2 text-[11px] text-slate-600">
            {t('showingFirstRows', { shown: PREVIEW_ROW_LIMIT, all: report.rows.length })}
          </p>
        )}

        <div className="mt-10 text-right">
          <p className="font-bold">For {header.businessName}</p>
          <p className="mt-8 inline-block min-w-[12rem] border-b border-black">
            {header.signatory ?? ''}
          </p>
          <p className="mt-0.5">(Authorized Signatory)</p>
        </div>

        <div className="mt-4 flex justify-between text-[10px] text-slate-600">
          <span>
            {report.rows.length} {report.rows.length === 1 ? 'row' : 'rows'}
          </span>
          <span>Computer-generated from Matrix Construction</span>
        </div>
      </div>
    </div>
  )
}
