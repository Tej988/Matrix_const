import { describe, it, expect } from 'vitest'
import { fromRupees } from '../money/index'
import {
  computeProjectSummary,
  emptySummary,
  detectDrift,
  hasDrift,
  type SummarySources,
} from './projectSummary'

const AT = new Date('2026-08-27T06:30:00Z')
const BY = 'uid-owner'

/** The real business case from spec section 3, driven entirely by transactions. */
const tataSources: SummarySources = {
  contractValuePaise: fromRupees(18_50_000),
  billNetAmounts: [fromRupees(6_00_000), fromRupees(4_00_000)],
  confirmedReceipts: [fromRupees(5_00_000), fromRupees(5_00_000)],
  approvedMeasurementAmounts: [fromRupees(3_00_000), fromRupees(7_00_000)],
  lockedWageEarnings: [fromRupees(2_20_000), fromRupees(2_00_000)],
  confirmedLabourPayments: [fromRupees(2_00_000), fromRupees(1_70_000)],
  nonLabourExpenses: [fromRupees(45_000), fromRupees(30_000)],
}

describe('the Tata Project figures, derived not hardcoded', () => {
  const s = computeProjectSummary('proj-tata', tataSources, BY, AT)

  it('reproduces the spec section 17 headline numbers', () => {
    expect(s.contractValuePaise).toBe(fromRupees(18_50_000))
    expect(s.totalBilledPaise).toBe(fromRupees(10_00_000))
    expect(s.totalReceivedPaise).toBe(fromRupees(10_00_000))
    expect(s.labourEarnedPaise).toBe(fromRupees(4_20_000)) // section 3
    expect(s.labourPaidPaise).toBe(fromRupees(3_70_000))
    expect(s.labourPayablePaise).toBe(fromRupees(50_000))
  })

  it('resolves "outstanding" into its three distinct meanings', () => {
    expect(s.receivablePaise).toBe(fromRupees(0))
    expect(s.unbilledBalancePaise).toBe(fromRupees(8_50_000))
    expect(s.contractRemainingPaise).toBe(fromRupees(8_50_000))
  })

  it('computes cash position without calling it profit', () => {
    // out = 3,70,000 labour + 75,000 expenses
    expect(s.otherExpensesPaise).toBe(fromRupees(75_000))
    expect(s.cashOutPaise).toBe(fromRupees(4_45_000))
    // in 10,00,000 - out 4,45,000
    expect(s.netPositionPaise).toBe(fromRupees(5_55_000))
    expect(s).not.toHaveProperty('profitPaise')
  })

  it('tracks measured work separately from billed work', () => {
    // Measured 10,00,000 and billed 10,00,000 happen to agree here, but they
    // are independent quantities and the model keeps them apart.
    expect(s.approvedMeasuredPaise).toBe(fromRupees(10_00_000))
  })

  it('stamps provenance so drift can be spotted later', () => {
    expect(s.computedBy).toBe(BY)
    expect(s.computedAt).toBe(AT)
    expect(s.schemaVersion).toBe(1)
  })
})

describe('determinism - the property that makes drift detection meaningful', () => {
  it('returns identical output for identical input', () => {
    const a = computeProjectSummary('p', tataSources, BY, AT)
    const b = computeProjectSummary('p', tataSources, BY, AT)
    expect(a).toEqual(b)
  })

  it('is unaffected by the order records arrive in', () => {
    const shuffled: SummarySources = {
      ...tataSources,
      billNetAmounts: [...tataSources.billNetAmounts].reverse(),
      confirmedReceipts: [...tataSources.confirmedReceipts].reverse(),
    }
    expect(computeProjectSummary('p', shuffled, BY, AT)).toEqual(
      computeProjectSummary('p', tataSources, BY, AT),
    )
  })
})

describe('a new project', () => {
  const s = emptySummary('p-new', fromRupees(18_50_000), BY, AT)

  it('is all zeroes except the contract, which is entirely unbilled', () => {
    expect(s.totalBilledPaise).toBe(fromRupees(0))
    expect(s.totalReceivedPaise).toBe(fromRupees(0))
    expect(s.labourPayablePaise).toBe(fromRupees(0))
    expect(s.netPositionPaise).toBe(fromRupees(0))
    expect(s.unbilledBalancePaise).toBe(fromRupees(18_50_000))
  })
})

/**
 * The normal case for this business: no agreed total, money follows measured
 * work. RISKS.md R-01.
 */
