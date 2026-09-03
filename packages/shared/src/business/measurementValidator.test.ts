import { describe, it, expect } from 'vitest'
import {
  ROLES,
  type BoqItem,
  type MeasurementItem,
  type MeasurementStatus,
  type Role,
} from '@mc/types'
import { fromRupees } from '../money/index'
import {
  validateMeasurement,
  canTransition,
  canPerformTransition,
  isBillable,
  completedQtyDeltas,
} from './measurementValidator'

const flooring: BoqItem = {
  id: 'boq-flo',
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
}

const plaster: BoqItem = {
  ...flooring,
  id: 'boq-pla',
  code: 'PLA-01',
  name: 'Plaster',
  contractQty: 5_000,
  ratePaise: fromRupees(45),
  contractAmountPaise: fromRupees(2_25_000),
}

/**
 * A rate-only item: quoted by rate, quantity decided by the work. The usual
 * shape, and the one with no section 4 ceiling. Built by omission rather than
 * by setting the fields to 0 - that distinction is the whole point.
 */
const polish: BoqItem = {
  id: 'boq-pol',
  projectId: 'p1',
  code: 'POL-01',
  name: 'Flooring Polish',
  unit: 'SQFT',
  ratePaise: fromRupees(65),
  completedQty: 0,
  billedQty: 0,
  sortOrder: 2,
  status: 'ACTIVE',
}

describe('the section 6 worked example', () => {
  it('prices Block A 2500 sq.ft of flooring at ₹3,00,000', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block A', currentQty: 2500 }],
      [flooring],
    )
    expect(r.ok).toBe(true)
    expect(r.totalAmountPaise).toBe(fromRupees(3_00_000))
    expect(r.lines[0]?.previousQty).toBe(0)
    expect(r.lines[0]?.totalQty).toBe(2500)
    expect(r.lines[0]?.isChangeOrder).toBe(false)
  })

  it('totals a multi-item sheet', () => {
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-flo', location: 'Block A', currentQty: 2500 },
        { boqItemId: 'boq-pla', location: 'Block A', currentQty: 1000 },
      ],
      [flooring, plaster],
    )
    // 3,00,000 + 45,000
    expect(r.totalAmountPaise).toBe(fromRupees(3_45_000))
    expect(r.lines).toHaveLength(2)
  })
})

describe('optional line description', () => {
  it('carries a description through when one is given', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block A', currentQty: 100, description: 'North wing' }],
      [flooring],
    )
    expect(r.lines[0]?.description).toBe('North wing')
  })

  it('omits the key entirely when none is given', () => {
    // Firestore rejects an explicit undefined, so the property must be absent
    // rather than present-and-undefined.
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block A', currentQty: 100 }],
      [flooring],
    )
    expect('description' in (r.lines[0] ?? {})).toBe(false)
  })
})

describe('previous quantity comes from the live rate card', () => {
  it('carries forward what is already completed', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block B', currentQty: 2000 }],
      [{ ...flooring, completedQty: 2500 }],
    )
    expect(r.lines[0]?.previousQty).toBe(2500)
    expect(r.lines[0]?.totalQty).toBe(4500)
  })
})

/**
 * The subtle one. Two lines on the SAME sheet against the same BOQ item must
 * accumulate, or a sheet could list Block A 6,000 and Block B 6,000 against a
 * 10,000 contract and each would pass in isolation.
 */
describe('lines against the same BOQ item accumulate within a sheet', () => {
  it('checks the second line against the first', () => {
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-flo', location: 'Block A', currentQty: 6000 },
        { boqItemId: 'boq-flo', location: 'Block B', currentQty: 6000 },
      ],
      [flooring],
    )
    expect(r.ok).toBe(false)
    expect(r.lines).toHaveLength(1)
    expect(r.rejections).toHaveLength(1)
    const rej = r.rejections[0]
    expect(rej?.reason).toBe('EXCEEDS_CONTRACT')
    if (rej?.reason === 'EXCEEDS_CONTRACT') {
      expect(rej.completedQty).toBe(6000)
      expect(rej.excessQty).toBe(2000)
    }
  })

  it('accepts two lines that together stay inside the contract', () => {
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-flo', location: 'Block A', currentQty: 4000 },
        { boqItemId: 'boq-flo', location: 'Block B', currentQty: 6000 },
      ],
      [flooring],
    )
    expect(r.ok).toBe(true)
    expect(r.lines[1]?.previousQty).toBe(4000)
    expect(r.lines[1]?.totalQty).toBe(10_000)
    expect(r.totalAmountPaise).toBe(fromRupees(12_00_000))
  })
})

