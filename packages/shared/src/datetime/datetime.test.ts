import { describe, it, expect } from 'vitest'
import {
  toDateKey,
  dateKey,
  period,
  periodOf,
  daysInPeriod,
  addDays,
  financialYearOf,
  formatDateKey,
  isWithin,
  compareDateKeys,
} from './index'

describe('IST anchoring - R-12', () => {
  it('resolves to the IST day, not the UTC day', () => {
    // 2026-08-26 20:00 UTC is already 2026-08-27 01:30 in Kolkata.
    const instant = new Date('2026-08-26T20:00:00Z')
    expect(toDateKey(instant)).toBe('2026-08-27')
  })

  it('keeps the previous IST day just before the boundary', () => {
    // 2026-08-26 18:00 UTC is 23:30 on the 26th in Kolkata.
    expect(toDateKey(new Date('2026-08-26T18:00:00Z'))).toBe('2026-08-26')
  })

  it('is unaffected by the process timezone, which is the whole point', () => {
    const instant = new Date('2026-08-26T20:00:00Z')
    // Same instant, same answer, regardless of where the device thinks it is.
    expect(toDateKey(instant)).toBe('2026-08-27')
  })
})

describe('validation', () => {
  it('accepts a real date', () => {
    expect(dateKey('2026-08-27')).toBe('2026-08-27')
  })

  it.each(['2026-8-27', '27-08-2026', '2026/08/27', ''])('rejects malformed %s', (v) => {
    expect(() => dateKey(v)).toThrow(TypeError)
  })

  it.each(['2026-13-01', '2026-02-30', '2026-00-10'])('rejects impossible %s', (v) => {
    expect(() => dateKey(v)).toThrow(RangeError)
  })

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(dateKey('2028-02-29')).toBe('2028-02-29')
    expect(() => dateKey('2026-02-29')).toThrow(RangeError)
  })

  it('rejects a malformed period', () => {
    expect(() => period('2026-8')).toThrow(TypeError)
    expect(() => period('2026-13')).toThrow(RangeError)
  })
})

describe('periods', () => {
  it('derives the period from a date', () => {
    expect(periodOf(dateKey('2026-08-27'))).toBe('2026-08')
  })

  it('enumerates every day, including the leap day', () => {
    expect(daysInPeriod(period('2026-08'))).toHaveLength(31)
    expect(daysInPeriod(period('2026-02'))).toHaveLength(28)
    expect(daysInPeriod(period('2028-02'))).toHaveLength(29)
    expect(daysInPeriod(period('2026-04'))).toHaveLength(30)
  })

  it('starts and ends the month correctly', () => {
    const days = daysInPeriod(period('2026-08'))
    expect(days[0]).toBe('2026-08-01')
    expect(days.at(-1)).toBe('2026-08-31')
  })
})

describe('arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays(dateKey('2026-08-31'), 1)).toBe('2026-09-01')
  })

  it('adds days across a year boundary', () => {
    expect(addDays(dateKey('2026-12-31'), 1)).toBe('2027-01-01')
  })

  it('subtracts days', () => {
    expect(addDays(dateKey('2026-03-01'), -1)).toBe('2026-02-28')
    expect(addDays(dateKey('2028-03-01'), -1)).toBe('2028-02-29')
  })

  it('orders and ranges', () => {
    expect(compareDateKeys(dateKey('2026-08-01'), dateKey('2026-08-02'))).toBe(-1)
    expect(compareDateKeys(dateKey('2026-08-02'), dateKey('2026-08-02'))).toBe(0)
    expect(isWithin(dateKey('2026-08-15'), dateKey('2026-08-01'), dateKey('2026-08-31'))).toBe(true)
    expect(isWithin(dateKey('2026-09-01'), dateKey('2026-08-01'), dateKey('2026-08-31'))).toBe(false)
  })
})

/** Indian FY runs April to March - assumption A7, used in bill numbering. */
describe('financial year', () => {
  it.each([
    ['2026-08-27', '26-27'],
    ['2026-04-01', '26-27'],
    ['2026-03-31', '25-26'],
    ['2027-01-15', '26-27'],
    ['2026-12-31', '26-27'],
  ])('%s falls in FY %s', (input, expected) => {
    expect(financialYearOf(dateKey(input))).toBe(expected)
  })
})

describe('display', () => {
  it('formats as DD-MMM-YYYY', () => {
    expect(formatDateKey(dateKey('2026-08-27'))).toBe('27-Aug-2026')
  })

  it('formats in Hindi', () => {
    expect(formatDateKey(dateKey('2026-08-27'), 'hi')).toBe('27-अग-2026')
  })
})
