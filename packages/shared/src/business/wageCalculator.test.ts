import { describe, it, expect } from 'vitest'
import type { Attendance, AttendanceStatus, DateKey, WageRules } from '@mc/types'
import { DEFAULT_WAGE_RULES, attendanceId } from '@mc/types'
import { fromRupees } from '../money/index'
import { dateKey } from '../datetime/index'
import {
  payableUnitsFor,
  calculateWage,
  quickWage,
  labourLedger,
  recoverAdvance,
  unmarkedLabour,
  summariseDay,
  isMarkableDate,
} from './wageCalculator'

const RATE = fromRupees(700)

const mark = (status: AttendanceStatus, day: number, rate = RATE): Attendance => ({
  id: `a${day}`,
  projectId: 'p1',
  labourId: 'l1',
  labourName: 'Ramesh',
  dateKey: `2026-08-${String(day).padStart(2, '0')}` as DateKey,
  status,
  dailyRatePaise: rate,
  payableUnits: payableUnitsFor(status),
  markedBy: 'u1',
  syncSource: 'ONLINE',
})

const days = (status: AttendanceStatus, n: number, from = 1, rate = RATE) =>
  Array.from({ length: n }, (_, i) => mark(status, from + i, rate))

/** Spec section 42, critical test 7. */
describe('payable units per status', () => {
  it('uses the standard construction convention by default', () => {
    expect(payableUnitsFor('PRESENT')).toBe(1)
    expect(payableUnitsFor('HALF_DAY')).toBe(0.5)
    expect(payableUnitsFor('ABSENT')).toBe(0)
    expect(payableUnitsFor('LEAVE')).toBe(0)
    expect(payableUnitsFor('HOLIDAY')).toBe(0)
  })

  it('honours a project that pays leave and holidays', () => {
    const rules: WageRules = { halfDayFactor: 0.5, leavePaid: true, holidayPaid: true }
    expect(payableUnitsFor('LEAVE', rules)).toBe(1)
    expect(payableUnitsFor('HOLIDAY', rules)).toBe(1)
  })

  it('honours a non-standard half-day factor', () => {
    const rules: WageRules = { ...DEFAULT_WAGE_RULES, halfDayFactor: 0.6 }
    expect(payableUnitsFor('HALF_DAY', rules)).toBe(0.6)
  })
})

/** Spec section 42, critical test 6 - the section 14 worked example. */
describe('the section 14 example: 23 present + 2 half days at ₹700', () => {
  const attendance = [...days('PRESENT', 23, 1), ...days('HALF_DAY', 2, 24)]
  const w = calculateWage(attendance)

  it('counts 24 payable days', () => {
    expect(w.presentDays).toBe(23)
    expect(w.halfDays).toBe(2)
    expect(w.payableDays).toBe(24)
  })

  it('earns ₹16,800', () => {
    expect(w.earnedAmountPaise).toBe(fromRupees(16_800))
  })

  it('matches the shorthand calculation', () => {
    expect(quickWage(23, 2, RATE).earnedAmountPaise).toBe(fromRupees(16_800))
    expect(quickWage(23, 2, RATE).payableDays).toBe(24)
  })
})

describe('absences and unpaid days', () => {
  it('pays nothing for absent, leave or holiday by default', () => {
    const w = calculateWage([
      ...days('PRESENT', 10, 1),
      ...days('ABSENT', 3, 11),
      ...days('LEAVE', 2, 14),
      ...days('HOLIDAY', 1, 16),
    ])
    expect(w.payableDays).toBe(10)
    expect(w.earnedAmountPaise).toBe(fromRupees(7_000))
    expect(w.absentDays).toBe(3)
    expect(w.leaveDays).toBe(2)
    expect(w.holidayDays).toBe(1)
  })

  it('pays leave when the project says so', () => {
    const rules: WageRules = { ...DEFAULT_WAGE_RULES, leavePaid: true }
    const w = calculateWage([...days('PRESENT', 10, 1), ...days('LEAVE', 2, 11)], rules)
    expect(w.payableDays).toBe(12)
    expect(w.earnedAmountPaise).toBe(fromRupees(8_400))
  })

  it('earns nothing from an empty month', () => {
    const w = calculateWage([])
    expect(w.payableDays).toBe(0)
    expect(w.earnedAmountPaise).toBe(fromRupees(0))
  })
})

