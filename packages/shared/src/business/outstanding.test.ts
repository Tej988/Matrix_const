import { describe, it, expect } from 'vitest'
import { fromRupees } from '../money/index'
import { calculateOutstanding, headlineAmount, isOverBilled, isOverPaid } from './outstanding'

/** Spec section 42, critical tests 4 and 5. */

describe('the R-01 ambiguity, made explicit', () => {
  it("distinguishes all three readings of the spec's own example", () => {
    // Section 17: Contract 18,50,000 / Billed 10,00,000 / Received 10,00,000,
    // and it labels 8,50,000 as "Client Outstanding".
    const result = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(10_00_000),
      totalReceivedPaise: fromRupees(10_00_000),
    })

    // Billed and received are equal, so nobody owes anything right now.
    expect(result.receivablePaise).toBe(fromRupees(0))

    // The 8,50,000 the spec calls "outstanding" is really unbilled contract.
    expect(result.unbilledBalancePaise).toBe(fromRupees(8_50_000))
    expect(result.contractRemainingPaise).toBe(fromRupees(8_50_000))
  })

  it('separates them once billed and received diverge - the case that proves the point', () => {
    // Section 8's own example: billed 10,00,000, received 7,00,000.
    const result = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(10_00_000),
      totalReceivedPaise: fromRupees(7_00_000),
    })

    expect(result.receivablePaise).toBe(fromRupees(3_00_000)) // owed now
    expect(result.unbilledBalancePaise).toBe(fromRupees(8_50_000)) // left to bill
    expect(result.contractRemainingPaise).toBe(fromRupees(11_50_000)) // left to collect

    // Three different numbers. A dashboard showing one label would mislead.
    const values = new Set(Object.values(result))
    expect(values.size).toBe(3)
  })

  it('never derives receivable from contract value - section 8', () => {
    // If receivable were (wrongly) contract - received, this would be 8,50,000.
    const result = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(2_00_000),
      totalReceivedPaise: fromRupees(10_00_000),
    })
    expect(result.receivablePaise).toBe(fromRupees(-8_00_000))
    expect(result.receivablePaise).not.toBe(fromRupees(8_50_000))
  })
})

describe('the identity holds by construction', () => {
  it.each([
    [18_50_000, 10_00_000, 7_00_000],
    [50_00_000, 0, 0],
    [1_00_000, 1_00_000, 1_00_000],
    [75_000, 80_000, 20_000],
  ])('contract %d, billed %d, received %d', (contract, billed, received) => {
    const r = calculateOutstanding({
      contractValuePaise: fromRupees(contract),
      totalBilledPaise: fromRupees(billed),
      totalReceivedPaise: fromRupees(received),
    })
    expect(r.contractRemainingPaise).toBe(r.receivablePaise + r.unbilledBalancePaise)
    expect(r.contractRemainingPaise).toBe(fromRupees(contract - received))
  })
})

describe('a brand new project', () => {
  it('is entirely unbilled and owes nothing', () => {
    const r = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(0),
      totalReceivedPaise: fromRupees(0),
    })
    expect(r.receivablePaise).toBe(fromRupees(0))
    expect(r.unbilledBalancePaise).toBe(fromRupees(18_50_000))
    expect(isOverBilled(r)).toBe(false)
    expect(isOverPaid(r)).toBe(false)
  })
})

describe('a fully settled project', () => {
  it('leaves nothing anywhere', () => {
    const r = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(18_50_000),
      totalReceivedPaise: fromRupees(18_50_000),
    })
    expect(r.receivablePaise).toBe(fromRupees(0))
    expect(r.unbilledBalancePaise).toBe(fromRupees(0))
    expect(r.contractRemainingPaise).toBe(fromRupees(0))
  })
})

describe('the abnormal cases are surfaced, not clamped', () => {
  it('flags billing past the contract value - a change order, or a mistake', () => {
    const r = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(19_00_000),
      totalReceivedPaise: fromRupees(10_00_000),
    })
    expect(r.unbilledBalancePaise).toBe(fromRupees(-50_000))
    expect(isOverBilled(r)).toBe(true)
  })

  it('flags an advance payment rather than hiding it as zero', () => {
    const r = calculateOutstanding({
      contractValuePaise: fromRupees(18_50_000),
      totalBilledPaise: fromRupees(2_00_000),
      totalReceivedPaise: fromRupees(5_00_000),
    })
    expect(r.receivablePaise).toBe(fromRupees(-3_00_000))
    expect(isOverPaid(r)).toBe(true)
  })
})

describe('headline selection', () => {
  const r = calculateOutstanding({
    contractValuePaise: fromRupees(18_50_000),
    totalBilledPaise: fromRupees(10_00_000),
    totalReceivedPaise: fromRupees(7_00_000),
  })

  it.each([
    ['receivable', 3_00_000],
    ['unbilledBalance', 8_50_000],
    ['contractRemaining', 11_50_000],
  ] as const)('%s reads %d', (figure, expected) => {
    expect(headlineAmount(r, figure)).toBe(fromRupees(expected))
  })
})
