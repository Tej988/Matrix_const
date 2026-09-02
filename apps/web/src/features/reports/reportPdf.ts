import { Dates } from '@mc/shared'
import type { BusinessProfile, DateKey } from '@mc/types'

/**
 * Printable reports. Section 37 asks for PDF export.
 *
 * `renderReportHtml()` is the single definition of what a report looks like on
 * paper, and it has two consumers:
 *
 *  - `openPrintWindow()` + `writeReport()` open it in a window where the
 *    browser's own "Save as PDF" produces the file. Selectable text, no
 *    library, and Devanagari shaped natively by the engine rather than by an
 *    embedded subsetted font that gets conjuncts wrong (R-08).
 *  - `pdfExport.renderHtmlToPdfBlob()` photographs that same HTML into a real
 *    PDF binary the page can hand to WhatsApp. Image text rather than
 *    selectable text, but correctly shaped for the same reason: the browser
 *    lays it out before anything is rasterised.
 *
 * Both render the same markup, so they cannot disagree about what the report
 * says.
 *
 * A report goes to a client or a bank the same way a bill does, so it carries
 * the same letterhead as QuotationPdf.ts - business name, tagline, address,
 * contact line, GSTIN. It must look like the same business wrote both.
 */

/**
 * The letterhead plus the document's own identity, exactly as it will print.
 *
 * Copied out of the business profile rather than pointing at it: the header
 * dialog lets the operator fix a detail for ONE document - a site address, a
 * different phone - without that correction leaking back into Settings.
 */
export interface ReportHeader {
  businessName: string
  tagline?: string
  addressLines: readonly string[]
  phone?: string
  email?: string
  gstin?: string
  signatory?: string
  title: string
  subtitle?: string
  /** Their "Ref:" line. Empty prints a blank rule to fill in by hand. */
  ref?: string
  date: DateKey
}

/**
 * A report after presentation: every cell already a string.
 *
 * The on-screen preview and the print window are handed this same object, so
 * what the owner checks on screen is what comes out of the printer. A second
 * formatting pass for the screen would eventually disagree with the first.
 */
export interface PrintableReport {
  header: ReportHeader
  columns: readonly string[]
  /** Column indices to right-align. Numeric columns, essentially. */
  numericColumns: readonly number[]
  rows: readonly (readonly string[])[]
  stats?: readonly { label: string; value: string }[]
  totals?: readonly string[]
}

/**
 * Seeds a document header from the saved business profile.
 *
 * Conditional spreads rather than `x ?? undefined`: exactOptionalPropertyTypes
 * rejects an explicit undefined where the property is merely optional.
 */
