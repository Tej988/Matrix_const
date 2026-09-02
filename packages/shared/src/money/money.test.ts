import { describe, it, expect } from 'vitest'
import {
  paise,
  fromRupees,
  toRupees,
  parseRupees,
  sum,
  add,
  subtract,
  multiplyQty,
  percentOf,
  formatPaise,
  formatPaiseInWords,
  ZERO,
} from './index'

describe('construction', () => {
  it('rejects a float, because paise are always whole', () => {
    expect(() => paise(10.5)).toThrow(TypeError)
  })

  it('rejects an out-of-range value', () => {
    expect(() => paise(100_000_000_000)).toThrow(RangeError)
  })

  it('converts rupees to paise and back', () => {
    expect(fromRupees(18_50_000)).toBe(185000000)
    expect(toRupees(paise(185000000))).toBe(1850000)
  })

  it('represents Rs 0.10 exactly, which a float cannot', () => {
    expect(fromRupees(0.1)).toBe(10)
    // The reason ADR-004 exists: naive float rupees drift.
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(add(fromRupees(0.1), fromRupees(0.2))).toBe(fromRupees(0.3))
  })
})

describe('parseRupees', () => {
  it.each([
    ['1850000', 185000000],
    ['18,50,000', 185000000],
    ['₹18,50,000', 185000000],
    ['Rs 18,50,000', 185000000],
    ['rs. 1,00,000.50', 10000050],
    ['700', 70000],
    ['0.05', 5],
    ['  1,234.5  ', 123450],
  ])('parses %s', (input, expected) => {
    expect(parseRupees(input)).toBe(expected)
  })

  it('rounds a third decimal place rather than dropping it', () => {
    expect(parseRupees('1.005')).toBe(101)
    expect(parseRupees('1.004')).toBe(100)
  })

  it('handles negatives', () => {
    expect(parseRupees('-500')).toBe(-50000)
  })

  it.each(['', 'abc', '12.34.56', '₹'])('rejects %s', (input) => {
    expect(() => parseRupees(input)).toThrow(TypeError)
  })
})

/** Spec section 42, critical test 1: quantity x rate. */
describe('multiplyQty - critical test 1', () => {
  it('computes the spec worked example: 2500 sq.ft x Rs 120 = Rs 3,00,000', () => {
    const rate = fromRupees(120)
    expect(multiplyQty(2500, rate)).toBe(fromRupees(3_00_000))
  })

  it('computes the Tata contract example: 10,000 x Rs 120 = Rs 12,00,000', () => {
    expect(multiplyQty(10_000, fromRupees(120))).toBe(fromRupees(12_00_000))
  })

  it('rounds half away from zero, once, at the line item', () => {
    // 1250.755 x Rs 45.00 = 56283.975 -> 56283.98
    expect(multiplyQty(1250.755, fromRupees(45))).toBe(5628398)
  })

  it('handles fractional quantities without drift', () => {
    expect(multiplyQty(0.5, fromRupees(700))).toBe(fromRupees(350))
    expect(multiplyQty(2.5, fromRupees(700))).toBe(fromRupees(1750))
  })

  it('rejects a non-finite quantity', () => {
    expect(() => multiplyQty(Number.NaN, fromRupees(120))).toThrow(TypeError)
    expect(() => multiplyQty(Number.POSITIVE_INFINITY, fromRupees(120))).toThrow(TypeError)
  })
})

describe('sum - exactness', () => {
  it('is exact over many lines, where float rupees would drift', () => {
    const lines = Array.from({ length: 1000 }, () => fromRupees(0.01))
    expect(sum(lines)).toBe(fromRupees(10))

    const asFloats = Array.from({ length: 1000 }, () => 0.01).reduce((a, b) => a + b, 0)
    expect(asFloats).not.toBe(10)
  })

  it('sums an empty list to zero', () => {
    expect(sum([])).toBe(ZERO)
  })

  it('subtracts into a negative, which callers must handle rather than clamp', () => {
    expect(subtract(fromRupees(12_000), fromRupees(20_000))).toBe(fromRupees(-8_000))
  })
})

describe('percentOf', () => {
  it('computes 9% CGST on Rs 3,00,000', () => {
    expect(percentOf(fromRupees(3_00_000), 9)).toBe(fromRupees(27_000))
  })

  it('computes 2% TDS', () => {
    expect(percentOf(fromRupees(10_00_000), 2)).toBe(fromRupees(20_000))
  })

  it('returns zero for a zero rate, which is the ADR-003 default', () => {
    expect(percentOf(fromRupees(3_00_000), 0)).toBe(ZERO)
  })
})

describe('formatting', () => {
  it('uses Indian digit grouping, not thousands grouping', () => {
    const formatted = formatPaise(fromRupees(18_50_000))
    expect(formatted).toContain('18,50,000')
    expect(formatted).not.toContain('1,850,000')
  })

  it('hides decimals on whole rupee amounts and shows them otherwise', () => {
    expect(formatPaise(fromRupees(1850000))).not.toContain('.')
    expect(formatPaise(paise(185000050))).toContain('.50')
  })

  it.each([
    [0, 'zero rupees'],
    [70000, 'seven hundred rupees'],
    [185000000, 'eighteen lakh fifty thousand rupees'],
    [100000000000 - 100, undefined],
    [1680000, 'sixteen thousand eight hundred rupees'],
    [10050, 'one hundred rupees and fifty paise'],
    [100, 'one rupee'],
  ])('renders %d in words', (value, expected) => {
    if (expected !== undefined) {
      expect(formatPaiseInWords(paise(value))).toBe(expected)
    }
  })

  it('renders a crore amount', () => {
    expect(formatPaiseInWords(fromRupees(1_25_00_000))).toBe('one crore twenty-five lakh rupees')
  })

  it('renders a negative amount', () => {
    expect(formatPaiseInWords(fromRupees(-8_000))).toBe('minus eight thousand rupees')
  })
})
