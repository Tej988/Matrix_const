/**
 * CSV generation. Sections 37 and 41.
 *
 * Written by hand rather than pulled from a library: the whole job is quoting
 * correctly, and that is twenty lines. The subtleties that actually matter for
 * Indian business data are handled below.
 */

/**
 * Quotes a cell for CSV.
 *
 * Three things beyond the obvious:
 *
 *   - A value starting with =, +, - or @ is prefixed with a single quote.
 *     Excel treats those as formulas, and a CSV that executes when opened is a
 *     genuine attack vector (CSV injection) as well as a corruption risk.
 *   - Amounts are emitted as plain numbers, never with currency symbols or
 *     Indian digit grouping - "18,50,000" would split across three columns.
 *   - Newlines inside a value are preserved by quoting rather than stripped.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let s = String(value)

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  // CRLF: Excel on Windows is the overwhelmingly likely destination.
  return lines.join('\r\n')
}

/**
 * Paise to a plain decimal string for spreadsheets: 185000000 -> "1850000.00".
 * Never formatted, never symbol-prefixed - a spreadsheet needs a number.
 */
export function csvAmount(paise: number): string {
  const negative = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const p = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${rupees}.${p}`
}

/**
 * A UTF-8 BOM so Excel renders Devanagari correctly. Without it, Hindi names
 * open as mojibake on a default Windows install - and a labourer's name being
 * unreadable in the export is a real failure, not a cosmetic one.
 */
export const UTF8_BOM = '﻿'

export function csvBlobParts(csv: string): [string, string] {
  return [UTF8_BOM + csv, 'text/csv;charset=utf-8;']
}
