import { describe, it, expect } from 'vitest'
import type { BoqItem, Paise } from '@mc/types'
import { fromRupees } from '../money/index'
import {
  contractAmount,
  remainingQty,
  unbilledQty,
  completionPercent,
  validateQuantity,
  boqTotals,
  contractCoverage,
  suggestCode,
  roundQty,
} from './boqCalculator'

/** Spec section 42, critical tests 1, 2 and 3. */

const item = (over: Partial<BoqItem> = {}): BoqItem => ({
  id: 'b1',
  projectId: 'p1',
  code: 'FLO-01',
  name: 'Flooring',
  unit: 'SQFT',
  contractQty: 10_000,
  ratePaise: fromRupees(120),
  contractAmountPaise: fromRupees(12_00_000),
  completedQty: 0,
  billedQty: 0,
  sortOrder: 0,
  status: 'ACTIVE',
  ...over,
})

describe('contract amount - critical test 1', () => {
  it('computes the section 5 rate card exactly', () => {
    expect(contractAmount(10_000, fromRupees(120))).toBe(fromRupees(12_00_000)) // Flooring
    expect(contractAmount(5_000, fromRupees(45))).toBe(fromRupees(2_25_000)) // Plaster
    expect(contractAmount(8_000, fromRupees(35))).toBe(fromRupees(2_80_000)) // Painting
  })

  it('handles fractional quantities without drift', () => {
    expect(contractAmount(1250.755, fromRupees(45))).toBe(5628398)
  })

  it('rounds quantities to three decimals', () => {
    expect(roundQty(1250.7554)).toBe(1250.755)
    expect(roundQty(1250.7556)).toBe(1250.756)
  })

  it('rejects a non-finite quantity', () => {
    expect(() => contractAmount(Number.NaN, fromRupees(120))).toThrow(TypeError)
  })
})

describe('remaining and unbilled quantities', () => {
  it('reports what is left to measure', () => {
    expect(remainingQty(item({ completedQty: 2500 }))).toBe(7500)
    expect(remainingQty(item({ completedQty: 10_000 }))).toBe(0)
  })

  it('reports approved work not yet billed', () => {
    expect(unbilledQty(item({ completedQty: 2500, billedQty: 1000 }))).toBe(1500)
  })

  it('avoids float artefacts in subtraction', () => {
    // 0.3 - 0.1 is 0.19999999999999998 in raw float.
    expect(remainingQty(item({ contractQty: 0.3, completedQty: 0.1 }))).toBe(0.2)
  })

  it('reports completion as a percentage of quantity', () => {
    expect(completionPercent(item({ completedQty: 2500 }))).toBe(25)
    expect(completionPercent(item({ contractQty: 0 }))).toBe(0)
  })
})

