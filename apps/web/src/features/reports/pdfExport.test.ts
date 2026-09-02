import { describe, expect, it } from 'vitest'
import { pdfFilename, planCaptureBands, planPageSlices } from './pdfExport'

/**
 * What can and cannot be tested here.
 *
 * `renderHtmlToPdfBlob()` needs a layout engine, a font stack with Devanagari
 * coverage, and a real `<canvas>` that can rasterise. jsdom has none of the
 * three - `getBoundingClientRect()` returns zeroes and canvas is a stub - so a
 * test of it would assert that a blank page is blank. It is deliberately not
 * faked. What IS tested is the arithmetic that decides where pages break and
 * the filename that reaches the operator's downloads folder, because both are
 * pure and both have already been got wrong once by hand.
 */

/** Roughly what an A4 landscape page is worth at the mount width. */
const PAGE = 713

describe('planPageSlices', () => {
  it('returns nothing for an empty page', () => {
    expect(planPageSlices(0, PAGE)).toEqual([])
    expect(planPageSlices(-5, PAGE)).toEqual([])
    expect(planPageSlices(Number.NaN, PAGE)).toEqual([])
  })

  it('keeps a short report on one page', () => {
    expect(planPageSlices(400, PAGE)).toEqual([{ top: 0, height: 400 }])
  })

  it('does not add a second page for content that exactly fills the first', () => {
    expect(planPageSlices(PAGE, PAGE)).toEqual([{ top: 0, height: PAGE }])
  })

  it('cuts at the page boundary when there is nothing safer', () => {
    expect(planPageSlices(1800, PAGE)).toEqual([
      { top: 0, height: PAGE },
      { top: PAGE, height: PAGE },
      { top: PAGE * 2, height: 1800 - PAGE * 2 },
    ])
  })

  it('covers the whole page exactly once, with no gap and no overlap', () => {
    const rows = Array.from({ length: 200 }, (_, i) => 120 + i * 24)
    const slices = planPageSlices(5000, PAGE, rows)
    expect(slices[0]?.top).toBe(0)
    let cursor = 0
    for (const s of slices) {
      expect(s.top).toBe(cursor)
      expect(s.height).toBeGreaterThan(0)
      cursor += s.height
    }
    expect(cursor).toBe(5000)
  })

  it('breaks on a row edge rather than through a row', () => {
    // Row bottoms every 24 px. No break may land mid-row.
    const rows = Array.from({ length: 300 }, (_, i) => (i + 1) * 24)
    const slices = planPageSlices(24 * 300, PAGE, rows)
    for (const s of slices.slice(1)) expect(rows).toContain(s.top)
    for (const s of slices) expect(s.height).toBeLessThanOrEqual(PAGE)
  })

  it('ignores a cut that would leave a sliver page', () => {
    // The only offered cut is 5 px in. Taking it would emit a 5 px page.
    const slices = planPageSlices(1500, PAGE, [5])
    expect(slices[0]).toEqual({ top: 0, height: PAGE })
  })

  it('ignores cuts outside the page and copes with unsorted input', () => {
    const slices = planPageSlices(1500, PAGE, [9000, -20, 700, 400])
    expect(slices[0]).toEqual({ top: 0, height: 700 })
  })

  it('falls back to a single page when the page height is nonsense', () => {
    expect(planPageSlices(900, 0)).toEqual([{ top: 0, height: 900 }])
    expect(planPageSlices(900, Number.NaN)).toEqual([{ top: 0, height: 900 }])
  })

  it('terminates on a tall report', () => {
    // A month of attendance: over a thousand rows.
    const rows = Array.from({ length: 1200 }, (_, i) => (i + 1) * 24)
    const slices = planPageSlices(24 * 1200, PAGE, rows)
    expect(slices.length).toBeGreaterThan(30)
    expect(slices.at(-1)?.top ?? 0).toBeLessThan(24 * 1200)
  })
})

describe('planCaptureBands', () => {
  const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ top: i * 700, height: 700 }))

  it('has no bands for no pages', () => {
    expect(planCaptureBands([], 3000)).toEqual([])
  })

  it('keeps everything in one pass when it fits the canvas', () => {
    expect(planCaptureBands(pages(4), 3000)).toEqual([{ from: 0, to: 3 }])
  })

  it('splits into whole-page bands under the canvas limit', () => {
    const bands = planCaptureBands(pages(10), 3000)
    expect(bands).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 9 },
    ])
  })

  it('covers every page exactly once', () => {
    const bands = planCaptureBands(pages(37), 3000)
    expect(bands[0]?.from).toBe(0)
    expect(bands.at(-1)?.to).toBe(36)
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]?.from).toBe((bands[i - 1]?.to ?? -1) + 1)
    }
  })

  it('gives a page taller than the limit a band to itself instead of looping', () => {
    const bands = planCaptureBands([{ top: 0, height: 9000 }, ...pages(2)], 3000)
    expect(bands[0]).toEqual({ from: 0, to: 0 })
    expect(bands.at(-1)?.to).toBe(2)
  })
})

describe('pdfFilename', () => {
  it('adds the extension', () => {
    expect(pdfFilename('outstanding-2026-09-02')).toBe('outstanding-2026-09-02.pdf')
  })

  it('does not double the extension', () => {
    expect(pdfFilename('report.PDF')).toBe('report.pdf')
  })

  it('keeps Devanagari, which is the whole point of this feature', () => {
    // The name must survive intact, in NFC, so the owner recognises the file.
    expect(pdfFilename('हाजिरी-रामकिशोर')).toBe('हाजिरी-रामकिशोर.pdf')
  })

  it('gives two spellings of the same Devanagari name one filename', () => {
    // U+095B and U+091C U+093C are the same nukta letter written two ways.
    // A downloads folder must not end up with two files that look identical.
    expect(pdfFilename('\u095B' + 'मीन')).toBe(pdfFilename('\u091C\u093C' + 'मीन'))
  })

  it('replaces characters that are illegal in a path', () => {
    expect(pdfFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.pdf')
  })

  it('strips control characters', () => {
    // A newline in a filename is a header-injection shape, and a bell
    // character renders as a box in a downloads list.
    expect(pdfFilename('wage\u0007sheet\u0001')).toBe('wage-sheet-.pdf')
  })

  it('collapses whitespace and trims', () => {
    expect(pdfFilename('  wage   sheet \n ')).toBe('wage sheet.pdf')
  })

  it('drops a leading dot so the file is not hidden', () => {
    expect(pdfFilename('..hidden')).toBe('hidden.pdf')
  })

  it('drops trailing dots and spaces, which Windows silently eats', () => {
    expect(pdfFilename('report... ')).toBe('report.pdf')
  })

  it('never returns a bare extension', () => {
    expect(pdfFilename('')).toBe('report.pdf')
    expect(pdfFilename('...')).toBe('report.pdf')
    expect(pdfFilename('///')).toBe('report.pdf')
  })

  it('caps the length', () => {
    const name = pdfFilename('x'.repeat(400))
    expect(name.length).toBe(124)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})