describe('a project with no contract value', () => {
  const noContract: SummarySources = (() => {
    const { contractValuePaise: _omitted, ...rest } = tataSources
    return rest
  })()

  const s = computeProjectSummary('proj-tata', noContract, BY, AT)

  it('keeps every figure that does not depend on a contract', () => {
    expect(s.totalBilledPaise).toBe(fromRupees(10_00_000))
    expect(s.totalReceivedPaise).toBe(fromRupees(10_00_000))
    expect(s.labourPayablePaise).toBe(fromRupees(50_000))
    expect(s.netPositionPaise).toBe(fromRupees(5_55_000))
  })

  it('nulls the contract-derived figures rather than zeroing them', () => {
    expect(s.contractValuePaise).toBeNull()
    expect(s.unbilledBalancePaise).toBeNull()
    expect(s.contractRemainingPaise).toBeNull()
  })

  it('leaves receivable as the one operative figure', () => {
    const partlyPaid = computeProjectSummary(
      'p',
      { ...noContract, confirmedReceipts: [fromRupees(7_00_000)] },
      BY,
      AT,
    )
    expect(partlyPaid.receivablePaise).toBe(fromRupees(3_00_000))
  })

  it('starts a new project with no contract at all zeroes and no nonsense', () => {
    const fresh = emptySummary('p-new', null, BY, AT)
    expect(fresh.contractValuePaise).toBeNull()
    expect(fresh.unbilledBalancePaise).toBeNull()
    expect(fresh.receivablePaise).toBe(fromRupees(0))

    // undefined is the same statement as null - a form that left the field
    // blank must not produce a different document from one that cleared it.
    expect(emptySummary('p-new', undefined, BY, AT)).toEqual(fresh)
  })
})

describe('double-counting guards', () => {
  it('excludes labour-category expenses, which the caller must filter out', () => {
    // labourPaid already covers wages; nonLabourExpenses must not repeat them.
    const s = computeProjectSummary(
      'p',
      {
        ...tataSources,
        confirmedLabourPayments: [fromRupees(3_70_000)],
        nonLabourExpenses: [fromRupees(75_000)],
      },
      BY,
      AT,
    )
    expect(s.cashOutPaise).toBe(fromRupees(4_45_000))
  })

  it('counts only what the caller passes - status filtering is the repository job', () => {
    // Passing no receipts must yield zero received, never "infer from bills".
    const s = computeProjectSummary('p', { ...tataSources, confirmedReceipts: [] }, BY, AT)
    expect(s.totalReceivedPaise).toBe(fromRupees(0))
    expect(s.receivablePaise).toBe(fromRupees(10_00_000))
  })
})

describe('drift detection - R-04', () => {
  const derived = computeProjectSummary('p', tataSources, BY, AT)

  it('reports nothing when the stored summary agrees', () => {
    expect(detectDrift({ ...derived }, derived)).toEqual([])
    expect(hasDrift({ ...derived }, derived)).toBe(false)
  })

  it('reports nothing when there is no stored summary yet', () => {
    expect(detectDrift(null, derived)).toEqual([])
  })

  it('names every field that disagrees, with the signed difference', () => {
    const stale = {
      ...derived,
      totalReceivedPaise: fromRupees(9_00_000),
      receivablePaise: fromRupees(1_00_000),
    }
    const drift = detectDrift(stale, derived)

    expect(drift).toHaveLength(2)
    expect(drift.map((d) => d.field).sort()).toEqual(['receivablePaise', 'totalReceivedPaise'])

    const received = drift.find((d) => d.field === 'totalReceivedPaise')
    expect(received?.stored).toBe(fromRupees(9_00_000))
    expect(received?.derived).toBe(fromRupees(10_00_000))
    expect(received?.differencePaise).toBe(fromRupees(1_00_000))
  })

  it('reports no drift when neither side has a contract value', () => {
    // Both null. Comparing them as numbers would have made every
    // measure-and-bill project permanently "out of sync" on the
    // reconciliation screen.
    const noContract = computeProjectSummary(
      'p',
      { ...tataSources, contractValuePaise: null },
      BY,
      AT,
    )
    expect(detectDrift({ ...noContract }, noContract)).toEqual([])
  })

  it('stays silent when a contract value was added or removed', () => {
    // Only one side has a figure. There is no honest amount to print in the
    // "correct" column, and the reconciliation write replaces the whole
    // document anyway.
    const withContract = computeProjectSummary('p', tataSources, BY, AT)
    const withoutContract = computeProjectSummary(
      'p',
      { ...tataSources, contractValuePaise: null },
      BY,
      AT,
    )
    expect(detectDrift(withoutContract, withContract)).toEqual([])
    expect(detectDrift(withContract, withoutContract)).toEqual([])
  })

  it('still catches a wrong contract value when both sides have one', () => {
    const stale = { ...derived, contractValuePaise: fromRupees(18_00_000) }
    const drift = detectDrift(stale, derived)
    expect(drift).toHaveLength(1)
    expect(drift[0]?.field).toBe('contractValuePaise')
    expect(drift[0]?.differencePaise).toBe(fromRupees(50_000))
  })

  it('catches a single paisa, because a rounding bug starts that small', () => {
    const off = { ...derived, netPositionPaise: (derived.netPositionPaise - 1) as never }
    expect(hasDrift(off, derived)).toBe(true)
  })
})
