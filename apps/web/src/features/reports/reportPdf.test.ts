import { afterEach, describe, expect, it } from 'vitest'
import type { DateKey } from '@mc/types'
import {
  canShareFiles,
  renderReportHtml,
  reportAttachMessage,
  reportShareCaption,
  whatsappUrl,
  type PrintableReport,
} from './reportPdf'

/**
 * A wage report with a Hindi labourer name in it - the exact case R-08 is
 * about. jsdom cannot shape or rasterise it, so what these tests can prove is
 * that the name reaches the renderer and the share layer intact; that the
 * browser then shapes it correctly is a property of the browser, and is why
 * pdfExport.ts photographs a real layout instead of drawing glyphs itself.
 */
const report: PrintableReport = {
  header: {
    businessName: 'Matrix Construction',
    addressLines: ['Plot 14, MIDC', 'Nagpur'],
    title: 'Wage register',
    subtitle: 'Site A · August 2026',
    ref: 'MC/2026/41',
    date: '2026-09-02' as DateKey,
  },
  columns: ['Name', 'Days', 'Wage'],
  numericColumns: [1, 2],
  rows: [['रामकिशोर', '24', 'Rs 14,400']],
  stats: [{ label: 'Labourers', value: '1' }],
  totals: ['Total', '24', 'Rs 14,400'],
}

/** jsdom has no navigator.canShare, so each test installs the one it needs. */
function stubCanShare(impl: ((data: ShareData) => boolean) | undefined): void {
  Object.defineProperty(navigator, 'canShare', {
    value: impl,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'canShare')
})

describe('canShareFiles', () => {
  const file = () => new File(['%PDF-1.3'], 'wage-register.pdf', { type: 'application/pdf' })

  it('is false where the browser has no canShare at all - every desktop', () => {
    stubCanShare(undefined)
    expect(canShareFiles([file()])).toBe(false)
  })

  it('is true where the browser accepts the file', () => {
    stubCanShare(() => true)
    expect(canShareFiles([file()])).toBe(true)
  })

  it('is false where the browser rejects this file type', () => {
    stubCanShare(() => false)
    expect(canShareFiles([file()])).toBe(false)
  })

  it('is false, not a crash, where the browser throws on an unknown member', () => {
    // Some implementations throw instead of returning false. A share button
    // that appears and then explodes on the tap is worse than no button.
    stubCanShare(() => {
      throw new TypeError('files is not a supported member')
    })
    expect(canShareFiles([file()])).toBe(false)
  })

  it('passes the actual files through, not an empty probe', () => {
    let seen: readonly File[] = []
    stubCanShare((data) => {
      seen = data.files ?? []
      return true
    })
    const pdf = file()
    canShareFiles([pdf])
    expect(seen).toEqual([pdf])
  })
})

describe('reportShareCaption', () => {
  it('names the document without retyping its numbers', () => {
    const caption = reportShareCaption(report)
    expect(caption).toContain('*Matrix Construction*')
    expect(caption).toContain('Wage register')
    expect(caption).toContain('Ref: MC/2026/41')
    expect(caption).toContain('02-Sep-2026')
    // The figures belong in the attachment. A caption that repeats them is a
    // second source of truth that can disagree with the document it captions.
    expect(caption).not.toContain('14,400')
  })
})

describe('reportAttachMessage', () => {
  it('names the file the operator has to attach', () => {
    const message = reportAttachMessage(report, 'wage-register.pdf')
    expect(message).toContain('wage-register.pdf')
    expect(message.startsWith(reportShareCaption(report))).toBe(true)
  })

  it('does not claim the PDF is already attached, because it is not', () => {
    const message = reportAttachMessage(report, 'wage-register.pdf').toLowerCase()
    expect(message).not.toContain('attached:')
    expect(message).not.toContain('please find attached')
  })

  it('survives the trip through a wa.me URL', () => {
    const url = whatsappUrl(reportAttachMessage(report, 'हाजिरी.pdf'))
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toContain('हाजिरी.pdf')
  })
})

describe('renderReportHtml', () => {
  it('emits the Devanagari name as text for the browser to shape', () => {
    // The PDF is a photograph of this markup. If the name is mangled here it is
    // mangled in the PDF; if it is intact, the browser's shaper handles it.
    const html = renderReportHtml(report)
    expect(html).toContain('रामकिशोर')
    // Not escaped into entities, and not reordered on the way through.
    expect(html).not.toContain('&#2352;')
  })

  it('still escapes markup, so a project name cannot inject into the sheet', () => {
    const html = renderReportHtml({ ...report, rows: [['<script>x</script>', '1', '2']] })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x</script>')
  })
})
