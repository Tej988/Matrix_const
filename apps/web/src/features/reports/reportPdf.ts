import { Dates } from '@mc/shared'

/**
 * Printable reports. Section 37 asks for PDF export.
 *
 * Rendered as self-contained HTML opened in a new window, where the browser's
 * own "Save as PDF" produces the file. Same reasoning as the bill PDF: no
 * 400 KB library for a document printed a few times a month, selectable text
 * in the output, and Devanagari renders natively rather than needing an
 * embedded subsetted font with correct conjunct shaping (R-08).
 */

export interface ReportMeta {
  title: string
  subtitle?: string
  businessName: string
  /** Rendered above the table - contract, billed, received and so on. */
  stats?: { label: string; value: string }[]
  /** Column indices to right-align. Numeric columns, essentially. */
  numericColumns?: number[]
  /** Rendered as a bold final row. */
  totals?: (string | number)[]
  note?: string
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

export function renderReportHtml(
  meta: ReportMeta,
  headers: readonly string[],
  rows: readonly (string | number)[][],
): string {
  const numeric = new Set(meta.numericColumns ?? [])
  const cls = (i: number) => (numeric.has(i) ? ' class="num"' : '')

  const headRow = headers.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')

  const bodyRows = rows.length
    ? rows
        .map((row) => `<tr>${row.map((cell, i) => `<td${cls(i)}>${esc(cell)}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td colspan="${headers.length}" class="empty">No records for this selection.</td></tr>`

  const totalsRow = meta.totals
    ? `<tfoot><tr class="strong">${meta.totals
        .map((cell, i) => `<td${cls(i)}>${esc(cell)}</td>`)
        .join('')}</tr></tfoot>`
    : ''

  const statsBlock = meta.stats?.length
    ? `<div class="stats">${meta.stats
        .map(
          (s) =>
            `<div class="stat"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div></div>`,
        )
        .join('')}</div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif;
    color: #0f172a; font-size: 11px; margin: 0;
  }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px;
           display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  h1 { margin: 0; font-size: 17px; }
  .muted { color: #475569; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; min-width: 120px; }
  .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
  .stat-value { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; font-size: 9px; letter-spacing: .05em;
       text-transform: uppercase; padding: 7px 6px; border-bottom: 1px solid #cbd5e1; }
  td { padding: 6px; border-bottom: 1px solid #e2e8f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; color: #64748b; padding: 24px; }
  tfoot tr.strong td { font-weight: 700; border-top: 2px solid #0f172a; border-bottom: none; }
  /* Repeat the header on every printed page - a 60-row register spans pages. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  footer { margin-top: 18px; display: flex; justify-content: space-between;
           color: #64748b; font-size: 9px; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 14px; }
  .noprint button { font-size: 14px; padding: 10px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

<header>
  <div>
    <h1>${esc(meta.title)}</h1>
    ${meta.subtitle ? `<div class="muted">${esc(meta.subtitle)}</div>` : ''}
  </div>
  <div class="muted" style="text-align:right">
    <div><strong>${esc(meta.businessName)}</strong></div>
    <div>${esc(Dates.formatDateKey(Dates.todayKey()))}</div>
  </div>
</header>

${statsBlock}

<table>
  <thead><tr>${headRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
  ${totalsRow}
</table>

<footer>
  <span>${rows.length} ${rows.length === 1 ? 'row' : 'rows'}</span>
  <span>Computer-generated from Matrix Construction</span>
</footer>
</body>
</html>`
}

/** Returns false when the browser blocks the pop-up, so the caller can say so. */
export function openReportForPrint(
  meta: ReportMeta,
  headers: readonly string[],
  rows: readonly (string | number)[][],
): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(renderReportHtml(meta, headers, rows))
  win.document.close()
  return true
}
