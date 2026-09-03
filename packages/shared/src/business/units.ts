import type { Unit } from '@mc/types'

/**
 * Metric-to-imperial conversion, and the arithmetic behind a measurement line.
 *
 * Built from the owner's actual bill, which reconciles to the paisa:
 *
 *   Item                    M²       ST/SF    Rate    Amount
 *   Flooring                98.4     1058       80    84,640
 *   Kota                    213.92   2301       75   172,575
 *   Column (21 No x 7.2)    151.2    492.9    1050   517,545
 *                                                    ───────
 *                                                    774,760
 *
 * Three facts that the design follows from:
 *
 * 1. **The amount is always the IMPERIAL figure × rate.** Never the metric one.
 *    The M² column is what was measured on site; the ST/SF column is what is
 *    billed, and 1058 × 80 = 84,640 exactly.
 *
 * 2. **Not every row is area.** Flooring and Kota convert at ~10.75 (square
 *    metres to square feet), but Column converts at ~3.26 — that is metres to
 *    FEET. Columns are measured as running length, and treating that row as an
 *    area would overstate it by a factor of three.
 *
 * 3. **The owner's factors are not the exact ones**, and that is the reason
 *    conversion here is ASSISTIVE, NEVER AUTOMATIC. His bill uses 10.752 and
 *    3.260; the exact values are 10.7639 and 3.28084. On the Column row alone
 *    that difference is ₹3,360. Silently "correcting" his arithmetic would make
 *    this app disagree with bills he has already issued, so the entered figure
 *    always wins and the converter only ever fills a field he can overwrite.
 */

/** Exact, by international definition: 1 ft = 0.3048 m. */
export const FEET_PER_METRE = 1 / 0.3048
export const SQFT_PER_SQM = FEET_PER_METRE * FEET_PER_METRE

/** Units that pair a metric measurement with the imperial one that gets billed. */
const PAIRS: Partial<Record<Unit, { metric: Unit; factor: number; kind: 'AREA' | 'LENGTH' }>> = {
  SQFT: { metric: 'SQM', factor: SQFT_PER_SQM, kind: 'AREA' },
  RFT: { metric: 'RMT', factor: FEET_PER_METRE, kind: 'LENGTH' },
}

export interface UnitPair {
  /** The unit the item is billed in. */
  billing: Unit
  /** The unit it is typically measured in on site. */
  metric: Unit
  factor: number
  kind: 'AREA' | 'LENGTH'
}

/** The metric counterpart of a billing unit, or null when there is not one. */
export function metricPairFor(billing: Unit): UnitPair | null {
  const pair = PAIRS[billing]
  return pair ? { billing, metric: pair.metric, factor: pair.factor, kind: pair.kind } : null
}

/**
 * Converts a site measurement into the billing unit.
 *
 * Returned as a SUGGESTION. The caller must let the user overwrite it - see
 * fact 3 above. Rounded to one decimal, matching how the figures appear on the
 * owner's bills.
 */
export function suggestBillingQty(metricValue: number, billing: Unit): number | null {
  const pair = metricPairFor(billing)
  if (!pair || !Number.isFinite(metricValue)) return null
  return Math.round(metricValue * pair.factor * 10) / 10
}

/** The reverse, for showing an M² figure beside a quantity entered in sq.ft. */
export function suggestMetricQty(billingValue: number, billing: Unit): number | null {
  const pair = metricPairFor(billing)
  if (!pair || !Number.isFinite(billingValue)) return null
  return Math.round((billingValue / pair.factor) * 100) / 100
}

// ---------------------------------------------------------------------------
// Dimension expressions
// ---------------------------------------------------------------------------

export type ExpressionResult =
  | { ok: true; value: number; terms: number[][] }
  | { ok: false; reason: 'EMPTY' | 'SYNTAX' | 'NOT_FINITE' }

/**
 * Evaluates the working a contractor writes on a measurement sheet.
 *
 * The owner's own bill carries `Column (21 No x 7.2)` in the item name - 21
 * columns at 7.2 m each. That working is how the client checks the figure, so
 * it has to be captured rather than silently collapsed into "151.2".
 *
 * Grammar, deliberately tiny: numbers joined by `x` or `*` multiply, and terms
 * joined by `+` add. `21 x 7.2` is 151.2; `10x5 + 3x2` is 56.
 *
 * Hand-parsed rather than `eval` or `Function` - this string comes from a text
 * input, and there is no version of shipping an evaluator to a browser that is
 * worth the convenience.
 */
export function evaluateDimensions(input: string): ExpressionResult {
  const cleaned = input.trim().replace(/[×✕]/g, 'x').replace(/\s+/g, '')
  if (cleaned === '') return { ok: false, reason: 'EMPTY' }

  // A bare number is a valid expression - not every line has working.
  if (!/^[\d.+xX*]+$/.test(cleaned)) return { ok: false, reason: 'SYNTAX' }

  const terms: number[][] = []
  let total = 0

  for (const term of cleaned.split('+')) {
    if (term === '') return { ok: false, reason: 'SYNTAX' }

    const factors: number[] = []
    for (const factor of term.split(/[xX*]/)) {
      if (factor === '') return { ok: false, reason: 'SYNTAX' }
      const n = Number(factor)
      if (!Number.isFinite(n)) return { ok: false, reason: 'SYNTAX' }
      factors.push(n)
    }

    const product = factors.reduce((a, b) => a * b, 1)
    terms.push(factors)
    total += product
  }

  if (!Number.isFinite(total)) return { ok: false, reason: 'NOT_FINITE' }

  // Three decimals, matching QTY_PRECISION in boqCalculator. 21 x 7.2 is
  // 151.20000000000002 in raw float, and that must not reach a bill.
  return { ok: true, value: Math.round(total * 1000) / 1000, terms }
}

/** `21 x 7.2` rendered back for the bill line, from the parsed terms. */
export function formatDimensions(terms: readonly (readonly number[])[]): string {
  return terms.map((factors) => factors.join(' x ')).join(' + ')
}
