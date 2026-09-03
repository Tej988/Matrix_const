import { describe, it, expect } from 'vitest'
import type { BoqItem, Paise } from '@mc/types'
import { fromRupees } from '../money/index'
import {
  contractAmount,
  hasContractQty,
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

/** Everything an item has whether or not a quantity was ever agreed. */
const base = {
  id: 'b1',
  projectId: 'p1',
  code: 'FLO-01',
  name: 'Flooring',
  unit: 'SQFT',
  ratePaise: fromRupees(120),
  completedQty: 0,
  billedQty: 0,
  sortOrder: 0,
  status: 'ACTIVE',
} satisfies Omit<BoqItem, 'contractQty' | 'contractAmountPaise'>

/** A fixed-quantity item: the exception now, but still fully supported. */
const item = (over: Partial<BoqItem> = {}): BoqItem => ({
  ...base,
  contractQty: 10_000,
  contractAmountPaise: fromRupees(12_00_000),
  ...over,
})

/**
 * A rate-only item: no contract quantity, no contract amount. The normal shape
 * of this business's work, and the reason the section 4 ceiling is optional.
 */
const rateOnly = (over: Partial<BoqItem> = {}): BoqItem => ({ ...base, ...over })

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

describe('whether an item has a contract quantity at all', () => {
  it('is true for a fixed-quantity item and false for a rate-only one', () => {
    expect(hasContractQty(item())).toBe(true)
    expect(hasContractQty(rateOnly())).toBe(false)
  })

  it('treats an explicit null the same as an absent field', () => {
    // A stored document can arrive either way. Both mean "never agreed".
    expect(hasContractQty({ contractQty: null } as unknown as BoqItem)).toBe(false)
  })

  it('does NOT treat a genuine zero as absent', () => {
    // A contract quantity of 0 is a strange contract, but it is a stated one -
    // and it is a real ceiling, not a missing field.
    expect(hasContractQty(item({ contractQty: 0 }))).toBe(true)
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

/**
 * The null-not-zero rule, applied one level below R-01.
 *
 * Zero would be read as "this item is finished" or "0% done and no more to
 * do". Both are lies about an item whose whole point is that the quantity is
 * decided by the work.
 */
describe('an item with NO contract quantity', () => {
  it('has no remaining quantity - null, not zero', () => {
    expect(remainingQty(rateOnly())).toBeNull()
    expect(remainingQty(rateOnly({ completedQty: 1_250 }))).toBeNull()
  })

  it('has no completion percentage - null, not zero', () => {
    expect(completionPercent(rateOnly())).toBeNull()
    expect(completionPercent(rateOnly({ completedQty: 1_250 }))).toBeNull()
  })

  it('treats an explicit null exactly like an absent field', () => {
    const stored = { ...rateOnly(), contractQty: null } as unknown as BoqItem
    expect(remainingQty(stored)).toBeNull()
    expect(completionPercent(stored)).toBeNull()
  })

  it('still reports what has been billed against what was measured', () => {
    // The figure that DOES survive: measured, and of that, billed. No contract
    // quantity is needed for either.
    expect(unbilledQty(rateOnly({ completedQty: 1_250, billedQty: 500 }))).toBe(750)
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

/**
 * With no contract quantity there is no ceiling, so EXCEEDS_CONTRACT is
 * unreachable - not suppressed, not defaulted past, simply not a thing that
 * can be computed. Everything else about the entry is still checked.
 */
describe('the section 4 rule where there IS no contract quantity', () => {
  for (const [label, contractQty] of [
    ['absent', undefined],
    ['explicitly null', null],
  ] as const) {
    describe(`contract quantity ${label}`, () => {
      const input = {
        contractQty,
        completedQty: 0,
        currentQty: 1_250,
        ratePaise: fromRupees(65),
      }

      it('accepts the measurement and prices it at the quoted rate', () => {
        const r = validateQuantity(input)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.totalQty).toBe(1_250)
        expect(r.amountPaise).toBe(fromRupees(81_250))
        // Not a change order: nothing was agreed to depart from.
        expect(r.isChangeOrder).toBe(false)
      })

      it('accepts a quantity that would have blown any plausible contract', () => {
        const r = validateQuantity({ ...input, completedQty: 9_00_000, currentQty: 9_00_000 })
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.isChangeOrder).toBe(false)
      })

      it('CANNOT return EXCEEDS_CONTRACT, with or without a change order', () => {
        for (const changeOrderApproved of [true, false]) {
          const r = validateQuantity({ ...input, completedQty: 1e9, changeOrderApproved })
          expect(r.ok).toBe(true)
          if (r.ok) expect(r.isChangeOrder).toBe(false)
        }
      })

      it('still rejects zero and negative quantities', () => {
        for (const q of [0, -5]) {
          const r = validateQuantity({ ...input, currentQty: q })
          expect(r.ok).toBe(false)
          if (!r.ok) expect(r.rejection.reason).toBe('NOT_POSITIVE')
        }
      })

      it('still rejects a non-finite quantity', () => {
        for (const q of [Number.NaN, Number.POSITIVE_INFINITY]) {
          const r = validateQuantity({ ...input, currentQty: q })
          expect(r.ok).toBe(false)
          if (!r.ok) expect(r.rejection.reason).toBe('NOT_FINITE')
        }
      })
    })
  }

  it('leaves the ceiling in place for an item that DOES carry one', () => {
    // The decision is per item. A rate-only line and a fixed-quantity line can
    // sit on the same rate card, and only one of them has a ceiling.
    const noCeiling = validateQuantity({
      contractQty: undefined,
      completedQty: 9_000,
      currentQty: 2_000,
      ratePaise: fromRupees(120),
    })
    const ceiling = validateQuantity({
      contractQty: 10_000,
      completedQty: 9_000,
      currentQty: 2_000,
      ratePaise: fromRupees(120),
    })
    expect(noCeiling.ok).toBe(true)
    expect(ceiling.ok).toBe(false)
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
    expect(t.itemsWithContractQty).toBe(3)
    expect(t.itemsWithoutContractQty).toBe(0)
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
    // Null, not 0%: there is nothing on the card to be a percentage of.
    expect(t.completionPercent).toBeNull()
    expect(t.remainingValuePaise).toBeNull()
  })

  it('reports 0% when the contract-bearing items are all priced at nil', () => {
    // Owner-supplied material: measured, agreed in quantity, charged at nothing.
    // A denominator exists, it is just zero rupees.
    const t = boqTotals([
      item({ ratePaise: fromRupees(0), contractAmountPaise: fromRupees(0), completedQty: 500 }),
    ])
    expect(t.completionPercent).toBe(0)
    expect(t.remainingValuePaise).toBe(fromRupees(0))
  })

  it('tolerates a stored item that kept its quantity but lost its amount', () => {
    // Defensive: the two fields travel together and Rules enforce it, but a
    // half-written legacy document must not make the whole total NaN.
    const t = boqTotals([{ ...base, contractQty: 10_000 }])
    expect(t.itemsWithContractQty).toBe(1)
    expect(t.contractValuePaise).toBe(fromRupees(0))
  })
})

/**
 * The rate card this business actually keeps: rates, no quantities. The totals
 * have to say what they know and stay silent about what they do not.
 */
describe('roll-ups over a rate card with no quantities', () => {
  const card = [
    rateOnly({ id: 'a', name: 'Flooring Polish', unit: 'SQFT', ratePaise: fromRupees(65) }),
    rateOnly({ id: 'b', name: 'Riser Polish', unit: 'RFT', ratePaise: fromRupees(65) }),
    rateOnly({ id: 'c', name: 'Wall cladding polish', ratePaise: fromRupees(125) }),
  ]

  it('counts the items it could not value, so the UI can say so', () => {
    const t = boqTotals(card)
    expect(t.itemCount).toBe(3)
    expect(t.itemsWithContractQty).toBe(0)
    expect(t.itemsWithoutContractQty).toBe(3)
  })

  it('reports no contract value, no remaining value and no percentage', () => {
    const t = boqTotals(card)
    expect(t.contractValuePaise).toBe(fromRupees(0))
    expect(t.remainingValuePaise).toBeNull()
    expect(t.completionPercent).toBeNull()
  })

  it('still totals what HAS been measured and billed - the figures that matter', () => {
    const t = boqTotals([
      rateOnly({ id: 'a', ratePaise: fromRupees(65), completedQty: 1_000, billedQty: 400 }),
      rateOnly({ id: 'b', ratePaise: fromRupees(125), completedQty: 200, billedQty: 0 }),
    ])
    expect(t.completedValuePaise).toBe(fromRupees(65_000 + 25_000))
    expect(t.billedValuePaise).toBe(fromRupees(26_000))
  })

  it('totals a mixed card over only the rows that have a contract', () => {
    // 12,00,000 of contract across one row, and a second row that has none.
    const t = boqTotals([
      item({ id: 'a', completedQty: 2_500 }),
      rateOnly({ id: 'b', ratePaise: fromRupees(65), completedQty: 1_000 }),
    ])
    expect(t.itemsWithContractQty).toBe(1)
    expect(t.itemsWithoutContractQty).toBe(1)
    expect(t.contractValuePaise).toBe(fromRupees(12_00_000))
    // Measured value covers both rows: 3,00,000 + 65,000.
    expect(t.completedValuePaise).toBe(fromRupees(3_65_000))
    // The percentage compares like with like - 3,00,000 of 12,00,000 - rather
    // than crediting the rate-only row's money against a total it is not in.
    expect(t.completionPercent).toBe(25)
    expect(t.remainingValuePaise).toBe(fromRupees(9_00_000))
  })
})

describe('contract coverage', () => {
  const items = [item({ contractAmountPaise: fromRupees(12_00_000) })]

  it('flags a BOQ that does not add up to the project contract value', () => {
    const c = contractCoverage(items, fromRupees(18_50_000))
    expect(c?.boqTotalPaise).toBe(fromRupees(12_00_000))
    expect(c?.contractValuePaise).toBe(fromRupees(18_50_000))
    expect(c?.differencePaise).toBe(fromRupees(6_50_000))
    expect(c?.matches).toBe(false)
  })

  it('reports a match when they agree exactly', () => {
    expect(contractCoverage(items, fromRupees(12_00_000))?.matches).toBe(true)
  })

  it('reports a negative difference when the BOQ exceeds the contract', () => {
    expect(contractCoverage(items, fromRupees(10_00_000))?.differencePaise).toBe(
      fromRupees(-2_00_000) as Paise,
    )
  })

  it('has nothing to say when the project has no contract value', () => {
    // R-01: the rate card is the only agreed figure on a measure-and-bill job,
    // so "the rate card totals X but the contract is Y" has no Y. Null, not a
    // match - a match would claim an agreement that was never checked.
    expect(contractCoverage(items, null)).toBeNull()
    expect(contractCoverage(items, undefined)).toBeNull()
  })

  it('has nothing to say when the rate card carries no quantities', () => {
    // The same invented comparison from the other side: a rate-only card totals
    // ₹0, and "₹0 against an ₹18,50,000 contract" is arithmetic on a figure
    // that was never meant to add up.
    expect(contractCoverage([rateOnly()], fromRupees(18_50_000))).toBeNull()
  })

  it('still compares when at least one item carries a quantity', () => {
    const c = contractCoverage([item(), rateOnly({ id: 'b' })], fromRupees(18_50_000))
    expect(c?.boqTotalPaise).toBe(fromRupees(12_00_000))
  })

  it('reports the whole contract as unitemised when the rate card is empty', () => {
    // Nothing has been entered yet, which is a real and useful thing to see.
    expect(contractCoverage([], fromRupees(18_50_000))?.differencePaise).toBe(fromRupees(18_50_000))
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
