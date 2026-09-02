import type { Bill, BillItem } from '@mc/types'
import { Money, Dates } from '@mc/shared'
import { UNIT_LABELS } from '@mc/types'

/**
 * Bill PDF. Section 36.
 *
 * Generated as self-contained printable HTML opened in a new window rather
 * than through a PDF library, for three reasons:
 *
 *   1. No dependency. pdfmake adds ~400 KB to a bundle that is already 300 KB
 *      gzipped, for a document printed a few times a month.
 *   2. The browser's own "Save as PDF" produces a correct, selectable-text PDF.
 *   3. Devanagari renders natively. Embedding a Devanagari font into a PDF
 *      library needs a subsetted font and correct conjunct shaping (R-08);
 *      the browser already does that properly.
 *
 * English-only for now regardless, which matches how bills are actually issued
 * to a corporate client like Tata Project Limited.
 */

export interface BusinessProfile {
  name: string
  addressLines: string[]
  phone?: string
  email?: string
  gstin?: string
  /** Printed above the signature rule, as on the owner's existing bills. */
  signatory?: string
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

export function renderBillHtml(
  bill: Bill,
  items: readonly BillItem[],
  business: BusinessProfile,
): string {
  const hasTax =
    bill.tax.cgstAmountPaise > 0 || bill.tax.sgstAmountPaise > 0 || bill.tax.igstAmountPaise > 0
  const hasDeductions =
    bill.deductions.tdsAmountPaise > 0 ||
    bill.deductions.retentionAmountPaise > 0 ||
    bill.deductions.otherAmountPaise > 0

  /*
   * Two quantity columns, matching the owner's existing bills.
   *
   * Work is measured on site in square metres but contracted and billed per
   * square foot, so a real bill shows BOTH and the client can check the
   * conversion. Showing only one would make the bill harder to verify than the
   * paper one it replaces.
   */
  const showMetric = items.some((i) => i.unit === 'SQFT' || i.unit === 'SQM')
  const SQFT_PER_SQM = 10.7639

  const metricOf = (i: BillItem): string => {
    if (i.unit === 'SQM') return i.quantity.toLocaleString('en-IN')
    if (i.unit === 'SQFT') return (i.quantity / SQFT_PER_SQM).toFixed(1)
    return ''
  }

  const rows = items
    .map(
      (i, n) => `
      <tr>
        <td class="num">${n + 1}</td>
        <td>${esc(i.name)}</td>
        ${showMetric ? `<td class="num">${esc(metricOf(i))}</td>` : ''}
        <td class="num">${i.quantity.toLocaleString('en-IN')}</td>
        <td>${esc(UNIT_LABELS[i.unit])}</td>
        <td class="num">${esc(Money.formatPlain(i.ratePaise))}</td>
        <td class="num">${esc(Money.formatPlain(i.amountPaise))}</td>
      </tr>`,
    )
    .join('')

  const columnCount = showMetric ? 7 : 6

  const totalRow = (label: string, value: string, strong = false) => `
    <tr class="${strong ? 'strong' : ''}">
      <td colspan="${columnCount - 1}" class="label">${esc(label)}</td>
      <td class="num">${esc(value)}</td>
    </tr>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(bill.billNumber)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, system-ui, sans-serif; color: #000; font-size: 12px; margin: 0; }
  h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  h2 { margin: 24px 0 8px; font-size: 17px; font-weight: 700; }
  .meta { margin-bottom: 4px; }
  .meta strong { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #999; padding: 8px 10px; text-align: left; }
  th { background: #f2f2f2; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .label { text-align: right; font-weight: 700; }
  tr.strong td { font-weight: 700; }
  .words { margin-top: 10px; font-style: italic; color: #333; }
  .sign { margin-top: 56px; font-weight: 700; }
  .sign span { display: inline-block; min-width: 220px; border-bottom: 1px solid #000;
               margin-left: 8px; text-align: center; }
  .foot { margin-top: 28px; font-size: 10px; color: #666; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 16px; }
  .noprint button { font-size: 14px; padding: 10px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

<h1>${esc(business.name)}</h1>
${business.addressLines.length ? `<div class="meta">${business.addressLines.map(esc).join(', ')}</div>` : ''}
${business.phone ? `<div class="meta">${esc(business.phone)}</div>` : ''}
${business.gstin ? `<div class="meta"><strong>GSTIN:</strong> ${esc(business.gstin)}</div>` : ''}

<div class="meta"><strong>Date:</strong> ${esc(Dates.formatDateKey(bill.billDate))}</div>
<div class="meta"><strong>Bill No:</strong> ${esc(bill.billNumber)}</div>
<div class="meta"><strong>Client:</strong> ${esc(bill.clientName)}</div>
<div class="meta"><strong>Project:</strong> ${esc(bill.projectName)}</div>
<div class="meta"><strong>Period:</strong> ${esc(Dates.formatDateKey(bill.periodFrom))} to ${esc(Dates.formatDateKey(bill.periodTo))}</div>

<h2>Bill Summary</h2>

<table>
  <thead>
    <tr>
      <th style="width:34px">#</th>
      <th>Item</th>
      ${showMetric ? '<th class="num">M&sup2;</th>' : ''}
      <th class="num">Quantity</th>
      <th>Unit</th>
      <th class="num">Rate (RS)</th>
      <th class="num">Amount (RS)</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    ${hasTax || hasDeductions ? totalRow('Subtotal', Money.formatPlain(bill.subtotalPaise)) : ''}
    ${bill.tax.cgstAmountPaise > 0 ? totalRow(`CGST @ ${bill.tax.cgstRate}%`, Money.formatPlain(bill.tax.cgstAmountPaise)) : ''}
    ${bill.tax.sgstAmountPaise > 0 ? totalRow(`SGST @ ${bill.tax.sgstRate}%`, Money.formatPlain(bill.tax.sgstAmountPaise)) : ''}
    ${bill.tax.igstAmountPaise > 0 ? totalRow(`IGST @ ${bill.tax.igstRate}%`, Money.formatPlain(bill.tax.igstAmountPaise)) : ''}
    ${bill.deductions.tdsAmountPaise > 0 ? totalRow(`Less TDS @ ${bill.deductions.tdsRate}%`, `- ${Money.formatPlain(bill.deductions.tdsAmountPaise)}`) : ''}
    ${bill.deductions.retentionAmountPaise > 0 ? totalRow(`Less retention @ ${bill.deductions.retentionRate}%`, `- ${Money.formatPlain(bill.deductions.retentionAmountPaise)}`) : ''}
    ${bill.deductions.otherAmountPaise > 0 ? totalRow(`Less ${bill.deductions.otherLabel ?? 'other'}`, `- ${Money.formatPlain(bill.deductions.otherAmountPaise)}`) : ''}
    ${totalRow('Total', Money.formatPlain(bill.netAmountPaise), true)}
  </tfoot>
</table>

<p class="words">Rupees ${esc(Money.formatPaiseInWords(bill.netAmountPaise))} only.</p>

<p class="sign">Authorized Signature:<span>${esc(business.signatory ?? '')}</span></p>

<p class="foot">Computer-generated from Matrix Construction.</p>
</body>
</html>`
}

/**
 * Opens a blank window SYNCHRONOUSLY, during the click.
 *
 * Same reason as the report printer: `window.open()` after an `await` has lost
 * its user-activation and every browser blocks it silently. Loading the bill's
 * line items is async, so the window is claimed first and written afterwards.
 */
export function openPrintWindow(): Window | null {
  const win = window.open('', '_blank')
  if (!win) return null
  win.document.write(
    '<!doctype html><title>Preparing…</title>' +
      '<body style="font:14px system-ui;padding:24px;color:#475569">Preparing the bill…</body>',
  )
  return win
}

/** Fills a window already claimed by openPrintWindow(). */
export function writeBill(
  win: Window,
  bill: Bill,
  items: readonly BillItem[],
  business: BusinessProfile,
): void {
  win.document.open()
  win.document.write(renderBillHtml(bill, items, business))
  win.document.close()
}
