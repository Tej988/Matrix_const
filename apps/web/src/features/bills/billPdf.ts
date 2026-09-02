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
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
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

  const rows = items
    .map(
      (i, n) => `
      <tr>
        <td class="num">${n + 1}</td>
        <td>${esc(i.name)}</td>
        <td class="num">${i.quantity.toLocaleString('en-IN')}</td>
        <td>${esc(UNIT_LABELS[i.unit])}</td>
        <td class="num">${esc(Money.formatPaise(i.ratePaise))}</td>
        <td class="num">${esc(Money.formatPaise(i.amountPaise))}</td>
      </tr>`,
    )
    .join('')

  const totalRow = (label: string, value: string, strong = false) => `
    <tr class="${strong ? 'strong' : ''}">
      <td colspan="5" class="label">${esc(label)}</td>
      <td class="num">${esc(value)}</td>
    </tr>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(bill.billNumber)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
  header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .muted { color: #475569; }
  .doc-title { text-align: right; }
  .doc-title h2 { margin: 0; font-size: 16px; letter-spacing: .08em; text-transform: uppercase; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f1f5f9; text-align: left; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; padding: 8px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .label { text-align: right; color: #475569; }
  tr.strong td { font-weight: 700; border-top: 2px solid #0f172a; border-bottom: none; font-size: 14px; }
  .words { margin-top: 8px; font-style: italic; color: #475569; }
  footer { margin-top: 32px; display: flex; justify-content: space-between; align-items: flex-end; }
  .sign { border-top: 1px solid #94a3b8; padding-top: 6px; min-width: 180px; text-align: center; }
  @media print { .noprint { display: none; } }
  .noprint { margin-bottom: 16px; }
  .noprint button { font-size: 14px; padding: 10px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="noprint">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>

<header>
  <div>
    <h1>${esc(business.name)}</h1>
    <div class="muted">${business.addressLines.map(esc).join('<br>')}</div>
    <div class="muted">
      ${business.phone ? esc(business.phone) : ''}
      ${business.email ? ` · ${esc(business.email)}` : ''}
    </div>
    ${business.gstin ? `<div class="muted">GSTIN: ${esc(business.gstin)}</div>` : ''}
  </div>
  <div class="doc-title">
    <h2>${hasTax ? 'Tax Invoice' : 'Bill'}</h2>
    <div><strong>${esc(bill.billNumber)}</strong></div>
    <div class="muted">${esc(Dates.formatDateKey(bill.billDate))}</div>
  </div>
</header>

<div class="parties">
  <div>
    <div class="muted">Billed to</div>
    <strong>${esc(bill.clientName)}</strong>
  </div>
  <div>
    <div class="muted">Project</div>
    <strong>${esc(bill.projectName)}</strong>
  </div>
  <div>
    <div class="muted">Period</div>
    <strong>${esc(Dates.formatDateKey(bill.periodFrom))} to ${esc(Dates.formatDateKey(bill.periodTo))}</strong>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:32px">#</th>
      <th>Description of work</th>
      <th class="num">Quantity</th>
      <th>Unit</th>
      <th class="num">Rate</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    ${totalRow('Subtotal', Money.formatPaise(bill.subtotalPaise))}
    ${bill.tax.cgstAmountPaise > 0 ? totalRow(`CGST @ ${bill.tax.cgstRate}%`, Money.formatPaise(bill.tax.cgstAmountPaise)) : ''}
    ${bill.tax.sgstAmountPaise > 0 ? totalRow(`SGST @ ${bill.tax.sgstRate}%`, Money.formatPaise(bill.tax.sgstAmountPaise)) : ''}
    ${bill.tax.igstAmountPaise > 0 ? totalRow(`IGST @ ${bill.tax.igstRate}%`, Money.formatPaise(bill.tax.igstAmountPaise)) : ''}
    ${bill.deductions.tdsAmountPaise > 0 ? totalRow(`Less TDS @ ${bill.deductions.tdsRate}%`, `- ${Money.formatPaise(bill.deductions.tdsAmountPaise)}`) : ''}
    ${bill.deductions.retentionAmountPaise > 0 ? totalRow(`Less retention @ ${bill.deductions.retentionRate}%`, `- ${Money.formatPaise(bill.deductions.retentionAmountPaise)}`) : ''}
    ${bill.deductions.otherAmountPaise > 0 ? totalRow(`Less ${bill.deductions.otherLabel ?? 'other'}`, `- ${Money.formatPaise(bill.deductions.otherAmountPaise)}`) : ''}
    ${totalRow('Net payable', Money.formatPaise(bill.netAmountPaise), true)}
  </tfoot>
</table>

<p class="words">Rupees ${esc(Money.formatPaiseInWords(bill.netAmountPaise))} only.</p>

${hasDeductions ? '<p class="muted">Deductions shown are as per the agreed contract terms.</p>' : ''}

<footer>
  <div class="muted">This is a computer-generated document.</div>
  <div class="sign">For ${esc(business.name)}</div>
</footer>
</body>
</html>`
}

/**
 * Opens the bill in a new window for printing.
 *
 * Returns false when the browser blocks the pop-up, so the caller can say so
 * rather than appearing to do nothing.
 */
export function openBillForPrint(
  bill: Bill,
  items: readonly BillItem[],
  business: BusinessProfile,
): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(renderBillHtml(bill, items, business))
  win.document.close()
  return true
}