export function headerFrom(
  business: BusinessProfile,
  doc: { title: string; subtitle?: string; ref?: string; date: DateKey },
): ReportHeader {
  return {
    businessName: business.name,
    addressLines: business.addressLines,
    title: doc.title,
    date: doc.date,
    ...(business.tagline ? { tagline: business.tagline } : {}),
    ...(business.phone ? { phone: business.phone } : {}),
    ...(business.email ? { email: business.email } : {}),
    ...(business.gstin ? { gstin: business.gstin } : {}),
    ...(business.signatory ? { signatory: business.signatory } : {}),
    ...(doc.subtitle ? { subtitle: doc.subtitle } : {}),
    ...(doc.ref ? { ref: doc.ref } : {}),
  }
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** `Email: … | Mob: …`, omitting whichever is not on file. Escaped: free text. */
function contactLine(header: ReportHeader): string {
  return [
    header.email ? `Email: ${esc(header.email)}` : '',
    header.phone ? `Mob: ${esc(header.phone)}` : '',
  ]
    .filter((s) => s !== '')
    .join(' &nbsp;|&nbsp; ')
}

export function renderReportHtml(report: PrintableReport): string {
  const { header } = report
  const numeric = new Set(report.numericColumns)
  const cls = (i: number) => (numeric.has(i) ? ' class="num"' : '')

  const headRow = report.columns.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')

  const bodyRows = report.rows.length
    ? report.rows
        .map((row) => `<tr>${row.map((cell, i) => `<td${cls(i)}>${esc(cell)}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td colspan="${report.columns.length}" class="empty">No records for this selection.</td></tr>`

  const totalsRow = report.totals
    ? `<tfoot><tr class="strong">${report.totals
        .map((cell, i) => `<td${cls(i)}>${esc(cell)}</td>`)
        .join('')}</tr></tfoot>`
    : ''

  const statsBlock = report.stats?.length
    ? `<div class="stats">${report.stats
        .map(
          (s) =>
            `<div class="stat"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div></div>`,
        )
        .join('')}</div>`
    : ''

  const contact = contactLine(header)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(header.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif;
    color: #000; font-size: 11px; margin: 0;
  }
  /* Same letterhead block as the quotation - one business, one look. */
  .letterhead { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
  .letterhead h1 { margin: 0 0 3px; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
  .letterhead div { line-height: 1.45; }
  .tagline { font-size: 10px; font-weight: 700; text-transform: uppercase;
             letter-spacing: .02em; margin-bottom: 4px; }
  .gstin { font-weight: 700; margin-top: 3px; }
  .refline { display: flex; justify-content: space-between; gap: 24px; margin: 10px 0 6px; }
  .refline span { min-width: 150px; border-bottom: 1px solid #000; display: inline-block;
                  padding: 0 4px; }
  .doctitle { text-align: center; margin: 0 0 12px; }
  .doctitle h2 { margin: 0; font-size: 15px; font-weight: 700; text-decoration: underline; }
  .doctitle .sub { color: #333; margin-top: 3px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .stat { border: 1px solid #999; border-radius: 4px; padding: 6px 12px; min-width: 120px; }
  .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #444; }
  .stat-value { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-size: 9px; letter-spacing: .05em;
       text-transform: uppercase; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; color: #555; padding: 24px; }
  tfoot tr.strong td { font-weight: 700; background: #f2f2f2; }
  /* Repeat the header on every printed page - a 60-row register spans pages. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .sign { margin-top: 40px; text-align: right; break-inside: avoid; }
  .sign .who { font-weight: 700; margin-bottom: 30px; }
  .sign .rule { display: inline-block; min-width: 200px; border-bottom: 1px solid #000; }
  .sign .role { margin-top: 3px; }
  footer { margin-top: 14px; display: flex; justify-content: space-between;
           color: #555; font-size: 9px; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 14px; }
  .noprint button { font-size: 14px; padding: 10px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

<div class="letterhead">
  <h1>${esc(header.businessName)}</h1>
  ${header.tagline ? `<div class="tagline">${esc(header.tagline)}</div>` : ''}
  ${header.addressLines.map((l) => `<div>${esc(l)}</div>`).join('')}
  ${contact ? `<div>${contact}</div>` : ''}
  ${header.gstin ? `<div class="gstin">GST NO. ${esc(header.gstin)}</div>` : ''}
</div>

<div class="refline">
  <div><strong>Ref:</strong> <span>${esc(header.ref ?? '')}</span></div>
  <div><strong>Date:</strong> <span>${esc(Dates.formatDateKey(header.date))}</span></div>
</div>

<div class="doctitle">
  <h2>${esc(header.title)}</h2>
  ${header.subtitle ? `<div class="sub">${esc(header.subtitle)}</div>` : ''}
</div>

${statsBlock}

<table>
  <thead><tr>${headRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
  ${totalsRow}
</table>

<div class="sign">
  <div class="who">For ${esc(header.businessName)}</div>
  <div class="rule">${esc(header.signatory ?? '')}</div>
  <div class="role">(Authorized Signatory)</div>
</div>

<footer>
  <span>${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'}</span>
  <span>Computer-generated from Matrix Construction</span>
</footer>
</body>
</html>`
}

/**
 * Opens a blank window SYNCHRONOUSLY, during the click.
 *
 * This split exists because of a real bug: `window.open()` called after an
 * `await` has lost the user-activation that permits it, so every browser
 * silently blocks the pop-up.
 *
 * The report is now built and previewed before anyone asks for a PDF, so the
 * print path has no await left in it at all - but the split stays, because it
 * is the shape that cannot regress.
 *
 * Returns null when the browser blocked it anyway (pop-ups disabled outright),
 * which the caller reports rather than failing silently.
 */
export function openPrintWindow(): Window | null {
  const win = window.open('', '_blank')
  if (!win) return null
  // Something to look at while the data loads - a blank tab reads as broken.
  win.document.write(
    '<!doctype html><title>Preparing…</title>' +
      '<body style="font:14px system-ui;padding:24px;color:#475569">Preparing the report…</body>',
  )
  return win
}

/** Fills a window already claimed by openPrintWindow(). */
export function writeReport(win: Window, report: PrintableReport): void {
  win.document.open()
  win.document.write(renderReportHtml(report))
  win.document.close()
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * The short caption that travels WITH the PDF.
 *
 * WHAT CHANGED, AND WHY. This used to be a text summary sent INSTEAD of the
 * report, because a page had no PDF binary to attach: every printer here emits
 * printable HTML that the browser turns into a PDF inside its own print
 * dialog, and that file never comes back to the page. Drawing one with jsPDF
 * was rejected, correctly - jsPDF has no OpenType shaping engine, so a
 * labourer named रामकिशोर comes out of a wage sheet as reordered rubbish
 * (R-08).
 *
 * pdfExport.ts now produces a real binary without reintroducing that bug: it
 * photographs the browser's own rendering of `renderReportHtml()`, so the
 * shaping is done by the engine before anything is rasterised. So the document
 * itself is what gets sent, and this is only the covering note above it - the
 * numbers live in the attachment where they belong, not retyped into a chat
 * bubble that could disagree with it.
 */
export function reportShareCaption(report: PrintableReport): string {
  const { header } = report
  // *asterisks* are WhatsApp's bold. Harmless characters if it does not render.
  const lines: string[] = [`*${header.businessName}*`, header.title]
  if (header.subtitle) lines.push(header.subtitle)
  if (header.ref) lines.push(`Ref: ${header.ref}`)
  lines.push(`Date: ${Dates.formatDateKey(header.date)}`)
  return lines.join('\n')
}

/**
 * The caption for the desktop fallback, where the file has been downloaded and
 * the operator attaches it in the chat by hand.
 *
 * It names the file, so the operator can find it in their downloads and the
 * recipient knows something is coming. It does NOT claim the PDF is attached -
 * at the moment this text is typed into WhatsApp, it is not.
 */
export function reportAttachMessage(report: PrintableReport, pdfName: string): string {
  return `${reportShareCaption(report)}\n\nSending the full report as a PDF: ${pdfName}`
}

/**
 * WhatsApp with the message pre-filled and no recipient, so it opens the
 * contact picker - the report goes to whoever the owner chooses.
 *
 * A plain link, not `window.open()`: a real navigation is never pop-up
 * blocked, and on desktop wa.me hands off to web.whatsapp.com by itself.
 */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/**
 * Whether this browser can hand a real file to another app.
 *
 * False on essentially every desktop browser, so it is checked rather than
 * assumed - the spreadsheet share button simply does not render where it would
 * not work, instead of failing on the tap.
 */
export function canShareFiles(files: readonly File[]): boolean {
  if (typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [...files] })
  } catch {
    // Some browsers throw on an unsupported member rather than returning false.
    return false
  }
}
