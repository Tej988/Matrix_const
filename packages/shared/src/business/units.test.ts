import { describe, it, expect } from 'vitest'
import {
  FEET_PER_METRE,
  SQFT_PER_SQM,
  metricPairFor,
  suggestBillingQty,
  suggestMetricQty,
  evaluateDimensions,
  formatDimensions,
} from './units'

/**
 * The reference case throughout is the owner's real bill, which reconciles to
 * ₹7,74,760 exactly:
 *
 *   Flooring              98.4 m²    1058 sq.ft    ₹80    ₹84,640
 *   Kota                213.92 m²    2301 sq.ft    ₹75   ₹1,72,575
 *   Column (21 No x 7.2) 151.2 m    492.9 ft     ₹1050   ₹5,17,545
 */

describe('the bill reconciles off the IMPERIAL figure', () => {
  it.each([
    [1058, 80, 84_640],
    [2301, 75, 172_575],
    [492.9, 1050, 517_545],
  ])('%d × ₹%d = ₹%d', (qty, rate, amount) => {
    expect(Math.round(qty * rate)).toBe(amount)
  })

  it('totals the owner’s bill exactly', () => {
    expect(84_640 + 172_575 + 517_545).toBe(774_760)
  })

  it('would be wrong off the metric figure - which is why it is never used', () => {
    // 98.4 × 80 is ₹7,872, not ₹84,640. The M² column is reference only.
    expect(Math.round(98.4 * 80)).not.toBe(84_640)
  })
})

describe('not every row is an area', () => {
  it('pairs sq.ft with square metres', () => {
    const pair = metricPairFor('SQFT')
    expect(pair?.metric).toBe('SQM')
    expect(pair?.kind).toBe('AREA')
  })

  it('pairs running feet with running metres, at the LINEAR factor', () => {
    // The Column row converts at ~3.26, not ~10.75. Treating it as an area
    // would overstate the line threefold.
    const pair = metricPairFor('RFT')
    expect(pair?.metric).toBe('RMT')
    expect(pair?.kind).toBe('LENGTH')
    expect(pair?.factor).toBeCloseTo(3.28084, 4)
  })

  it('has no metric counterpart for count or lump-sum units', () => {
    expect(metricPairFor('NOS')).toBeNull()
    expect(metricPairFor('LS')).toBeNull()
    expect(metricPairFor('DAY')).toBeNull()
  })
})

describe('conversion factors are the exact ones', () => {
  it('derives both from the definition 1 ft = 0.3048 m', () => {
    expect(FEET_PER_METRE).toBeCloseTo(3.28084, 5)
    expect(SQFT_PER_SQM).toBeCloseTo(10.7639, 4)
  })

  it('differs measurably from the factors on the owner’s bill', () => {
    // His: 10.752 and 3.260. On the Column row that gap is ₹3,360 - which is
    // precisely why conversion here only ever SUGGESTS a value.
    const exact = Math.round(151.2 * FEET_PER_METRE * 10) / 10
    expect(exact).toBe(496.1)
    expect(exact).not.toBe(492.9)
    expect(Math.round((exact - 492.9) * 1050)).toBe(3360)
  })
})

describe('suggestions, not authority', () => {
  it('suggests square feet from square metres', () => {
    expect(suggestBillingQty(98.4, 'SQFT')).toBe(1059.2)
  })

  it('suggests feet from metres', () => {
    expect(suggestBillingQty(151.2, 'RFT')).toBe(496.1)
  })

  it('returns null where there is nothing to convert', () => {
    expect(suggestBillingQty(10, 'NOS')).toBeNull()
    expect(suggestBillingQty(Number.NaN, 'SQFT')).toBeNull()
  })

  it('runs backwards for showing M² beside a sq.ft entry', () => {
    expect(suggestMetricQty(1058, 'SQFT')).toBeCloseTo(98.29, 1)
    expect(suggestMetricQty(492.9, 'RFT')).toBeCloseTo(150.24, 1)
    expect(suggestMetricQty(10, 'NOS')).toBeNull()
  })
})

/** `Column (21 No x 7.2)` — the working the client checks the figure against. */
describe('dimension expressions', () => {
  it('evaluates the owner’s own working', () => {
    const r = evaluateDimensions('21 x 7.2')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(151.2)
      expect(r.terms).toEqual([[21, 7.2]])
    }
  })

  it('rounds away float error - 21 × 7.2 is 151.20000000000002 raw', () => {
    const r = evaluateDimensions('21x7.2')
    expect(r.ok && r.value).toBe(151.2)
    expect(21 * 7.2).not.toBe(151.2)
  })

  it('adds several terms', () => {
    const r = evaluateDimensions('10x5 + 3x2')
    expect(r.ok && r.value).toBe(56)
  })

  it('accepts a bare number - not every line shows working', () => {
    expect(evaluateDimensions('98.4')).toEqual({ ok: true, value: 98.4, terms: [[98.4]] })
  })

  it.each(['×', '*', 'X'])('accepts %s as the multiplier', (sign) => {
    const r = evaluateDimensions(`21${sign}7.2`)
    expect(r.ok && r.value).toBe(151.2)
  })

  it('multiplies three factors', () => {
    expect(evaluateDimensions('2 x 3 x 4')).toMatchObject({ ok: true, value: 24 })
  })

  it.each(['', '   '])('rejects empty input', (input) => {
    expect(evaluateDimensions(input)).toEqual({ ok: false, reason: 'EMPTY' })
  })

  it.each(['21 x', 'x 7.2', '21 ++ 3', 'abc', '21 - 3', '21/3', '(21)'])('rejects %s', (input) => {
    expect(evaluateDimensions(input).ok).toBe(false)
  })

  it('never evaluates code', () => {
    // The grammar is digits, dot, x and plus. Nothing else parses, so there is
    // no path from this input to execution.
    for (const attack of ['1;alert(1)', 'process.exit()', '__proto__', '1e400x1']) {
      const r = evaluateDimensions(attack)
      if (r.ok) expect(Number.isFinite(r.value)).toBe(true)
      else expect(['SYNTAX', 'NOT_FINITE']).toContain(r.reason)
    }
  })

  it('renders the working back for the bill line', () => {
    expect(formatDimensions([[21, 7.2]])).toBe('21 x 7.2')
    expect(
      formatDimensions([
        [10, 5],
        [3, 2],
      ]),
    ).toBe('10 x 5 + 3 x 2')
  })
})
