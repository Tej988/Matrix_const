import { describe, it, expect } from 'vitest'
import type { BillStatus, MeasurementItem, TaxProfile } from '@mc/types'
import { NO_TAX } from '@mc/types'
import { fromRupees } from '../money/index'
import { dateKey } from '../datetime/index'
import {
  consolidateLines,
  calculateBill,
  formatBillNumber,
  counterIdFor,
  paymentStatus,
  canTransitionBill,
  isBillEditable,
  billOutstanding,
  type BillLine,
} from './billCalculator'

const mItem = (over: Partial<MeasurementItem> = {}): MeasurementItem => ({
  id: 'm1',
  boqItemId: 'boq-flo',
  boqItemName: 'Flooring',
  location: 'Block A',
  unit: 'SQFT',
  ratePaise: fromRupees(120),
  previousQty: 0,
  currentQty: 2500,
  totalQty: 2500,
  amountPaise: fromRupees(3_00_000),
  isChangeOrder: false,
  ...over,
})

const line = (over: Partial<BillLine> = {}): BillLine => ({
  boqItemId: 'boq-flo',
  name: 'Flooring',
  unit: 'SQFT',
  ratePaise: fromRupees(120),
  quantity: 2500,
  amountPaise: fromRupees(3_00_000),
  ...over,
})