describe('overbilling prevention - critical tests 2 and 3', () => {
  it('rejects a sheet that would exceed the contract quantity', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block C', currentQty: 2000 }],
      [{ ...flooring, completedQty: 9000 }],
    )
    expect(r.ok).toBe(false)
    expect(r.totalAmountPaise).toBe(fromRupees(0))
  })

  it('permits it with an explicit change order and flags the line', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-flo', location: 'Block C', currentQty: 2000 }],
      [{ ...flooring, completedQty: 9000 }],
      { changeOrderApproved: true },
    )
    expect(r.ok).toBe(true)
    expect(r.hasChangeOrder).toBe(true)
    expect(r.lines[0]?.isChangeOrder).toBe(true)
  })

  it('rejects a line referencing an unknown BOQ item', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'nope', location: 'X', currentQty: 10 }],
      [flooring],
    )
    expect(r.ok).toBe(false)
    expect(r.rejections[0]?.boqItemName).toBe('Unknown item')
  })

  it('is not ok when there are no lines at all', () => {
    expect(validateMeasurement([], [flooring]).ok).toBe(false)
  })

  it('keeps valid lines while reporting the invalid ones', () => {
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-flo', location: 'A', currentQty: 1000 },
        { boqItemId: 'boq-pla', location: 'A', currentQty: 99_999 },
      ],
      [flooring, plaster],
    )
    expect(r.ok).toBe(false)
    expect(r.lines).toHaveLength(1)
    expect(r.rejections).toHaveLength(1)
  })
})

/**
 * The guard applies PER ITEM. A sheet can carry both kinds of line, and each is
 * judged on what its own rate card row actually agreed.
 */
describe('lines against an item with no contract quantity', () => {
  it('accepts the measurement and prices it at the quoted rate', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-pol', location: 'Lobby', currentQty: 1_250 }],
      [polish],
    )
    expect(r.ok).toBe(true)
    expect(r.totalAmountPaise).toBe(fromRupees(81_250))
    expect(r.lines[0]?.isChangeOrder).toBe(false)
  })

  it('accepts a quantity no contract would have allowed', () => {
    const r = validateMeasurement(
      [{ boqItemId: 'boq-pol', location: 'Lobby', currentQty: 5_00_000 }],
      [{ ...polish, completedQty: 5_00_000 }],
    )
    expect(r.ok).toBe(true)
    expect(r.rejections).toHaveLength(0)
    expect(r.hasChangeOrder).toBe(false)
  })

  it('still carries forward what has already been measured', () => {
    // No ceiling does not mean no history: previousQty and totalQty are what
    // the bill and the running total are built from.
    const r = validateMeasurement(
      [{ boqItemId: 'boq-pol', location: 'Lobby', currentQty: 500 }],
      [{ ...polish, completedQty: 1_250 }],
    )
    expect(r.lines[0]?.previousQty).toBe(1_250)
    expect(r.lines[0]?.totalQty).toBe(1_750)
  })

  it('still accumulates two lines on the same sheet', () => {
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-pol', location: 'Block A', currentQty: 600 },
        { boqItemId: 'boq-pol', location: 'Block B', currentQty: 400 },
      ],
      [polish],
    )
    expect(r.ok).toBe(true)
    expect(r.lines[1]?.previousQty).toBe(600)
    expect(r.lines[1]?.totalQty).toBe(1_000)
  })

  it('still rejects a zero or negative quantity', () => {
    // The entry is nonsense on any job, ceiling or not.
    const r = validateMeasurement(
      [{ boqItemId: 'boq-pol', location: 'Lobby', currentQty: -5 }],
      [polish],
    )
    expect(r.ok).toBe(false)
    expect(r.rejections[0]?.reason).toBe('NOT_POSITIVE')
  })

  it('guards the fixed-quantity line on the same sheet and lets the other through', () => {
    // The load-bearing case: dropping the ceiling for rate-only items must not
    // drop it for the items that still have one.
    const r = validateMeasurement(
      [
        { boqItemId: 'boq-pol', location: 'Lobby', currentQty: 9_99_999 },
        { boqItemId: 'boq-flo', location: 'Block C', currentQty: 2_000 },
      ],
      [polish, { ...flooring, completedQty: 9_000 }],
    )
    expect(r.ok).toBe(false)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]?.boqItemName).toBe('Flooring Polish')
    expect(r.rejections).toHaveLength(1)
    expect(r.rejections[0]?.boqItemName).toBe('Flooring')
    expect(r.rejections[0]?.reason).toBe('EXCEEDS_CONTRACT')
  })
})