describe('rates are taken per record, not from a single current value', () => {
  it('pays each half of the month at its own rate', () => {
    // Rate rose from ₹700 to ₹800 mid-month. Both halves must be correct.
    const w = calculateWage([
      ...days('PRESENT', 10, 1, fromRupees(700)),
      ...days('PRESENT', 10, 11, fromRupees(800)),
    ])
    expect(w.earnedAmountPaise).toBe(fromRupees(15_000)) // 7,000 + 8,000
    expect(w.mixedRates).toBe(true)
  })

  it('reports a single rate when nothing changed', () => {
    expect(calculateWage(days('PRESENT', 5)).mixedRates).toBe(false)
  })
})

describe('float safety across a full month', () => {
  it('accumulates 31 half days without drift', () => {
    const w = calculateWage(days('HALF_DAY', 31))
    expect(w.payableDays).toBe(15.5)
    expect(w.earnedAmountPaise).toBe(fromRupees(10_850))
  })

  it('handles a fractional factor exactly', () => {
    const rules: WageRules = { ...DEFAULT_WAGE_RULES, halfDayFactor: 0.6 }
    const w = calculateWage(days('HALF_DAY', 3), rules)
    // 3 x 0.6 is 1.7999999999999998 in raw float.
    expect(w.payableDays).toBe(1.8)
  })
})

/** Spec section 42, critical test 8. */
describe('earned vs paid vs payable - section 15', () => {
  it('computes the section 15 example', () => {
    const l = labourLedger([fromRupees(20_000)], [fromRupees(12_000)])
    expect(l.earnedPaise).toBe(fromRupees(20_000))
    expect(l.paidPaise).toBe(fromRupees(12_000))
    expect(l.payablePaise).toBe(fromRupees(8_000))
    expect(l.isAdvance).toBe(false)
  })

  it('shows an advance as negative rather than clamping it to zero', () => {
    // Hiding this would misstate what the business is owed back.
    const l = labourLedger([fromRupees(5_000)], [fromRupees(8_000)])
    expect(l.payablePaise).toBe(fromRupees(-3_000))
    expect(l.isAdvance).toBe(true)
  })

  it('handles nothing earned and nothing paid', () => {
    const l = labourLedger([], [])
    expect(l.payablePaise).toBe(fromRupees(0))
  })

  it('sums many periods and many payments', () => {
    const l = labourLedger(
      [fromRupees(16_800), fromRupees(14_000)],
      [fromRupees(10_000), fromRupees(10_000), fromRupees(5_000)],
    )
    expect(l.earnedPaise).toBe(fromRupees(30_800))
    expect(l.payablePaise).toBe(fromRupees(5_800))
  })
})

/**
 * Advances - money handed over before the work that earns it, recovered from
 * future wages. Section 15, and the reason `netPayable` exists.
 */
