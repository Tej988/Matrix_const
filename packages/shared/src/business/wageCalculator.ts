import type { Attendance, AttendanceStatus, DateKey, Paise, WageRules } from '@mc/types'
import { DEFAULT_WAGE_RULES } from '@mc/types'
import { max, multiplyQty, sum, subtract, ZERO } from '../money/index'

/**
 * Wage calculation. Sections 14 and 51.
 *
 * Section 51 is explicit and this module is the reason it exists:
 *
 *   "DO NOT use AI to calculate wages. AI may explain the result, but the
 *    calculation must come from deterministic application logic."
 *
 * So: pure functions, no clock, no I/O, exhaustively tested. When the AI
 * assistant eventually answers "Ramesh ko kitna dena hai?", it calls this and
 * reads out the number - it never computes one.
 */

/**
 * How much of a day's wage each attendance status earns.
 *
 * Configurable per project (assumption A4) because half-day conventions and
 * whether leave is paid genuinely differ between sites. Defaults are the
 * common Indian construction case: half day is half pay, leave and holidays
 * unpaid for daily-wage labour.
 */
export function payableUnitsFor(
  status: AttendanceStatus,
  rules: WageRules = DEFAULT_WAGE_RULES,
): number {
  switch (status) {
    case 'PRESENT':
      return 1
    case 'HALF_DAY':
      return rules.halfDayFactor
    case 'LEAVE':
      return rules.leavePaid ? 1 : 0
    case 'HOLIDAY':
      return rules.holidayPaid ? 1 : 0
    case 'ABSENT':
      return 0
  }
}

export interface WageBreakdown {
  presentDays: number
  halfDays: number
  absentDays: number
  leaveDays: number
  holidayDays: number
  /** Total payable days, including fractions from half days. */
  payableDays: number
  dailyRatePaise: Paise
  earnedAmountPaise: Paise
  /** Days counted at more than one rate, if rates changed mid-period. */
  mixedRates: boolean
}

/**
 * Spec section 42, critical tests 6, 7 and 8.
 *
 * Earnings are computed per attendance record using the rate SNAPSHOTTED on
 * that record, not a single current rate. A labourer whose wage rose mid-month
 * is paid correctly for both halves, and a later raise never silently restates
 * work already done.
 */
export function calculateWage(
  attendance: readonly Attendance[],
  rules: WageRules = DEFAULT_WAGE_RULES,
): WageBreakdown {
  let presentDays = 0
  let halfDays = 0
  let absentDays = 0
  let leaveDays = 0
  let holidayDays = 0
  let payableDays = 0

  const amounts: Paise[] = []
  const rates = new Set<number>()

  for (const record of attendance) {
    switch (record.status) {
      case 'PRESENT':
        presentDays += 1
        break
      case 'HALF_DAY':
        halfDays += 1
        break
      case 'ABSENT':
        absentDays += 1
        break
      case 'LEAVE':
        leaveDays += 1
        break
      case 'HOLIDAY':
        holidayDays += 1
        break
    }

    const units = payableUnitsFor(record.status, rules)
    payableDays += units
    rates.add(record.dailyRatePaise)
    if (units > 0) amounts.push(multiplyQty(units, record.dailyRatePaise))
  }

  // Guard against float drift accumulating across a 31-day month.
  payableDays = Math.round(payableDays * 1000) / 1000

  const distinctRates = [...rates]
  const dailyRatePaise = (distinctRates[0] ?? 0) as Paise

  return {
    presentDays,
    halfDays,
    absentDays,
    leaveDays,
    holidayDays,
    payableDays,
    dailyRatePaise,
    earnedAmountPaise: amounts.length > 0 ? sum(amounts) : ZERO,
    mixedRates: distinctRates.length > 1,
  }
}

/**
 * The section 14 worked example, expressed directly:
 * 23 present + 2 half days at ₹700 = 24 payable days = ₹16,800.
 */
export function quickWage(
  presentDays: number,
  halfDays: number,
  dailyRatePaise: Paise,
  rules: WageRules = DEFAULT_WAGE_RULES,
): { payableDays: number; earnedAmountPaise: Paise } {
  const payableDays = Math.round((presentDays + halfDays * rules.halfDayFactor) * 1000) / 1000
  return { payableDays, earnedAmountPaise: multiplyQty(payableDays, dailyRatePaise) }
}

// ---------------------------------------------------------------------------
// Labour ledger - earned vs paid vs payable, and advances
// ---------------------------------------------------------------------------

/**
 * One payment, optionally marked as an advance - money handed over BEFORE the
 * work that earns it.
 *
 * A bare Paise is still accepted so that callers with no advance data keep
 * working; an unmarked payment counts as an ordinary wage payment.
 */
export interface LedgerPayment {
  amountPaise: Paise
  isAdvance?: boolean | undefined
}

export type LedgerPaymentInput = Paise | LedgerPayment