describe('consolidating measurement lines', () => {
  it('merges the same BOQ item across locations into one bill row', () => {
    const lines = consolidateLines([
      mItem({ location: 'Block A', currentQty: 2500, amountPaise: fromRupees(3_00_000) }),
      mItem({ id: 'm2', location: 'Block B', currentQty: 1500, amountPaise: fromRupees(1_80_000) }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(4000)
    expect(lines[0]?.amountPaise).toBe(fromRupees(4_80_000))
  })

  it('keeps different BOQ items apart', () => {
    const lines = consolidateLines([
      mItem(),
      mItem({ id: 'm2', boqItemId: 'boq-pla', boqItemName: 'Plaster' }),
    ])
    expect(lines).toHaveLength(2)
  })

  it('handles an empty measurement set', () => {
    expect(consolidateLines([])).toEqual([])
  })
})

/** Spec section 42, critical test 4 - the default, tax-off path. */
describe('with tax off - the ADR-003 default', () => {
  const totals = calculateBill([line()], NO_TAX)

  it('reduces to the subtotal', () => {
    expect(totals.subtotalPaise).toBe(fromRupees(3_00_000))
    expect(totals.netAmountPaise).toBe(fromRupees(3_00_000))
  })

  it('still carries every tax and deduction field, all zero', () => {
    expect(totals.tax.mode).toBe('NONE')
    expect(totals.tax.cgstAmountPaise).toBe(fromRupees(0))
    expect(totals.tax.igstAmountPaise).toBe(fromRupees(0))
    expect(totals.deductions.tdsAmountPaise).toBe(fromRupees(0))
    expect(totals.deductions.retentionAmountPaise).toBe(fromRupees(0))
  })

  it('sums multiple lines exactly', () => {
    const t = calculateBill(
      [line(), line({ boqItemId: 'b2', amountPaise: fromRupees(45_000) })],
      NO_TAX,
    )
    expect(t.netAmountPaise).toBe(fromRupees(3_45_000))
  })

  it('handles a bill with no lines', () => {
    expect(calculateBill([], NO_TAX).netAmountPaise).toBe(fromRupees(0))
  })
})

describe('with CGST + SGST switched on', () => {
  const profile: TaxProfile = {
    ...NO_TAX,
    mode: 'CGST_SGST',
    cgstRate: 9,
    sgstRate: 9,
  }
  const t = calculateBill([line()], profile)

  it('applies 9% each on the subtotal', () => {
    expect(t.tax.cgstAmountPaise).toBe(fromRupees(27_000))
    expect(t.tax.sgstAmountPaise).toBe(fromRupees(27_000))
    expect(t.netAmountPaise).toBe(fromRupees(3_54_000))
  })

  it('leaves IGST at zero - the modes are exclusive', () => {
    expect(t.tax.igstAmountPaise).toBe(fromRupees(0))
  })
})

describe('with IGST switched on', () => {
  const profile: TaxProfile = { ...NO_TAX, mode: 'IGST', igstRate: 18 }
  const t = calculateBill([line()], profile)

  it('applies 18% and leaves CGST/SGST at zero', () => {
    expect(t.tax.igstAmountPaise).toBe(fromRupees(54_000))
    expect(t.tax.cgstAmountPaise).toBe(fromRupees(0))
    expect(t.tax.sgstAmountPaise).toBe(fromRupees(0))
    expect(t.netAmountPaise).toBe(fromRupees(3_54_000))
  })

  it('ignores CGST rates left over from a previous mode', () => {
    // A project switched from CGST_SGST to IGST keeps stale rates on the
    // profile; mode must decide what is applied, not the leftover numbers.
    const stale: TaxProfile = { ...profile, cgstRate: 9, sgstRate: 9 }
    expect(calculateBill([line()], stale).tax.cgstAmountPaise).toBe(fromRupees(0))
  })
})

describe('deductions come off the subtotal, not the taxed total', () => {
  it('computes TDS and retention on the subtotal', () => {
    const profile: TaxProfile = {
      ...NO_TAX,
      mode: 'CGST_SGST',
      cgstRate: 9,
      sgstRate: 9,
      tdsRate: 2,
      retentionRate: 5,
    }
    const t = calculateBill([line()], profile)

    // 2% and 5% of 3,00,000 - NOT of 3,54,000.
    expect(t.deductions.tdsAmountPaise).toBe(fromRupees(6_000))
    expect(t.deductions.retentionAmountPaise).toBe(fromRupees(15_000))

    // 3,00,000 + 54,000 tax - 21,000 deductions
    expect(t.netAmountPaise).toBe(fromRupees(3_33_000))
  })

  it('applies an ad-hoc deduction with its label', () => {
    const t = calculateBill([line()], NO_TAX, {
      label: 'Material advance',
      amountPaise: fromRupees(20_000),
    })
    expect(t.deductions.otherLabel).toBe('Material advance')
    expect(t.netAmountPaise).toBe(fromRupees(2_80_000))
  })
})

/** Assumption A7. Indian FY runs April to March. */
describe('bill numbering', () => {
  it('formats with financial year and a padded sequence', () => {
    expect(formatBillNumber('MC', dateKey('2026-08-27'), 7)).toBe('MC/26-27/0007')
  })

  it('rolls the financial year at April', () => {
    expect(formatBillNumber('MC', dateKey('2026-03-31'), 1)).toBe('MC/25-26/0001')
    expect(formatBillNumber('MC', dateKey('2026-04-01'), 1)).toBe('MC/26-27/0001')
  })

  it('keeps a separate counter per financial year', () => {
    expect(counterIdFor(dateKey('2026-03-31'))).toBe('billNumber_25-26')
    expect(counterIdFor(dateKey('2026-04-01'))).toBe('billNumber_26-27')
  })

  it('pads past four digits without truncating', () => {
    expect(formatBillNumber('MC', dateKey('2026-08-27'), 12345)).toBe('MC/26-27/12345')
  })
})

describe('payment status is derived, never set by hand', () => {
  const net = fromRupees(3_00_000)

  it.each([
    [0, 'GENERATED', 'GENERATED'],
    [0, 'SENT', 'SENT'],
    [1_00_000, 'SENT', 'PARTIALLY_PAID'],
    [3_00_000, 'SENT', 'PAID'],
    [3_50_000, 'SENT', 'PAID'],
  ] as const)('received %d from %s becomes %s', (received, current, expected) => {
    expect(paymentStatus(net, fromRupees(received), current as BillStatus)).toBe(expected)
  })

  it('never resurrects a cancelled bill', () => {
    expect(paymentStatus(net, fromRupees(3_00_000), 'CANCELLED')).toBe('CANCELLED')
  })

  it('leaves a draft alone', () => {
    expect(paymentStatus(net, fromRupees(3_00_000), 'DRAFT')).toBe('DRAFT')
  })
})

describe('status transitions', () => {
  it.each([
    ['DRAFT', 'GENERATED', true],
    ['GENERATED', 'SENT', true],
    ['SENT', 'PAID', true],
    ['PAID', 'CANCELLED', true],
    ['CANCELLED', 'DRAFT', false],
    ['CANCELLED', 'GENERATED', false],
    ['PAID', 'DRAFT', false],
    ['GENERATED', 'DRAFT', false],
  ] as const)('%s -> %s is %s', (from, to, expected) => {
    expect(canTransitionBill(from as BillStatus, to as BillStatus)).toBe(expected)
  })

  it('treats cancellation as terminal', () => {
    for (const to of ['DRAFT', 'GENERATED', 'SENT', 'PAID'] as BillStatus[]) {
      expect(canTransitionBill('CANCELLED', to)).toBe(false)
    }
  })

  it('only allows editing a draft', () => {
    expect(isBillEditable('DRAFT')).toBe(true)
    for (const s of ['GENERATED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as BillStatus[]) {
      expect(isBillEditable(s)).toBe(false)
    }
  })
})

describe('outstanding per bill', () => {
  it('is net minus received', () => {
    expect(
      billOutstanding({
        netAmountPaise: fromRupees(3_00_000),
        amountReceivedPaise: fromRupees(1_00_000),
        status: 'PARTIALLY_PAID',
      }),
    ).toBe(fromRupees(2_00_000))
  })

  it('is zero for a cancelled or draft bill', () => {
    for (const status of ['CANCELLED', 'DRAFT'] as BillStatus[]) {
      expect(
        billOutstanding({
          netAmountPaise: fromRupees(3_00_000),
          amountReceivedPaise: fromRupees(0),
          status,
        }),
      ).toBe(fromRupees(0))
    }
  })
})