describe('advances against future wages', () => {
  const advance = (rupees: number) => ({ amountPaise: fromRupees(rupees), isAdvance: true })
  const wage = (rupees: number) => ({ amountPaise: fromRupees(rupees), isAdvance: false })

  it('recovers nothing when nothing has been earned yet', () => {
    const l = labourLedger([], [advance(5_000)])
    expect(l.earnedPaise).toBe(fromRupees(0))
    expect(l.paidPaise).toBe(fromRupees(5_000))
    expect(l.advancedPaise).toBe(fromRupees(5_000))
    expect(l.advanceRecoveredPaise).toBe(fromRupees(0))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(5_000))
    // Nothing to hand over: the money has already gone out.
    expect(l.netPayablePaise).toBe(fromRupees(0))
    expect(l.payablePaise).toBe(fromRupees(-5_000))
    expect(l.isAdvance).toBe(true)
  })

  it('recovers only as much as has been earned', () => {
    const l = labourLedger([fromRupees(3_000)], [advance(5_000)])
    expect(l.advanceRecoveredPaise).toBe(fromRupees(3_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(2_000))
    expect(l.netPayablePaise).toBe(fromRupees(0))
    expect(l.isAdvance).toBe(true)
  })

  it('pays out the surplus once the advance is cleared', () => {
    const l = labourLedger([fromRupees(8_000)], [advance(5_000)])
    expect(l.advanceRecoveredPaise).toBe(fromRupees(5_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(0))
    expect(l.netPayablePaise).toBe(fromRupees(3_000))
    expect(l.payablePaise).toBe(fromRupees(3_000))
    expect(l.isAdvance).toBe(false)
  })

  it('settles exactly when earnings equal the advance', () => {
    const l = labourLedger([fromRupees(5_000)], [advance(5_000)])
    expect(l.advanceRecoveredPaise).toBe(fromRupees(5_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(0))
    expect(l.netPayablePaise).toBe(fromRupees(0))
    expect(l.payablePaise).toBe(fromRupees(0))
    expect(l.isAdvance).toBe(false)
  })

  it('adds several advances up before recovering them', () => {
    const l = labourLedger([fromRupees(6_000)], [advance(2_000), advance(3_000), advance(4_000)])
    expect(l.advancedPaise).toBe(fromRupees(9_000))
    expect(l.advanceRecoveredPaise).toBe(fromRupees(6_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(3_000))
    expect(l.netPayablePaise).toBe(fromRupees(0))
  })

  it('recovers the advance before handing over fresh wages', () => {
    // Earned 20,000 against a 5,000 advance, with 12,000 already paid.
    const l = labourLedger([fromRupees(20_000)], [advance(5_000), wage(12_000)])
    expect(l.paidPaise).toBe(fromRupees(17_000))
    expect(l.advanceRecoveredPaise).toBe(fromRupees(5_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(0))
    expect(l.netPayablePaise).toBe(fromRupees(3_000))
    expect(l.payablePaise).toBe(fromRupees(3_000))
  })

  it('keeps the advance outstanding even while wages are also being paid', () => {
    // The labourer barely worked, so the advance was never recovered, and a
    // cash wage went out on top of it anyway.
    const l = labourLedger([fromRupees(1_000)], [advance(5_000), wage(2_000)])
    expect(l.advanceRecoveredPaise).toBe(fromRupees(1_000))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(4_000))
    expect(l.netPayablePaise).toBe(fromRupees(-2_000))
    expect(l.payablePaise).toBe(fromRupees(-6_000))
  })

  it('never rounds an advance away to zero', () => {
    const l = labourLedger([fromRupees(9_999.99)], [advance(10_000)])
    expect(l.advanceOutstandingPaise).toBe(fromRupees(0.01))
    expect(l.advanceOutstandingPaise).not.toBe(fromRupees(0))
  })

  it('holds the invariant that ties the three figures together', () => {
    const cases = [
      labourLedger([], [advance(5_000)]),
      labourLedger([fromRupees(3_000)], [advance(5_000)]),
      labourLedger([fromRupees(20_000)], [advance(5_000), wage(12_000)]),
      labourLedger([fromRupees(1_000)], [advance(5_000), wage(2_000)]),
      labourLedger([fromRupees(16_800)], []),
    ]
    for (const l of cases) {
      expect(l.netPayablePaise - l.advanceOutstandingPaise).toBe(l.payablePaise)
    }
  })

  it('treats an unmarked payment as an ordinary wage, not an advance', () => {
    const l = labourLedger([fromRupees(5_000)], [fromRupees(8_000)])
    expect(l.advancedPaise).toBe(fromRupees(0))
    expect(l.advanceOutstandingPaise).toBe(fromRupees(0))
    // Still visibly negative, so an unmarked overpayment is not hidden either.
    expect(l.netPayablePaise).toBe(fromRupees(-3_000))
    expect(l.isAdvance).toBe(true)
  })

  it('reads an isAdvance:false payment exactly like a bare amount', () => {
    const flagged = labourLedger([fromRupees(20_000)], [wage(12_000)])
    const bare = labourLedger([fromRupees(20_000)], [fromRupees(12_000)])
    expect(flagged).toEqual(bare)
  })
})

describe('advance recovery on its own', () => {
  it('recovers up to the advance and no further', () => {
    expect(recoverAdvance(fromRupees(8_000), fromRupees(5_000))).toEqual({
      recoveredPaise: fromRupees(5_000),
      outstandingPaise: fromRupees(0),
    })
  })

  it('recovers what it can and leaves the rest owed back', () => {
    expect(recoverAdvance(fromRupees(2_000), fromRupees(5_000))).toEqual({
      recoveredPaise: fromRupees(2_000),
      outstandingPaise: fromRupees(3_000),
    })
  })

  it('has nothing to do when there is no advance', () => {
    expect(recoverAdvance(fromRupees(8_000), fromRupees(0))).toEqual({
      recoveredPaise: fromRupees(0),
      outstandingPaise: fromRupees(0),
    })
  })
})

describe('attendance helpers', () => {
  const roster = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]

  it('lists who is not marked yet', () => {
    const left = unmarkedLabour(roster, [{ labourId: 'l1' }])
    expect(left.map((l) => l.id)).toEqual(['l2', 'l3'])
  })

  it('counts leave and holiday separately from absence', () => {
    // A day can be unpaid without being an absence, and the dashboard shows
    // them apart - a site closed for a holiday is not the same as nobody
    // turning up.
    const s = summariseDay(roster, [mark('LEAVE', 1), mark('HOLIDAY', 1), mark('ABSENT', 1)])
    expect(s.leave).toBe(1)
    expect(s.holiday).toBe(1)
    expect(s.absent).toBe(1)
    expect(s.marked).toBe(3)
  })

  it('is not complete against an empty roster, however many marks exist', () => {
    expect(summariseDay([], [mark('PRESENT', 1)]).complete).toBe(false)
  })

  it('summarises the day and knows when it is complete', () => {
    const partial = summariseDay(roster, [mark('PRESENT', 1), mark('ABSENT', 1)])
    expect(partial.present).toBe(1)
    expect(partial.absent).toBe(1)
    expect(partial.marked).toBe(2)
    expect(partial.complete).toBe(false)

    const full = summariseDay(roster, [mark('PRESENT', 1), mark('ABSENT', 1), mark('HALF_DAY', 1)])
    expect(full.complete).toBe(true)
  })

  it('refuses attendance for a future date', () => {
    const today = dateKey('2026-08-27')
    expect(isMarkableDate(dateKey('2026-08-27'), today)).toBe(true)
    expect(isMarkableDate(dateKey('2026-08-26'), today)).toBe(true)
    expect(isMarkableDate(dateKey('2026-08-28'), today)).toBe(false)
  })
})

/** ADR-006 - the deterministic ID that makes offline replay idempotent. */
describe('attendance document IDs', () => {
  it('is fully determined by project, labour and date', () => {
    expect(attendanceId('p1', 'l1', dateKey('2026-08-27'))).toBe('p1_l1_2026-08-27')
  })

  it('produces the same ID twice, so a duplicate is the same document', () => {
    const a = attendanceId('p1', 'l1', dateKey('2026-08-27'))
    const b = attendanceId('p1', 'l1', dateKey('2026-08-27'))
    expect(a).toBe(b)
  })

  it('differs by project, labourer and day', () => {
    const base = attendanceId('p1', 'l1', dateKey('2026-08-27'))
    expect(attendanceId('p2', 'l1', dateKey('2026-08-27'))).not.toBe(base)
    expect(attendanceId('p1', 'l2', dateKey('2026-08-27'))).not.toBe(base)
    expect(attendanceId('p1', 'l1', dateKey('2026-08-28'))).not.toBe(base)
  })
})
