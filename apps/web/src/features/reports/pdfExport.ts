/**
 * A real PDF binary, produced by photographing the browser's own rendering.
 *
 * WHY NOT DRAW THE PDF DIRECTLY. jsPDF (and pdfmake, and every other in-browser
 * PDF writer) places glyphs in codepoint order. Devanagari is not written in
 * codepoint order: `रामकिशोर` needs conjunct formation, and an i-matra is stored
 * after the consonant but drawn to the LEFT of it. Deciding that is the job of
 * an OpenType shaping engine, which none of these libraries ship. Embedding
 * Noto Sans Devanagari does not fix it - the font has the glyphs, but nothing
 * chooses which ones or in what order. A labourer's name would come out of a
 * wage sheet as recognisable-but-wrong rubbish, which is worse than not
 * printing it. That is R-08, and it is why the previous pass refused to
 * generate PDFs at all.
 *
 * WHAT THIS DOES INSTEAD. The browser already has a shaping engine and has
 * already run it: the report is laid out as HTML, correctly, by the same engine
 * that renders every other Devanagari string in the app. So we mount that HTML,
 * let the browser shape and lay it out, rasterise the result with html2canvas,
 * and wrap the pixels in a PDF. Correct Devanagari is not something this module
 * achieves; it is a property of the thing it photographs.
 *
 * THE TRADE. The text in this PDF is an image - not selectable, not searchable,
 * and bigger than a text PDF would be. For a document that gets forwarded on
 * WhatsApp and read on a phone that is the same deal as a photographed bill,
 * which is what it replaces. The browser-print path in reportPdf.ts stays for
 * anyone who needs selectable text.
 *
 * BOTH LIBRARIES ARE LAZY. jsPDF and html2canvas must not sit in the initial
 * bundle for a button most sessions never press - the app chunk is ~73 KB
 * gzipped and hosting is 360 MB/day (R-10). They are imported inside the
 * function, and vite.config.ts gives them their own `pdf` chunk so they are not
 * swept into the always-loaded `vendor` chunk.
 */

/**
 * A4 landscape, in millimetres, matching `@page { size: A4 landscape }` in the
 * report's own stylesheet. Landscape because the outstanding report is nine
 * columns wide and portrait squeezes it to nothing.
 */
const PAGE_MM = { width: 297, height: 210, margin: 10 } as const
const CONTENT_MM = {
  width: PAGE_MM.width - PAGE_MM.margin * 2,
  height: PAGE_MM.height - PAGE_MM.margin * 2,
} as const

/**
 * The CSS width the report is laid out at before capture.
 *
 * 1040 px is ~275 mm at 96 dpi, so the page composes at very nearly its printed
 * size and an 11 px table cell lands at ~8 pt on paper, which is what the print
 * stylesheet intends. Fixing it also makes the output independent of the device
 * that produced it: the same report is the same PDF from a phone and from a
 * desktop, rather than reflowing to whatever window happened to be open.
 */
const MOUNT_WIDTH_PX = 1040

/** Device pixels per CSS pixel in the capture. 2 keeps 8 pt text crisp. */
const CAPTURE_SCALE = 2

/**
 * Ceiling on the height of any single capture, in device pixels.
 *
 * A `<canvas>` has a maximum size - 32767 px per side in Chrome, and an area
 * limit as low as ~16 Mpx on iOS - and exceeding it yields a blank canvas with
 * no error at all. A month of attendance for forty labourers is over a thousand
 * rows and tens of thousands of pixels tall, so the page is captured in bands
 * of whole pages rather than in one shot.
 *
 * Deliberately well under the browser ceiling: at 2080 device pixels wide this
 * is already a ~50 MB RGBA buffer, and these are 2 GB phones.
 */
const MAX_CANVAS_PX = 6000

/**
 * JPEG rather than PNG. Black text on white at 2x shows no visible artefact at
 * this quality, and it keeps a twenty-page register to a few MB - it is going
 * into a chat app that people open on metered mobile data.
 */
const JPEG_QUALITY = 0.92

/** One page's worth of the captured page, in CSS pixels from the top. */
export interface PageSlice {
  readonly top: number
  readonly height: number
}

/**
 * A page break may not land in the first quarter of a page.
 *
 * Without this, a safe cut a few pixels below the previous break would emit a
 * sliver page. In practice table rows are ~25 px against a ~700 px page so it
 * never binds; it exists so pathological input degrades to plain fixed-height
 * pagination instead of to thousands of slivers.
 */
const MIN_PAGE_FRACTION = 0.25

/**
 * Where to cut a tall capture into pages.
 *
 * `safeCuts` are y offsets it is safe to break at - the bottom edges of table
 * rows and of the header blocks. Cutting anywhere else slices a row of a wage
 * sheet in half across two pages, which reads as a printing fault. It is the
 * rule the print stylesheet states as `tr { break-inside: avoid }`, applied by
 * hand because a rasterised page has no such concept.
 *
 * Pure, so it is unit tested. Everything around it needs a real layout engine
 * and a real canvas, and cannot be.
 */
