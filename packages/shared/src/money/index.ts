import type { Paise } from '@mc/types'

/**
 * All money arithmetic in the system. Nothing else may do it inline.
 *
 * Money is an integer count of paise (DECISIONS.md ADR-004). IEEE-754 floats
 * cannot represent Rs 0.10 exactly, and drift accumulated across hundreds of
 * measurement lines is the kind of bug you learn about from an annoyed client.
 */

/** Largest value we accept: Rs 1,000 crore in paise. Guards against typos and overflow. */
const MAX_PAISE = 100_000_000_000

export const ZERO = 0 as Paise

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Paise must be an integer, received ${value}`)
  }
  if (Math.abs(value) >= MAX_PAISE) {
    throw new RangeError(`Paise value out of range: ${value}`)
  }
  return value as Paise
}

export function fromRupees(rupees: number): Paise {
  return paise(Math.round(rupees * 100))
}

export function toRupees(p: Paise): number {
  return p / 100
}

/**
 * Parses user input. Tolerates the shapes people actually type: Indian digit
 * grouping, a rupee sign, spaces, and a decimal part.
 *
 * `"Rs 18,50,000.50"` -> 185000050
 */
export function parseRupees(input: string): Paise {
  const cleaned = input
    .replace(/[₹]/g, '')
    .replace(/rs\.?/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim()

  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) {
    throw new TypeError(`Cannot parse as an amount: "${input}"`)
  }

  const [whole = '0', fraction = ''] = cleaned.split('.')
  const negative = whole.startsWith('-')
  const wholeDigits = negative ? whole.slice(1) : whole

  // Pad or truncate the fractional part to exactly two digits, rounding the
  // third digit rather than silently dropping it.
  const twoDigits = fraction.slice(0, 2).padEnd(2, '0')
  const thirdDigit = fraction.charAt(2)
  const roundUp = thirdDigit !== '' && Number(thirdDigit) >= 5

  const total = Number(wholeDigits || '0') * 100 + Number(twoDigits) + (roundUp ? 1 : 0)
  return paise(negative ? -total : total)
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** Integer addition, so a total is exact by construction. */
export function sum(values: readonly Paise[]): Paise {
  return paise(values.reduce<number>((acc, v) => acc + v, 0))
}

export function add(a: Paise, b: Paise): Paise {
  return paise(a + b)
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b)
}

/**
 * quantity x rate, rounded half away from zero, applied ONCE at the line item.
 * Never to a running total - that is where drift comes from.
 */
export function multiplyQty(quantity: number, rate: Paise): Paise {
  if (!Number.isFinite(quantity)) {
    throw new TypeError(`Quantity must be finite, received ${quantity}`)
  }
  const raw = quantity * rate
  return paise(Math.sign(raw) * Math.round(Math.abs(raw)))
}

/** A percentage of a base amount - GST, TDS, retention (ADR-003). */
export function percentOf(base: Paise, ratePercent: number): Paise {
  if (!Number.isFinite(ratePercent)) {
    throw new TypeError(`Rate must be finite, received ${ratePercent}`)
  }
  const raw = (base * ratePercent) / 100
  return paise(Math.sign(raw) * Math.round(Math.abs(raw)))
}

export const isZero = (p: Paise): boolean => p === 0
export const isNegative = (p: Paise): boolean => p < 0
export const max = (a: Paise, b: Paise): Paise => (a >= b ? a : b)

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Indian digit grouping in both locales - Rs 18,50,000, not Rs 1,850,000.
 * That is how the number is read aloud in Hindi and in English here (A6).
 */
export function formatPaise(p: Paise, options: { showDecimals?: boolean } = {}): string {
  const showDecimals = options.showDecimals ?? p % 100 !== 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(toRupees(p))
}

/** Digits only, no currency symbol - for form inputs and CSV export. */
export function formatPlain(p: Paise): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(p))
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  const tens = TENS[Math.floor(n / 10)] ?? ''
  const ones = ONES[n % 10] ?? ''
  return ones ? `${tens}-${ones}` : tens
}

function threeDigitWords(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`)
  if (rest > 0) parts.push(twoDigitWords(rest))
  return parts.join(' ')
}

/**
 * Amount in words on the Indian scale, for confirmation dialogs and bill PDFs
 * (spec section 28, section 36). Seeing "eighteen lakh fifty thousand rupees"
 * beside the figure is what catches a misplaced zero before it is committed.
 */
export function formatPaiseInWords(p: Paise): string {
  if (p === 0) return 'zero rupees'

  const negative = p < 0
  const absolute = Math.abs(p)
  const rupees = Math.floor(absolute / 100)
  const paisePart = absolute % 100

  const crore = Math.floor(rupees / 10_000_000)
  const lakh = Math.floor((rupees % 10_000_000) / 100_000)
  const thousand = Math.floor((rupees % 100_000) / 1_000)
  const remainder = rupees % 1_000

  const parts: string[] = []
  if (crore > 0) parts.push(`${threeDigitWords(crore)} crore`)
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} lakh`)
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} thousand`)
  if (remainder > 0) parts.push(threeDigitWords(remainder))

  let words = parts.join(' ')
  if (rupees > 0) words += rupees === 1 ? ' rupee' : ' rupees'
  if (paisePart > 0) {
    words += rupees > 0 ? ' and ' : ''
    words += `${twoDigitWords(paisePart)} paise`
  }

  return (negative ? 'minus ' : '') + words
}
