import { describe, it, expect } from 'vitest'
import { csvCell, toCsv, csvAmount, UTF8_BOM, csvBlobParts } from './csv'

describe('cell quoting', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Flooring')).toBe('Flooring')
    expect(csvCell(2500)).toBe('2500')
  })

  it('quotes a value containing a comma', () => {
    expect(csvCell('Tata Project Limited, Agra')).toBe('"Tata Project Limited, Agra"')
  })

  it('doubles embedded quotes', () => {
    expect(csvCell('Block "A"')).toBe('"Block ""A"""')
  })

  it('preserves newlines by quoting rather than stripping', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})

/**
 * CSV injection. A cell beginning =, +, - or @ is treated as a formula by
 * Excel, so an exported description could execute on open.
 */
describe('formula injection is defanged', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('escapes %s', (dangerous) => {
    expect(csvCell(dangerous).startsWith("'")).toBe(true)
  })

  it('escapes a real-world attack payload', () => {
    const payload = '=cmd|\' /C calc\'!A0'
    const out = csvCell(payload)
    expect(out.startsWith("'")).toBe(true)
    expect(out.startsWith('=')).toBe(false)
  })

  it('does not mangle an ordinary negative number in a text column', () => {
    // It is prefixed, which is the safe trade - a spreadsheet still shows the
    // value, it just does not evaluate it. Amount columns use csvAmount.
    expect(csvCell('-500')).toBe("'-500")
  })
})

describe('amounts for spreadsheets', () => {
  it('emits a plain decimal, never formatted', () => {
    expect(csvAmount(185000000)).toBe('1850000.00')
    expect(csvAmount(70000)).toBe('700.00')
    expect(csvAmount(10)).toBe('0.10')
    expect(csvAmount(0)).toBe('0.00')
  })

  it('never uses Indian digit grouping, which would split columns', () => {
    // "18,50,000" in a CSV cell becomes three columns.
    expect(csvAmount(185000000)).not.toContain(',')
  })

  it('handles negatives', () => {
    expect(csvAmount(-800000)).toBe('-8000.00')
  })

  it('pads paise correctly', () => {
    expect(csvAmount(100005)).toBe('1000.05')
    expect(csvAmount(100050)).toBe('1000.50')
  })
})

describe('whole documents', () => {
  it('joins with CRLF for Excel', () => {
    const csv = toCsv(['Name', 'Amount'], [['Ramesh', csvAmount(1680000)]])
    expect(csv).toBe('Name,Amount\r\nRamesh,16800.00')
  })

  it('handles an empty row set', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B')
  })

  it('prefixes a BOM so Excel renders Devanagari', () => {
    const [content, mime] = csvBlobParts(toCsv(['नाम'], [['रमेश']]))
    expect(content.startsWith(UTF8_BOM)).toBe(true)
    expect(content).toContain('रमेश')
    expect(mime).toContain('utf-8')
  })
})