export function planPageSlices(
  totalPx: number,
  pagePx: number,
  safeCuts: readonly number[] = [],
): PageSlice[] {
  if (!Number.isFinite(totalPx) || totalPx <= 0) return []
  if (!Number.isFinite(pagePx) || pagePx <= 0) return [{ top: 0, height: totalPx }]

  const cuts = safeCuts
    .filter((c) => Number.isFinite(c) && c > 0 && c < totalPx)
    .slice()
    .sort((a, b) => a - b)

  const slices: PageSlice[] = []
  let top = 0
  while (top < totalPx) {
    const remaining = totalPx - top
    if (remaining <= pagePx) {
      slices.push({ top, height: remaining })
      break
    }
    const limit = top + pagePx
    const earliest = top + pagePx * MIN_PAGE_FRACTION
    // The last safe cut that still fits on this page. Falls back to a hard cut
    // at the page boundary when there is no row edge to use.
    let cut = limit
    for (const c of cuts) {
      if (c > limit) break
      if (c > earliest) cut = c
    }
    slices.push({ top, height: cut - top })
    top = cut
  }
  return slices
}

/** An inclusive run of page indices captured in one html2canvas pass. */
export interface CaptureBand {
  readonly from: number
  readonly to: number
}

/**
 * Groups consecutive pages into capture bands no taller than the canvas limit.
 *
 * Bands are whole numbers of pages, so a page is never split across two
 * captures and never has to be stitched back together. Each band costs one full
 * html2canvas pass over the document, so they are made as large as the canvas
 * allows: a twenty-page register is four passes, not twenty.
 */
export function planCaptureBands(slices: readonly PageSlice[], maxBandPx: number): CaptureBand[] {
  const bands: CaptureBand[] = []
  let from = 0
  let height = 0
  for (let i = 0; i < slices.length; i++) {
    const h = slices[i]?.height ?? 0
    // `i > from` keeps a single over-tall page in a band of its own rather than
    // emitting an empty band and making no progress.
    if (i > from && height + h > maxBandPx) {
      bands.push({ from, to: i - 1 })
      from = i
      height = 0
    }
    height += h
  }
  if (slices.length > 0) bands.push({ from, to: slices.length - 1 })
  return bands
}

/**
 * A filename that survives Windows, Android and a chat app.
 *
 * Devanagari is deliberately preserved: a project called "साइट-२" should produce
 * a file the owner can recognise in their downloads list. Only the characters
 * that are genuinely illegal in a path are replaced.
 */
export function pdfFilename(base: string): string {
  const cleaned = base
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    // Whitespace first, and it has to be first: a newline is BOTH whitespace
    // and a control character, and running the control rule first turns a
    // wrapped title into "wage sheet -" instead of "wage sheet".
    .replace(/\s+/g, ' ')
    // Path separators, and the characters Windows reserves in a filename.
    .replace(/[\\/:*?"<>|]/g, '-')
    // \p{Cc} is the control-character category - what is left after the
    // whitespace pass. They render as boxes in a downloads list, and a
    // line break in a filename is a header-injection shape.
    .replace(/\p{Cc}/gu, '-')
    .trim()
    // A leading dot hides the file on Unix and confuses Android's downloads UI.
    .replace(/^\.+/, '')
    .slice(0, 120)
    // Windows silently strips trailing dots and spaces, which breaks "open".
    .replace(/[ .]+$/, '')
  // A name with nothing readable left in it - "///" became "---" - is not a
  // name. Better a generic file the owner can rename than punctuation soup.
  const usable = /[\p{L}\p{N}]/u.test(cleaned)
  return `${usable ? cleaned : 'report'}.pdf`
}

/** Two frames, so the browser has really laid out and painted what we set. */
function nextPaint(win: Window): Promise<void> {
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
  })
}

/**
 * Waits for every font the document needs.
 *
 * THIS IS THE DEVANAGARI GUARANTEE. html2canvas rasterises whatever is laid out
 * the instant it runs. If a Devanagari face is still loading, the text has been
 * laid out in a fallback that may have no conjunct coverage at all, and the
 * photograph freezes that fallback into the PDF permanently - there is no
 * reflow afterwards, because it is a picture. Both font sets matter: the
 * frame's own, and the host page's, since a face the app has already downloaded
 * is reused by the frame without a second load event.
 */
async function fontsReady(frame: Document): Promise<void> {
  const sets = [document.fonts, frame.fonts].filter((f) => f !== undefined)
  await Promise.all(sets.map((f) => f.ready))
}

/**
 * Mounts `html`, rasterises it, and returns it as a PDF file.
 *
 * The mount is an iframe rather than a hidden `<div>`, for two reasons. The
 * report's stylesheet is a whole-document stylesheet - it styles `body`, `*`
 * and bare `table`/`th`/`td` - so inlining it would repaint the app around it.
 * And Tailwind v4's preflight declares colours as `oklch()`, which
 * html2canvas 1.4.1's CSS parser does not understand and throws on; a frame
 * carrying only the report's own stylesheet never sees one.
 */