/** Section 4. The rule that stops overbilling before it reaches a bill. */
describe('the contract-quantity rule - critical tests 2 and 3', () => {
  it('accepts a measurement inside the contract quantity', () => {
    const r = validateQuantity({
      contractQty: 10_000,
      completedQty: 0,
      currentQty: 2500,
      ratePaise: fromRupees(120),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.totalQty).toBe(2500)
    expect(r.amountPaise).toBe(fromRupees(3_00_000)) // the section 6 example
    expect(r.isChangeOrder).toBe(false)
  })

  it('accepts a measurement that lands exactly on the contract quantity', () => {
    const r = validateQuantity({
      contractQty: 10_000,
      completedQty: 7_500,
      currentQty: 2_500,
      ratePaise: fromRupees(120),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.isChangeOrder).toBe(false)
  })

  it('REJECTS a measurement that would exceed the contract quantity', () => {
    const r = validateQuantity({
      contractQty: 10_000,
      completedQty: 9_000,
      currentQty: 2_000,
      ratePaise: fromRupees(120),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejection.reason).toBe('EXCEEDS_CONTRACT')
    if (r.rejection.reason !== 'EXCEEDS_CONTRACT') return
    expect(r.rejection.excessQty).toBe(1_000)
    expect(r.rejection.allowedQty).toBe(1_000)
  })

  it('rejects by a single unit - the boundary is exact', () => {
    const r = validateQuantity({
      contractQty: 10_000,
      completedQty: 10_000,
      currentQty: 1,
      ratePaise: fromRupees(120),
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.rejection.reason === 'EXCEEDS_CONTRACT') {
      expect(r.rejection.allowedQty).toBe(0)
    }
  })

  it('allows the overshoot ONLY with an explicit change order', () => {
    const input = {
      contractQty: 10_000,
      completedQty: 9_000,
      currentQty: 2_000,
      ratePaise: fromRupees(120),
    }
    expect(validateQuantity(input).ok).toBe(false)

    const approved = validateQuantity({ ...input, changeOrderApproved: true })
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.isChangeOrder).toBe(true)
    expect(approved.totalQty).toBe(11_000)
  })

  it('does not treat a missing flag as approval', () => {
    // The override must be a deliberate `true`, never a default.
    for (const flag of [undefined, false]) {
      const r = validateQuantity({
        contractQty: 100,
        completedQty: 100,
        currentQty: 1,
        ratePaise: fromRupees(10),
        ...(flag === undefined ? {} : { changeOrderApproved: flag }),
      })
      expect(r.ok).toBe(false)
    }
  })

  it('rejects zero and negative quantities', () => {
    for (const q of [0, -5]) {
      const r = validateQuantity({
        contractQty: 100,
        completedQty: 0,
        currentQty: q,
        ratePaise: fromRupees(10),
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.rejection.reason).toBe('NOT_POSITIVE')
    }
  })

  it('rejects a non-finite quantity without throwing', () => {
    const r = validateQuantity({
      contractQty: 100,
      completedQty: 0,
      currentQty: Number.NaN,
      ratePaise: fromRupees(10),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('NOT_FINITE')
  })

  it('is evaluated against live completed quantity - the R-13 race', () => {
    // Two supervisors each draft 600 against 10,000 with 9,000 done. Both look
    // fine in isolation; the second must fail once the first is approved.
    const before = { contractQty: 10_000, completedQty: 9_000, ratePaise: fromRupees(120) }
    expect(validateQuantity({ ...before, currentQty: 600 }).ok).toBe(true)

    const after = { ...before, completedQty: 9_600 }
    expect(validateQuantity({ ...after, currentQty: 600 }).ok).toBe(false)
  })
})

describe('roll-ups', () => {
  const items = [
    item({
      id: 'a',
      contractQty: 10_000,
      ratePaise: fromRupees(120),
      contractAmountPaise: fromRupees(12_00_000),
      completedQty: 2_500,
      billedQty: 2_500,
    }),
    item({
      id: 'b',
      code: 'PLA-01',
      name: 'Plaster',
      contractQty: 5_000,
      ratePaise: fromRupees(45),
      contractAmountPaise: fromRupees(2_25_000),
      completedQty: 1_000,
      billedQty: 0,
    }),
    item({
      id: 'c',
      code: 'PAI-01',
      name: 'Painting',
      contractQty: 8_000,
      ratePaise: fromRupees(35),
      contractAmountPaise: fromRupees(2_80_000),
    }),
  ]

  it('totals the rate card', () => {
    const t = boqTotals(items)
    expect(t.itemCount).toBe(3)
    expect(t.contractValuePaise).toBe(fromRupees(17_05_000))
    expect(t.completedValuePaise).toBe(fromRupees(3_45_000)) // 3,00,000 + 45,000
    expect(t.billedValuePaise).toBe(fromRupees(3_00_000))
    expect(t.remainingValuePaise).toBe(fromRupees(13_60_000))
  })

  it('reports completion by value, not by row count', () => {
    // One of three rows is partly done, but only 20.2% of the money.
    expect(boqTotals(items).completionPercent).toBe(20.2)
  })

  it('handles an empty rate card without dividing by zero', () => {
    const t = boqTotals([])
    expect(t.contractValuePaise).toBe(fromRupees(0))
    expect(t.completionPercent).toBe(0)
  })
})

describe('contract coverage', () => {
  const items = [item({ contractAmountPaise: fromRupees(12_00_000) })]

  it('flags a BOQ that does not add up to the project contract value', () => {
    const c = contractCoverage(items, fromRupees(18_50_000))
    expect(c.boqTotalPaise).toBe(fromRupees(12_00_000))
    expect(c.differencePaise).toBe(fromRupees(6_50_000))
    expect(c.matches).toBe(false)
  })

  it('reports a match when they agree exactly', () => {
    expect(contractCoverage(items, fromRupees(12_00_000)).matches).toBe(true)
  })

  it('reports a negative difference when the BOQ exceeds the contract', () => {
    expect(contractCoverage(items, fromRupees(10_00_000)).differencePaise).toBe(
      fromRupees(-2_00_000) as Paise,
    )
  })
})

describe('code suggestion', () => {
  it('derives a prefix from the item name', () => {
    expect(suggestCode('Flooring', [])).toBe('FLO-01')
    expect(suggestCode('Plaster', [])).toBe('PLA-01')
  })

  it('avoids collisions', () => {
    expect(suggestCode('Flooring', ['FLO-01', 'FLO-02'])).toBe('FLO-03')
  })

  it('falls back when the name has no letters', () => {
    expect(suggestCode('123', [])).toBe('ITM-01')
  })
})