const paymentAmount = (p: LedgerPaymentInput): Paise => (typeof p === 'number' ? p : p.amountPaise)

const isAdvancePayment = (p: LedgerPaymentInput): boolean =>
  typeof p !== 'number' && p.isAdvance === true

export interface AdvanceRecovery {
  /** Advance already cancelled out by wages the labourer has since earned. */
  recoveredPaise: Paise
  /** Advance still owed back. Zero or positive - never a negative payable. */
  outstandingPaise: Paise
}

/**
 * Earnings settle an advance before anything is handed over, because that is
 * what an advance is: wages taken early.
 *
 * Recovery stops at the advance. Surplus earnings are payable, not an
 * over-recovery, and a shortfall stays outstanding at full paise precision
 * rather than being rounded or clamped away.
 */
export function recoverAdvance(earnedPaise: Paise, advancedPaise: Paise): AdvanceRecovery {
  if (advancedPaise <= 0) return { recoveredPaise: ZERO, outstandingPaise: ZERO }
  const recoveredPaise = earnedPaise < advancedPaise ? max(earnedPaise, ZERO) : advancedPaise
  return { recoveredPaise, outstandingPaise: subtract(advancedPaise, recoveredPaise) }
}

export interface LabourLedger {
  earnedPaise: Paise
  /** Every rupee that left the business for this labourer, advances included. */
  paidPaise: Paise
  /** Of that, what was paid as an advance. */
  advancedPaise: Paise
  advanceRecoveredPaise: Paise
  advanceOutstandingPaise: Paise
  /** Negative means the labourer has been advanced money against future work. */
  payablePaise: Paise
  /** What to hand over now: earnings left after recovery, less wages already paid. */
  netPayablePaise: Paise
  isAdvance: boolean
}

/**
 * Section 15: labour payment is different from labour earned.
 *
 * Two numbers matter and they are not the same number:
 *
 *   advanceOutstanding - what the labourer owes back
 *   netPayable         - what to hand over today
 *
 * Collapsing them into one signed figure is what hides an advance from the
 * person paying, so they are reported separately and neither is clamped to
 * zero. `payablePaise` stays as the plain earned-minus-paid difference, and the
 * three agree by construction:
 *
 *   netPayable - advanceOutstanding === payable
 */
export function labourLedger(
  earned: readonly Paise[],
  paid: readonly LedgerPaymentInput[],
): LabourLedger {
  const earnedPaise = earned.length > 0 ? sum(earned) : ZERO

  const amounts = paid.map(paymentAmount)
  const advances = paid.filter(isAdvancePayment).map(paymentAmount)

  const paidPaise = amounts.length > 0 ? sum(amounts) : ZERO
  const advancedPaise = advances.length > 0 ? sum(advances) : ZERO
  const wagesPaidPaise = subtract(paidPaise, advancedPaise)

  const { recoveredPaise, outstandingPaise } = recoverAdvance(earnedPaise, advancedPaise)

  const payablePaise = subtract(earnedPaise, paidPaise)
  const netPayablePaise = subtract(subtract(earnedPaise, recoveredPaise), wagesPaidPaise)

  return {
    earnedPaise,
    paidPaise,
    advancedPaise,
    advanceRecoveredPaise: recoveredPaise,
    advanceOutstandingPaise: outstandingPaise,
    payablePaise,
    netPayablePaise,
    // An unmarked overpayment is an advance in substance, whatever it was
    // called when it was recorded.
    isAdvance: payablePaise < 0,
  }
}

// ---------------------------------------------------------------------------
// Attendance helpers
// ---------------------------------------------------------------------------

/** Which labourers on a project have no mark yet for a given day. */
export function unmarkedLabour<T extends { id: string }>(
  roster: readonly T[],
  marked: readonly { labourId: string }[],
): T[] {
  const done = new Set(marked.map((m) => m.labourId))
  return roster.filter((l) => !done.has(l.id))
}

export interface AttendanceSummary {
  present: number
  absent: number
  halfDay: number
  leave: number
  holiday: number
  marked: number
  total: number
  complete: boolean
}

export function summariseDay(
  roster: readonly { id: string }[],
  records: readonly Attendance[],
): AttendanceSummary {
  const counts = { present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0 }
  for (const r of records) {
    if (r.status === 'PRESENT') counts.present += 1
    else if (r.status === 'ABSENT') counts.absent += 1
    else if (r.status === 'HALF_DAY') counts.halfDay += 1
    else if (r.status === 'LEAVE') counts.leave += 1
    else counts.holiday += 1
  }
  return {
    ...counts,
    marked: records.length,
    total: roster.length,
    complete: roster.length > 0 && records.length >= roster.length,
  }
}

/** Attendance is not accepted for a future date - nobody has worked tomorrow yet. */
export function isMarkableDate(dateKey: DateKey, today: DateKey): boolean {
  return dateKey <= today
}