export async function renderHtmlToPdfBlob(html: string, filename: string): Promise<File> {
  const frame = document.createElement('iframe')
  // Off-screen rather than hidden: `display:none` has no layout at all and
  // `visibility:hidden` is not reliably painted, and we need a real layout.
  frame.style.cssText =
    `position:fixed;left:-20000px;top:0;width:${MOUNT_WIDTH_PX}px;height:${MOUNT_WIDTH_PX}px;` +
    'border:0;pointer-events:none;'
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.title = 'Report render surface'

  try {
    document.body.appendChild(frame)

    // srcdoc inherits this page's origin, so contentDocument stays readable.
    await new Promise<void>((resolve, reject) => {
      frame.addEventListener('load', () => resolve(), { once: true })
      frame.addEventListener('error', () => reject(new Error('Could not lay out the report.')), {
        once: true,
      })
      frame.srcdoc = html
    })

    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) throw new Error('Could not lay out the report.')

    // The report's own "Print / Save as PDF" button is hidden by `@media print`,
    // but this is a screen rendering, so it would otherwise land in the PDF.
    const hide = doc.createElement('style')
    hide.textContent = '.noprint{display:none!important}'
    doc.head.appendChild(hide)

    await fontsReady(doc)
    await nextPaint(win)

    // Grow the frame to the whole document so nothing is clipped to a viewport.
    const contentHeight = Math.max(
      doc.documentElement.scrollHeight,
      doc.body.scrollHeight,
      Math.ceil(doc.body.getBoundingClientRect().height),
    )
    frame.style.height = `${contentHeight}px`
    await nextPaint(win)

    const body = doc.body
    const bodyBox = body.getBoundingClientRect()
    const totalPx = Math.max(1, Math.ceil(bodyBox.height))

    // One PDF page's worth of layout, in the CSS pixels the DOM measures in.
    const pagePx = (MOUNT_WIDTH_PX * CONTENT_MM.height) / CONTENT_MM.width
    const safeCuts = [...doc.querySelectorAll('tr, .stat, .doctitle, .sign, footer')].map(
      (el) => el.getBoundingClientRect().bottom - bodyBox.top,
    )
    const slices = planPageSlices(totalPx, pagePx, safeCuts)
    const bands = planCaptureBands(slices, MAX_CANVAS_PX / CAPTURE_SCALE)

    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ])

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })

    // Reused across pages, so a long report allocates one page canvas rather
    // than one per page. Band canvases are released the same way.
    const page = document.createElement('canvas')
    const pageCtx = page.getContext('2d')
    if (!pageCtx) throw new Error('This browser cannot draw the report.')

    let pageIndex = 0
    for (const band of bands) {
      const first = slices[band.from]
      const last = slices[band.to]
      if (!first || !last) continue
      const bandTop = first.top
      const bandHeight = last.top + last.height - bandTop

      const shot = await html2canvas(body, {
        backgroundColor: '#ffffff',
        scale: CAPTURE_SCALE,
        logging: false,
        // x/y/width/height crop the render: the canvas comes back exactly
        // `width x height` CSS pixels multiplied by `scale`.
        x: 0,
        y: bandTop,
        width: MOUNT_WIDTH_PX,
        height: bandHeight,
        // Pin the cloned viewport, so neither media queries nor layout can
        // depend on the size of the window the operator happens to have open.
        windowWidth: MOUNT_WIDTH_PX,
        windowHeight: contentHeight,
        scrollX: 0,
        scrollY: 0,
      })

      for (let i = band.from; i <= band.to; i++) {
        const slice = slices[i]
        if (!slice) continue
        page.width = Math.max(1, Math.round(MOUNT_WIDTH_PX * CAPTURE_SCALE))
        page.height = Math.max(1, Math.round(slice.height * CAPTURE_SCALE))
        // Assigning width/height clears the canvas, so paint the paper white:
        // a short final page would otherwise be transparent, which prints black
        // in some viewers.
        pageCtx.fillStyle = '#ffffff'
        pageCtx.fillRect(0, 0, page.width, page.height)
        pageCtx.drawImage(
          shot,
          0,
          Math.round((slice.top - bandTop) * CAPTURE_SCALE),
          page.width,
          page.height,
          0,
          0,
          page.width,
          page.height,
        )

        if (pageIndex > 0) pdf.addPage('a4', 'landscape')
        pdf.addImage(
          page.toDataURL('image/jpeg', JPEG_QUALITY),
          'JPEG',
          PAGE_MM.margin,
          PAGE_MM.margin,
          CONTENT_MM.width,
          // Aspect is preserved from the capture, so a short last page is drawn
          // short rather than stretched down the sheet.
          (CONTENT_MM.width * slice.height) / MOUNT_WIDTH_PX,
        )
        pageIndex++
      }

      // Release the band before capturing the next one. A twenty-page register
      // would otherwise hold every band alive at once.
      shot.width = 0
      shot.height = 0
    }
    page.width = 0
    page.height = 0

    return new File([pdf.output('blob')], filename, { type: 'application/pdf' })
  } finally {
    frame.remove()
  }
}
