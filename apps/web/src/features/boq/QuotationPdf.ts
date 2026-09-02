import type { BusinessProfile, DateKey, Paise, Unit } from '@mc/types'
import { UNIT_LABELS } from '@mc/types'
import { Dates, Money } from '@mc/shared'

/**
 * Quotation PDF, in the format the owner already issues on paper.
 *
 * Same printable-HTML approach as billPdf.ts and reportPdf.ts: no PDF library
 * for a document printed a few times a month, the browser's own "Save as PDF"
 * produces selectable text, and Devanagari in a client name renders natively
 * rather than needing an embedded subsetted font (R-08).
 *
 * A quotation quotes RATES. There is deliberately no quantity column, no
 * amount column and no total: nothing has been measured and no scope has been
 * agreed, so a total here would be a guess that reads like a commitment. That
 * is also how the owner's paper quotations are laid out.
 */

/** One quoted line - a rate card item with its quantities stripped off. */
export interface QuotationLine {
  description: string
  unit: Unit
  ratePaise: Paise
}

export interface QuotationDetails {
  /** Their "Ref:" line. Empty prints a blank rule to fill in by hand. */
  ref?: string
  date: DateKey
  /** "To, <attention>," — "Project Manager" on the owner's existing quotations. */
  attention: string
  clientName: string
  siteAddress?: string
  /** The work being quoted, e.g. "Tile & Marble Fitting Work". */
  workTitle: string
  projectName: string
  /** The short covering line under the subject. */
  covering: string
  terms: readonly string[]
}

export const DEFAULT_ATTENTION = 'Project Manager'

export const DEFAULT_COVERING =
  'With reference to the above subject, we are pleased to submit our rates for the work ' +
  'detailed below for your kind consideration and approval.'

/**
 * The two clauses the owner puts on every quotation, with the live GSTIN read
 * from the business profile rather than typed in again.
 *
 * Defaults, not constants: the scope clause changes with the job, so the
 * caller edits these before printing.
 */
export function defaultQuotationTerms(business: BusinessProfile): string[] {
  return [
    'Scope of Work: rates include only labour charges.',
    business.gstin
      ? `GST: applicable as per GST registration ${business.gstin}.`
      : 'GST: applicable as per our GST registration.',
  ]
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

export function renderQuotationHtml(
  details: QuotationDetails,
  lines: readonly QuotationLine[],
  business: BusinessProfile,
): string {
  const rows = lines.length
    ? lines
        .map(
          (l, n) => `
      <tr>
        <td class="num">${n + 1}</td>
        <td>${esc(l.description)}</td>
        <td>${esc(UNIT_LABELS[l.unit])}</td>
        <td class="num">${esc(Money.formatPlain(l.ratePaise))}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No rate card items to quote.</td></tr>'

  const terms = details.terms
    .filter((line) => line.trim() !== '')
    .map((line) => `<li>${esc(line)}</li>`)
    .join('')

  // "To," block. Each line is optional except the client - a quotation to a
  // client with no site on file should still print, minus the address line.
  const addressee = [details.attention, details.clientName, details.siteAddress]
    .filter((line): line is string => (line ?? '').trim() !== '')
    .map((line) => `<div>${esc(line)},</div>`)
    .join('')

  // Escaped like every other field: an email or a phone note is free text, and
  // a stray "&" in it must not close the document early.
  const contact = [
    business.email ? `Email: ${esc(business.email)}` : '',
    business.phone ? `Mob: ${esc(business.phone)}` : '',
  ]
    .filter((s) => s !== '')
    .join(' &nbsp;|&nbsp; ')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quotation - ${esc(details.projectName)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, system-ui, sans-serif; color: #000; font-size: 12px; margin: 0; }
  .letterhead { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
  h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  .tagline { font-size: 11px; font-weight: 700; text-transform: uppercase;
             letter-spacing: .02em; margin-bottom: 6px; }
  .letterhead div { line-height: 1.5; }
  .gstin { font-weight: 700; margin-top: 4px; }
  .refline { display: flex; justify-content: space-between; gap: 24px; margin: 16px 0 20px; }
  .refline span { min-width: 160px; border-bottom: 1px solid #000; display: inline-block;
                  padding: 0 4px; }
  .to { margin-bottom: 16px; line-height: 1.6; }
  .subject { margin: 0 0 12px; font-weight: 700; text-decoration: underline; }
  .covering { margin: 0 0 16px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #999; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; color: #555; padding: 20px; }
  h2 { margin: 24px 0 6px; font-size: 14px; font-weight: 700; text-decoration: underline; }
  ol.terms { margin: 0; padding-left: 20px; line-height: 1.7; }
  .sign { margin-top: 64px; text-align: right; }
  .sign .who { font-weight: 700; margin-bottom: 34px; }
  .sign .rule { display: inline-block; min-width: 220px; border-bottom: 1px solid #000; }
  .sign .role { margin-top: 4px; }
  /* A long rate card spans pages; repeat the header and never split a row. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 16px; }
  .noprint button { font-size: 14px; padding: 10px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

<div class="letterhead">
  <h1>${esc(business.name)}</h1>
  ${business.tagline ? `<div class="tagline">${esc(business.tagline)}</div>` : ''}
  ${business.addressLines.map((l) => `<div>${esc(l)}</div>`).join('')}
  ${contact ? `<div>${contact}</div>` : ''}
  ${business.gstin ? `<div class="gstin">GST NO. ${esc(business.gstin)}</div>` : ''}
</div>

<div class="refline">
  <div><strong>Ref:</strong> <span>${esc(details.ref ?? '')}</span></div>
  <div><strong>Date:</strong> <span>${esc(Dates.formatDateKey(details.date))}</span></div>
</div>

<div class="to">
  <div>To,</div>
  ${addressee}
</div>

<p class="subject">Subject: Quotation for ${esc(details.workTitle)} &ndash; ${esc(details.projectName)}</p>

<p class="covering">${esc(details.covering)}</p>

<table>
  <thead>
    <tr>
      <th style="width:48px">S.NO</th>
      <th>Description</th>
      <th style="width:80px">Unit</th>
      <th class="num" style="width:110px">Rate (RS)</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

${terms ? `<h2>Terms &amp; Conditions</h2><ol class="terms">${terms}</ol>` : ''}

<div class="sign">
  <div class="who">For ${esc(business.name)}</div>
  <div class="rule">${esc(business.signatory ?? '')}</div>
  <div class="role">(Authorized Signatory)</div>
</div>
</body>
</html>`
}

/**
 * Opens a blank window SYNCHRONOUSLY, during the click.
 *
 * Same reason as the bill and report printers: `window.open()` after an
 * `await` has lost its user-activation and every browser blocks it silently.
 * Loading the project and the business profile is async, so the window is
 * claimed first and written afterwards.
 */
export function openPrintWindow(): Window | null {
  const win = window.open('', '_blank')
  if (!win) return null
  win.document.write(
    '<!doctype html><title>Preparing…</title>' +
      '<body style="font:14px system-ui;padding:24px;color:#475569">Preparing the quotation…</body>',
  )
  return win
}

/** Fills a window already claimed by openPrintWindow(). */
export function writeQuotation(
  win: Window,
  details: QuotationDetails,
  lines: readonly QuotationLine[],
  business: BusinessProfile,
): void {
  win.document.open()
  win.document.write(renderQuotationHtml(details, lines, business))
  win.document.close()
}
