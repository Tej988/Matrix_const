import type {
  BillDeductions,
  BillStatus,
  BillTax,
  MeasurementItem,
  Paise,
  TaxProfile,
} from '@mc/types'
import { sum, percentOf, add, subtract, ZERO } from '../money/index'
import { financialYearOf } from '../datetime/index'
import type { DateKey } from '@mc/types'

/**
 * Bill arithmetic. Section 7.
 *
 * Tax and deductions are computed through the full formula always; with the
 * project's tax profile off (the default, ADR-003) every rate is zero and the
 * result reduces to the subtotal. That is deliberate - one code path, no
 * branch that only runs for GST users and rots untested.
 */

export interface BillLine {
  boqItemId: string
  name: string
  unit: MeasurementItem['unit']
  ratePaise: Paise
  quantity: number
  amountPaise: Paise
}

/**
 * Collapses measurement lines into bill lines, one per BOQ item.
 *
 * A month's measurements may touch the same item across several locations;
 * a bill shows one row per item with the combined quantity, which is how a
 * client expects to read it.
 */
export function consolidateLines(items: readonly MeasurementItem[]): BillLine[] {
  const byBoqItem = new Map<string, BillLine>()

  for (const item of items) {
    const existing = byBoqItem.get(item.boqItemId)
    if (existing) {
      existing.quantity = Math.round((existing.quantity + item.currentQty) * 1000) / 1000
      existing.amountPaise = add(existing.amountPaise, item.amountPaise)
    } else {
      byBoqItem.set(item.boqItemId, {
        boqItemId: item.boqItemId,
        name: item.boqItemName,
        unit: item.unit,
        ratePaise: item.ratePaise,
        quantity: item.currentQty,
        amountPaise: item.amountPaise,
      })
    }
  }

  return [...byBoqItem.values()]
}

export interface BillTotals {
  subtotalPaise: Paise
  tax: BillTax
  deductions: BillDeductions
  netAmountPaise: Paise
}

/**
 * Subtotal, then tax on top, then deductions off the bottom.
 *
 * TDS and retention are computed on the SUBTOTAL, not on the taxed amount -
 * that is the Indian convention for works contracts, and getting it backwards
 * silently overstates every deduction.
 */
export function calculateBill(
  lines: readonly BillLine[],
  profile: TaxProfile,
  otherDeduction: { label?: string; amountPaise: Paise } = { amountPaise: ZERO },
): BillTotals {
  const subtotalPaise = lines.length > 0 ? sum(lines.map((l) => l.amountPaise)) : ZERO

  const cgstRate = profile.mode === 'CGST_SGST' ? profile.cgstRate : 0
  const sgstRate = profile.mode === 'CGST_SGST' ? profile.sgstRate : 0
  const igstRate = profile.mode === 'IGST' ? profile.igstRate : 0

  const tax: BillTax = {
    mode: profile.mode,
    cgstRate,
    cgstAmountPaise: percentOf(subtotalPaise, cgstRate),
    sgstRate,
    sgstAmountPaise: percentOf(subtotalPaise, sgstRate),
    igstRate,
    igstAmountPaise: percentOf(subtotalPaise, igstRate),
  }

  const deductions: BillDeductions = {
    tdsRate: profile.tdsRate,
    tdsAmountPaise: percentOf(subtotalPaise, profile.tdsRate),
    retentionRate: profile.retentionRate,
    retentionAmountPaise: percentOf(subtotalPaise, profile.retentionRate),
    otherAmountPaise: otherDeduction.amountPaise,
    ...(otherDeduction.label ? { otherLabel: otherDeduction.label } : {}),
  }

  const taxTotal = sum([tax.cgstAmountPaise, tax.sgstAmountPaise, tax.igstAmountPaise])
  const deductionTotal = sum([
    deductions.tdsAmountPaise,
    deductions.retentionAmountPaise,
    deductions.otherAmountPaise,
  ])

  return {
    subtotalPaise,
    tax,
    deductions,
    netAmountPaise: subtract(add(subtotalPaise, taxTotal), deductionTotal),
  }
}

// ---------------------------------------------------------------------------
// Bill numbering - assumption A7
// ---------------------------------------------------------------------------

/** `MC/26-27/0007`. The counter is allocated transactionally (R-11). */
export function formatBillNumber(prefix: string, billDate: DateKey, sequence: number): string {
  return `${prefix}/${financialYearOf(billDate)}/${String(sequence).padStart(4, '0')}`
}

/** Counter documents are per financial year, so numbering restarts each April. */
export function counterIdFor(billDate: DateKey): string {
  return `billNumber_${financialYearOf(billDate)}`
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Payment status is derived from money received, never set by hand. A bill
 * marked PAID with nothing received would be a lie the ledger cannot see.
 */
export function paymentStatus(
  netAmountPaise: Paise,
  amountReceivedPaise: Paise,
  current: BillStatus,
): BillStatus {
  if (current === 'CANCELLED' || current === 'DRAFT') return current
  if (amountReceivedPaise <= 0) return current === 'SENT' ? 'SENT' : 'GENERATED'
  if (amountReceivedPaise >= netAmountPaise) return 'PAID'
  return 'PARTIALLY_PAID'
}

const TRANSITIONS: Record<BillStatus, readonly BillStatus[]> = {
  DRAFT: ['GENERATED', 'CANCELLED'],
  GENERATED: ['SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'CANCELLED'],
  // A paid bill is settled. Correcting it means a credit note, not an edit.
  PAID: ['CANCELLED'],
  CANCELLED: [],
}

export function canTransitionBill(from: BillStatus, to: BillStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isBillEditable(status: BillStatus): boolean {
  return status === 'DRAFT'
}

/** Outstanding on a single bill. Cancelled bills owe nothing. */
export function billOutstanding(bill: {
  netAmountPaise: Paise
  amountReceivedPaise: Paise
  status: BillStatus
}): Paise {
  if (bill.status === 'CANCELLED' || bill.status === 'DRAFT') return ZERO
  return subtract(bill.netAmountPaise, bill.amountReceivedPaise)
}
