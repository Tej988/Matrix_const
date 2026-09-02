import type { DateKey, Period } from '@mc/types'

/**
 * All date handling in the system. Nothing else may call `new Date()` -
 * enforced by ESLint, which exempts only this directory.
 *
 * Why: a supervisor marking attendance at 00:30 IST on a phone set to UTC would
 * write the previous day's key, silently corrupting a wage period. Device clocks
 * on cheap handsets are simply wrong sometimes. Everything here resolves in
 * Asia/Kolkata regardless of where the device thinks it is. See RISKS.md R-12.
 */

export const IST = 'Asia/Kolkata'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_PATTERN = /^\d{4}-\d{2}$/

/* en-CA formats as YYYY-MM-DD, which is exactly the shape we want. */
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const MONTH_NAMES_HI = [
  'जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून',
  'जुल', 'अग', 'सित', 'अक्तू', 'नव', 'दिस',
]

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function toDateKey(instant: Date): DateKey {
  return istDateFormatter.format(instant) as DateKey
}

/** Today in IST, whatever the device clock's timezone says. */
export function todayKey(): DateKey {
  return toDateKey(new Date())
}

/**
 * The current instant. Every caller goes through here rather than calling
 * `new Date()` directly - ESLint enforces it - so that "what time is it" has a
 * single seam. Firestore writes should still prefer serverTimestamp(); this is
 * for values computed before a write, and for tests to stub.
 */
export function now(): Date {
  return new Date()
}

/** A stable "no timestamp yet" value, for documents written before a server round-trip. */
export const EPOCH = new Date(0)

export function dateKey(value: string): DateKey {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new TypeError(`Expected a YYYY-MM-DD date key, received "${value}"`)
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new RangeError(`Not a real calendar date: "${value}"`)
  }
  return value as DateKey
}

export function period(value: string): Period {
  if (!PERIOD_PATTERN.test(value)) {
    throw new TypeError(`Expected a YYYY-MM period, received "${value}"`)
  }
  const month = Number(value.slice(5, 7))
  if (month < 1 || month > 12) {
    throw new RangeError(`Not a real month: "${value}"`)
  }
  return value as Period
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function periodOf(key: DateKey): Period {
  return key.slice(0, 7) as Period
}

export function currentPeriod(): Period {
  return periodOf(todayKey())
}

/** Every day in a month - the spine of an attendance sheet or wage period. */
export function daysInPeriod(p: Period): DateKey[] {
  const year = Number(p.slice(0, 4))
  const month = Number(p.slice(5, 7))
  const count = daysInMonth(year, month)
  return Array.from(
    { length: count },
    (_, i) => `${p}-${String(i + 1).padStart(2, '0')}` as DateKey,
  )
}

export function addDays(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  // Midday UTC keeps the arithmetic clear of any DST or offset edge.
  const instant = new Date(Date.UTC(y, m - 1, d, 12))
  instant.setUTCDate(instant.getUTCDate() + days)
  return [
    instant.getUTCFullYear(),
    String(instant.getUTCMonth() + 1).padStart(2, '0'),
    String(instant.getUTCDate()).padStart(2, '0'),
  ].join('-') as DateKey
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isBefore(a: DateKey, b: DateKey): boolean {
  return a < b
}

export function isWithin(key: DateKey, from: DateKey, to: DateKey): boolean {
  return key >= from && key <= to
}

/**
 * The Indian financial year, April to March, as `25-26`. Used in bill numbering
 * (assumption A7) - a bill dated 27-Aug-2026 belongs to FY 26-27.
 */
export function financialYearOf(key: DateKey): string {
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  const startYear = month >= 4 ? year : year - 1
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** `27-Aug-2026` - assumption A6. */
export function formatDateKey(key: DateKey, locale: 'en' | 'hi' = 'en'): string {
  const [y, m, d] = key.split('-') as [string, string, string]
  const names = locale === 'hi' ? MONTH_NAMES_HI : MONTH_NAMES
  return `${d}-${names[Number(m) - 1]}-${y}`
}

/** `August 2026` / `अगस्त 2026` - for period headers. */
export function formatPeriod(p: Period, locale: 'en' | 'hi' = 'en'): string {
  const [y, m] = p.split('-') as [string, string]
  const formatter = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: IST,
  })
  return formatter.format(new Date(Date.UTC(Number(y), Number(m) - 1, 15, 12)))
}