describe('status transitions', () => {
  it.each([
    ['DRAFT', 'SUBMITTED', true],
    ['SUBMITTED', 'APPROVED', true],
    ['SUBMITTED', 'REJECTED', true],
    ['SUBMITTED', 'DRAFT', true],
    ['REJECTED', 'DRAFT', true],
    ['DRAFT', 'APPROVED', false],
    ['APPROVED', 'DRAFT', false],
    ['APPROVED', 'REJECTED', false],
  ] as const)('%s -> %s is %s', (from, to, expected) => {
    expect(canTransition(from as MeasurementStatus, to as MeasurementStatus)).toBe(expected)
  })

  it('never lets a draft skip straight to approved', () => {
    // Otherwise the review step could be bypassed entirely.
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false)
  })

  it('treats approval as final', () => {
    for (const to of ['DRAFT', 'SUBMITTED', 'REJECTED'] as MeasurementStatus[]) {
      expect(canTransition('APPROVED', to)).toBe(false)
    }
  })
})

describe('who may approve - separation of duty', () => {
  it('lets a supervisor enter and submit', () => {
    expect(canPerformTransition('SUPERVISOR', 'DRAFT', 'SUBMITTED')).toBe(true)
  })

  it('does NOT let a supervisor approve their own work', () => {
    expect(canPerformTransition('SUPERVISOR', 'SUBMITTED', 'APPROVED')).toBe(false)
    expect(canPerformTransition('SUPERVISOR', 'SUBMITTED', 'REJECTED')).toBe(false)
  })

  it('lets owner and admin approve', () => {
    for (const role of ['OWNER', 'ADMIN'] as Role[]) {
      expect(canPerformTransition(role, 'SUBMITTED', 'APPROVED')).toBe(true)
    }
  })

  it('refuses an illegal transition regardless of role', () => {
    // The role check never runs if the move itself is not allowed. This is what
    // stops even an OWNER reopening an approved measurement a bill may
    // already reference.
    for (const role of ROLES) {
      expect(canPerformTransition(role, 'APPROVED', 'DRAFT')).toBe(false)
      expect(canPerformTransition(role, 'APPROVED', 'REJECTED')).toBe(false)
      expect(canPerformTransition(role, 'DRAFT', 'APPROVED')).toBe(false)
    }
  })

  it('lets owner and admin reject, and nobody else', () => {
    for (const role of ['OWNER', 'ADMIN'] as Role[]) {
      expect(canPerformTransition(role, 'SUBMITTED', 'REJECTED')).toBe(true)
    }
    for (const role of ['ACCOUNTANT', 'VIEWER', 'SUPERVISOR'] as Role[]) {
      expect(canPerformTransition(role, 'SUBMITTED', 'REJECTED')).toBe(false)
    }
  })

  it('lets no other role approve', () => {
    for (const role of ['ACCOUNTANT', 'VIEWER'] as Role[]) {
      expect(canPerformTransition(role, 'SUBMITTED', 'APPROVED')).toBe(false)
    }
  })
})

describe('billability', () => {
  it('is billable only when approved and not already billed', () => {
    expect(isBillable({ status: 'APPROVED' })).toBe(true)
    expect(isBillable({ status: 'APPROVED', billId: 'b1' })).toBe(false)
    expect(isBillable({ status: 'SUBMITTED' })).toBe(false)
    expect(isBillable({ status: 'DRAFT' })).toBe(false)
  })
})

describe('quantity deltas applied at approval', () => {
  const line = (boqItemId: string, currentQty: number): MeasurementItem => ({
    id: `l-${boqItemId}-${currentQty}`,
    boqItemId,
    boqItemName: 'x',
    location: 'A',
    unit: 'SQFT',
    ratePaise: fromRupees(120),
    previousQty: 0,
    currentQty,
    totalQty: currentQty,
    amountPaise: fromRupees(1),
    isChangeOrder: false,
  })

  it('sums multiple lines against the same item into one delta', () => {
    const d = completedQtyDeltas([line('a', 100), line('a', 50), line('b', 25)])
    expect(d.get('a')).toBe(150)
    expect(d.get('b')).toBe(25)
    expect(d.size).toBe(2)
  })
})
