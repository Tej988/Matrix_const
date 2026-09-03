import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import { createSettingsRepository } from '@mc/shared/repositories/settings'
import {
  Dates,
  Money,
  toCsv,
  csvAmount,
  csvBlobParts,
  calculateOutstanding,
  calculateWage,
} from '@mc/shared'
import type { BusinessProfile, DateKey, Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import {
  canShareFiles,
  headerFrom,
  openPrintWindow,
  renderReportHtml,
  reportAttachMessage,
  reportShareCaption,
  whatsappUrl,
  writeReport,
  type PrintableReport,
  type ReportHeader,
} from './reportPdf'
import { pdfFilename, renderHtmlToPdfBlob } from './pdfExport'
import { ReportPreview } from './ReportPreview'
import { ReportHeaderDialog } from './ReportHeaderDialog'
import { hasBusinessName, letterheadFor, useBusinessProfile } from '../settings/BusinessProfileForm'

/**
 * Reports and export. Sections 37 and 41.
 *
 * Each report is declared ONCE as columns plus rows, then rendered to the
 * screen, to a printable page, or to a spreadsheet. Defining it twice would
 * guarantee the three drift apart, and a printed report that disagrees with
 * the spreadsheet is worse than having only one of them.
 *
 * The screen comes first. Downloading a file was previously the only way to
 * find out what a report contained, which is backwards - you had to commit to
 * a document to read it. Now: view it, confirm the letterhead, then print or
 * share.
 *
 * Amount cells carry raw paise; the renderer decides the presentation - Indian
 * digit grouping for print, a plain decimal for the spreadsheet (where
 * "18,50,000" would split across three columns).
 */

type ColumnKind = 'text' | 'number' | 'amount'
interface Column {
  header: string
  kind: ColumnKind
}
type Cell = string | number

interface ReportData {
  file: string
  title: string
  subtitle?: string
  columns: Column[]
  rows: Cell[][]
  stats?: { label: string; value: string }[]
  totals?: Cell[]
}

/**
 * An empty string is a spacer in a totals row, not a zero.
 *
 * `Number('')` is 0, which printed "Rs 0" under a Rate column that has no
 * meaningful total. An empty cell stays empty.
 */
const forCsv = (cell: Cell, kind: ColumnKind): string =>
  cell === '' ? '' : kind === 'amount' ? csvAmount(Number(cell)) : String(cell)

const forPrint = (cell: Cell, kind: ColumnKind): string =>
  cell === ''
    ? ''
    : kind === 'amount'
      ? Money.formatPaise(Number(cell) as Paise)
      : kind === 'number'
        ? Number(cell).toLocaleString('en-IN')
        : String(cell)

/** Column indices to right-align. Numeric columns, essentially. */
const numericColumnsOf = (columns: readonly Column[]): number[] =>
  columns.map((c, i) => (c.kind === 'text' ? -1 : i)).filter((i) => i >= 0)

/**
 * The one place a report is turned into something presentable. The preview and
 * the print window both consume the result, so they cannot disagree.
 */
function toPrintable(data: ReportData, header: ReportHeader): PrintableReport {
  const kindAt = (i: number): ColumnKind => data.columns[i]?.kind ?? 'text'
  return {
    header,
    columns: data.columns.map((c) => c.header),
    numericColumns: numericColumnsOf(data.columns),
    rows: data.rows.map((row) => row.map((cell, i) => forPrint(cell, kindAt(i)))),
    ...(data.stats ? { stats: data.stats } : {}),
    ...(data.totals ? { totals: data.totals.map((c, i) => forPrint(c, kindAt(i))) } : {}),
  }
}

function csvFileFor(data: ReportData): File {
  const kindAt = (i: number): ColumnKind => data.columns[i]?.kind ?? 'text'
  const csv = toCsv(
    data.columns.map((c) => c.header),
    data.rows.map((row) => row.map((cell, i) => forCsv(cell, kindAt(i)))),
  )
  const [content, mime] = csvBlobParts(csv)
  return new File([content], `${data.file}.csv`, { type: mime })
}

/**
 * An unset business name prints the loud placeholder rather than an empty
 * band across the top of the page - letterheadFor()'s rule, applied to a
 * per-document header. A blank heading looks like a rendering fault and gets
 * sent to a client anyway.
 */
function withPlaceholder(header: ReportHeader): ReportHeader {
  if (header.businessName.trim() !== '') return header
  return { ...header, businessName: letterheadFor(undefined).name }
}

/**
 * Saves a File the page is already holding.
 *
 * The anchor is attached before it is clicked - Firefox ignores a click on a
 * detached anchor - and the object URL is released on a timer rather than on
 * the next line: revoking it synchronously can cancel a download the browser
 * has only just queued, which showed up as a silently missing file.
 */
function saveFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Opens WhatsApp's contact picker with a message ready to send.
 *
 * A real link rather than `window.open()`: a navigation is never pop-up
 * blocked, and on desktop wa.me hands off to web.whatsapp.com by itself.
 */
function openWhatsapp(text: string): void {
  const a = document.createElement('a')
  a.href = whatsappUrl(text)
  a.target = '_blank'
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** A report that has been built and is on screen. */
interface OpenReport {
  data: ReportData
  /** The stored profile exactly as saved - the dialog needs to see it empty. */
  saved: BusinessProfile
  /** Editable for this document only. Never written back to Settings. */
  header: ReportHeader
}

export function ReportsPage() {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])
  const billRepo = useMemo(() => createBillRepository(db), [])
  const boqRepo = useMemo(() => createBoqRepository(db), [])
  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])
  const settingsRepo = useMemo(() => createSettingsRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState(Dates.currentPeriod() as string)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<OpenReport | null>(null)
  const [dialog, setDialog] = useState<'print' | 'header' | null>(null)
  /* The rendered PDF, remembered alongside the exact report it was rendered
     from. See readyPdf below. */
  const [pdf, setPdf] = useState<{ of: PrintableReport; file: File } | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  /* Only drives the warning below - view() re-reads the profile so the
     letterhead on a document is never a stale cache. */
  const business = useBusinessProfile()
  const letterheadMissing = business.isSuccess && !hasBusinessName(business.data)

  const printable = useMemo(
    () => (open ? toPrintable(open.data, withPlaceholder(open.header)) : null),
    [open],
  )
  const csvFile = useMemo(() => (open ? csvFileFor(open.data) : null), [open])
  /* False on essentially every desktop. The spreadsheet share button does not
     render where it would not work, rather than failing on the tap. */
  const canAttachCsv = useMemo(() => (csvFile ? canShareFiles([csvFile]) : false), [csvFile])

  /* A built PDF belongs to the exact report it was built from. Comparing
     identity, rather than clearing the cache wherever the report changes, is
     what makes it impossible to send a client last minute's letterhead: edit
     the header and `printable` is a new object, so the old PDF stops counting
     as ready and has to be rendered again. */
  const readyPdf = pdf !== null && pdf.of === printable ? pdf.file : null

  const activeId = projectId || projects.data?.[0]?.id || ''
  const activeProject = projects.data?.find((p) => p.id === activeId)

  const summary = useQuery({
    queryKey: ['project-summary', activeId],
    queryFn: () => projectRepo.getSummary(activeId),
    enabled: activeId !== '',
  })

  const days = Dates.daysInPeriod(period as ReturnType<typeof Dates.currentPeriod>)
  const from = days[0] as DateKey
  const to = days.at(-1) as DateKey
  const periodLabel = Dates.formatPeriod(period as ReturnType<typeof Dates.currentPeriod>)

  /** Builds the report and puts it on screen. Nothing is generated yet. */
  async function view(key: string, build: () => Promise<ReportData>) {
    setBusy(key)
    setError(null)
    setNotice(null)
    setDialog(null)
    try {
      // The letterhead is read here rather than compiled in. It was a literal
      // once and put the wrong business on real documents.
      const [data, saved] = await Promise.all([build(), settingsRepo.getBusiness()])
      setOpen({
        data,
        saved,
        header: headerFrom(saved, {
          title: data.title,
          date: Dates.todayKey(),
          ...(data.subtitle ? { subtitle: data.subtitle } : {}),
        }),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Opens the browser's print view.
   *
   * Fully synchronous, and that is the point: the report was built when it was
   * viewed, so `window.open()` still holds the user-activation from this
   * click. Opening it after an await loses that activation and every browser
   * blocks the pop-up silently - which is exactly how this broke the first time.
   *
   * Kept alongside the generated PDF because the two are not the same artefact.
   * This one has real, selectable, searchable text; the generated one is a
   * photograph of the page. Anyone who has to copy a figure out of the document
   * wants this path.
   */
  function openPrintView(header: ReportHeader) {
    if (!open) return
    const win = openPrintWindow()
    if (!win) {
      setError(t('popupBlocked'))
      return
    }
    writeReport(win, toPrintable(open.data, withPlaceholder(header)))
    setOpen({ ...open, header })
    setDialog(null)
  }

  /**
   * Renders the sheet on screen into a real PDF binary.
   *
   * Slow - seconds on a long register, because the browser has to lay the whole
   * report out and then photograph it - so the result is cached against the
   * report it came from and the button says so while it runs.
   */
  async function preparePdf(): Promise<File | null> {
    if (!open || !printable) return null
    if (readyPdf) return readyPdf
    setPdfBusy(true)
    setError(null)
    try {
      const file = await renderHtmlToPdfBlob(
        renderReportHtml(printable),
        pdfFilename(open.data.file),
      )
      setPdf({ of: printable, file })
      return file
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setPdfBusy(false)
    }
  }

  /** Saving to disk needs no user-activation, so this one await is harmless. */
  async function downloadPdf() {
    const file = await preparePdf()
    if (file) saveFile(file)
  }

  /**
   * Hands the PDF to WhatsApp.
   *
   * SYNCHRONOUS, AND IT HAS TO BE. `navigator.share()` lives under the same
   * transient-activation rule that made `window.open()` fail after an await:
   * the activation expires in about five seconds, and rendering a month of
   * attendance takes longer than that. Awaiting the render here would give a
   * NotAllowedError on exactly the long reports that most need sending.
   *
   * So the PDF is built by a previous, separate tap - `readyPdf` is non-null
   * before this button is even offered - and this handler does nothing but hand
   * over a file it already holds. Two taps is the price of getting the document
   * itself into the chat instead of a retyped summary of it.
   */
  function shareReportPdf() {
    if (!readyPdf || !printable) return
    setError(null)
    if (canShareFiles([readyPdf])) {
      void navigator
        .share({
          files: [readyPdf],
          title: printable.header.title,
          text: reportShareCaption(printable),
        })
        .catch((e: Error) => {
          // Dismissing the share sheet rejects with AbortError. Not a failure.
          if (e.name !== 'AbortError') setError(e.message)
        })
      return
    }
    // No desktop browser can push a file into another application, so the file
    // goes to disk and WhatsApp opens with a covering note. Announced in the
    // UI below rather than done quietly: a button that sent text while looking
    // like it sent the document is the thing this whole change is undoing.
    saveFile(readyPdf)
    openWhatsapp(reportAttachMessage(printable, readyPdf.name))
    setNotice(t('pdfDownloadedNotice', { file: readyPdf.name }))
  }

  function downloadCsv() {
    if (csvFile) saveFile(csvFile)
  }

  /**
   * The spreadsheet is the one artefact we hold as a real binary, so it is the
   * one thing that can genuinely be attached. Called straight from the click -
   * navigator.share() needs the same user-activation window.open() does.
   */
  function shareCsv() {
    if (!csvFile || !printable) return
    void navigator.share({ files: [csvFile], title: printable.header.title }).catch((e: Error) => {
      // Dismissing the share sheet rejects with AbortError. Not a failure.
      if (e.name !== 'AbortError') setError(e.message)
    })
  }

  const reports: {
    key: string
    title: string
    description: string
    build: () => Promise<ReportData>
  }[] = [
    {
      key: 'outstanding',
      title: 'Outstanding report',
      description: 'Every project: contract, billed, received, and all three outstanding figures.',
      build: async () => {
        const all = projects.data ?? []
        const summaries = await Promise.all(all.map((p) => projectRepo.getSummary(p.id)))
        const rows = all.map((p, i) => {
          const s = summaries[i]
          const o = calculateOutstanding({
            contractValuePaise: s?.contractValuePaise ?? p.contractValuePaise,
            totalBilledPaise: s?.totalBilledPaise ?? (0 as Paise),
            totalReceivedPaise: s?.totalReceivedPaise ?? (0 as Paise),
          })
          return [
            p.name,
            p.clientName,
            p.status.replace('_', ' ').toLowerCase(),
            p.contractValuePaise,
            s?.totalBilledPaise ?? 0,
            s?.totalReceivedPaise ?? 0,
            o.receivablePaise,
            o.unbilledBalancePaise,
            o.contractRemainingPaise,
          ] as Cell[]
        })
        const total = (idx: number) => rows.reduce((sum, r) => sum + Number(r[idx]), 0)
        return {
          file: `outstanding-${Dates.todayKey()}`,
          title: 'Outstanding report',
          subtitle: 'All projects',
          columns: [
            { header: 'Project', kind: 'text' },
            { header: 'Client', kind: 'text' },
            { header: 'Status', kind: 'text' },
            { header: 'Contract', kind: 'amount' },
            { header: 'Billed', kind: 'amount' },
            { header: 'Received', kind: 'amount' },
            { header: 'Receivable', kind: 'amount' },
            { header: 'Unbilled', kind: 'amount' },
            { header: 'Contract remaining', kind: 'amount' },
          ],
          rows,
          totals: ['Total', '', '', total(3), total(4), total(5), total(6), total(7), total(8)],
        }
      },
    },
    {
      key: 'attendance',
      title: 'Attendance register',
      description: `Every mark for ${periodLabel}.`,
      build: async () => {
        const records = await attendanceRepo.forProjectInRange(activeId, from, to)
        return {
          file: `attendance-${activeProject?.code || activeId}-${period}`,
          title: 'Attendance register',
          subtitle: `${activeProject?.name ?? ''} · ${periodLabel}`,
          columns: [
            { header: 'Date', kind: 'text' },
            { header: 'Name', kind: 'text' },
            { header: 'Status', kind: 'text' },
            { header: 'Payable days', kind: 'number' },
            { header: 'Rate', kind: 'amount' },
          ],
          rows: records
            .sort(
              (a, b) =>
                a.dateKey.localeCompare(b.dateKey) || a.labourName.localeCompare(b.labourName),
            )
            .map((r) => [
              Dates.formatDateKey(r.dateKey),
              r.labourName,
              r.status.replace('_', ' ').toLowerCase(),
              r.payableUnits,
              r.dailyRatePaise,
            ]),
        }
      },
    },
    {
      key: 'wages',
      title: 'Wage report',
      description: 'Days worked, earned, paid and payable per labourer.',
      build: async () => {
        const [roster, records, payments] = await Promise.all([
          labourRepo.assignmentsForProject(activeId),
          attendanceRepo.forProjectInRange(activeId, from, to),
          paymentRepo.listLabourPayments(activeId),
        ])
        const rows = roster.map((a) => {
          const w = calculateWage(records.filter((r) => r.labourId === a.labourId))
          const paid = payments
            .filter((p) => p.labourId === a.labourId && p.status === 'CONFIRMED')
            .reduce((s, p) => s + p.amountPaise, 0)
          return [
            a.labourName,
            w.presentDays,
            w.halfDays,
            w.absentDays,
            w.payableDays,
            a.dailyRatePaise,
            w.earnedAmountPaise,
            paid,
            w.earnedAmountPaise - paid,
          ] as Cell[]
        })
        const total = (idx: number) => rows.reduce((s, r) => s + Number(r[idx]), 0)
        return {
          file: `wages-${activeProject?.code || activeId}-${period}`,
          title: 'Wage report',
          subtitle: `${activeProject?.name ?? ''} · ${periodLabel}`,
          columns: [
            { header: 'Name', kind: 'text' },
            { header: 'Present', kind: 'number' },
            { header: 'Half days', kind: 'number' },
            { header: 'Absent', kind: 'number' },
            { header: 'Payable days', kind: 'number' },
            { header: 'Rate', kind: 'amount' },
            { header: 'Earned', kind: 'amount' },
            { header: 'Paid', kind: 'amount' },
            { header: 'Payable', kind: 'amount' },
          ],
          rows,
          totals: ['Total', '', '', '', total(4), '', total(6), total(7), total(8)],
        }
      },
    },
    {
      key: 'billing',
      title: 'Billing report',
      description: 'Every bill with its status and how much has been received.',
      build: async () => {
        const bills = await billRepo.listForProject(activeId)
        const rows = bills.map(
          (b) =>
            [
              b.billNumber,
              Dates.formatDateKey(b.billDate),
              b.clientName,
              b.status.replace('_', ' ').toLowerCase(),
              b.subtotalPaise,
              b.netAmountPaise,
              b.amountReceivedPaise,
              b.netAmountPaise - b.amountReceivedPaise,
            ] as Cell[],
        )
        const total = (idx: number) => rows.reduce((s, r) => s + Number(r[idx]), 0)
        return {
          file: `bills-${activeProject?.code || activeId}`,
          title: 'Billing report',
          subtitle: activeProject?.name ?? '',
          columns: [
            { header: 'Bill number', kind: 'text' },
            { header: 'Date', kind: 'text' },
            { header: 'Client', kind: 'text' },
            { header: 'Status', kind: 'text' },
            { header: 'Subtotal', kind: 'amount' },
            { header: 'Net', kind: 'amount' },
            { header: 'Received', kind: 'amount' },
            { header: 'Due', kind: 'amount' },
          ],
          rows,
          totals: ['Total', '', '', '', total(4), total(5), total(6), total(7)],
        }
      },
    },
    {
      key: 'payments',
      title: 'Payment report',
      description: 'Money received from the client, with references.',
      build: async () => {
        const payments = await paymentRepo.listClientPayments(activeId)
        const rows = payments.map(
          (p) =>
            [
              Dates.formatDateKey(p.date),
              p.amountPaise,
              p.method.toLowerCase(),
              p.bankReference ?? '',
              p.status.toLowerCase(),
            ] as Cell[],
        )
        return {
          file: `payments-${activeProject?.code || activeId}`,
          title: 'Payment report',
          subtitle: activeProject?.name ?? '',
          columns: [
            { header: 'Date', kind: 'text' },
            { header: 'Amount', kind: 'amount' },
            { header: 'Method', kind: 'text' },
            { header: 'Reference', kind: 'text' },
            { header: 'Status', kind: 'text' },
          ],
          rows,
          totals: ['Total', rows.reduce((s, r) => s + Number(r[1]), 0), '', '', ''],
        }
      },
    },
    {
      key: 'expenses',
      title: 'Expense report',
      description: 'All recorded expenses by category.',
      build: async () => {
        const expenses = await paymentRepo.listExpenses(activeId)
        const rows = expenses.map(
          (e) =>
            [
              Dates.formatDateKey(e.date),
              e.category.toLowerCase(),
              e.description,
              e.amountPaise,
              e.paymentMethod.replace('_', ' ').toLowerCase(),
            ] as Cell[],
        )
        return {
          file: `expenses-${activeProject?.code || activeId}`,
          title: 'Expense report',
          subtitle: activeProject?.name ?? '',
          columns: [
            { header: 'Date', kind: 'text' },
            { header: 'Category', kind: 'text' },
            { header: 'Description', kind: 'text' },
            { header: 'Amount', kind: 'amount' },
            { header: 'Paid by', kind: 'text' },
          ],
          rows,
          totals: ['Total', '', '', rows.reduce((s, r) => s + Number(r[3]), 0), ''],
        }
      },
    },
    {
      key: 'boq',
      title: 'Rate card and progress',
      description: 'Every work item with contract, completed and billed quantities.',
      build: async () => {
        const items = await boqRepo.listForProject(activeId)
        const rows = items.map(
          (i) =>
            [
              i.code,
              i.name,
              i.unit,
              // Empty, never 0 - a rate-only item has no agreed quantity, and a
              // zero in an exported spreadsheet would be read as one.
              i.contractQty ?? '',
              i.ratePaise,
              i.contractAmountPaise ?? '',
              i.completedQty,
              i.billedQty,
              i.contractQty === undefined
                ? ''
                : Math.round((i.contractQty - i.completedQty) * 1000) / 1000,
            ] as Cell[],
        )
        return {
          file: `ratecard-${activeProject?.code || activeId}`,
          title: 'Rate card and progress',
          subtitle: activeProject?.name ?? '',
          columns: [
            { header: 'Code', kind: 'text' },
            { header: 'Item', kind: 'text' },
            { header: 'Unit', kind: 'text' },
            { header: 'Contract qty', kind: 'number' },
            { header: 'Rate', kind: 'amount' },
            { header: 'Contract amount', kind: 'amount' },
            { header: 'Completed', kind: 'number' },
            { header: 'Billed', kind: 'number' },
            { header: 'Remaining', kind: 'number' },
          ],
          rows,
          totals: ['Total', '', '', '', '', rows.reduce((s, r) => s + Number(r[5]), 0), '', '', ''],
        }
      },
    },
  ]

  if (projects.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (projects.isError) {
    return (
      <QueryError
        error={projects.error}
        onRetry={() => void projects.refetch()}
        what={t('projectsTitle')}
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('reportsTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('reportsHint')}</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-lg bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200"
        >
          {notice}
        </p>
      )}

      {letterheadMissing && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t('businessNotSet')}
        </p>
      )}

      {open && printable ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(null)
                setDialog(null)
                setError(null)
                setNotice(null)
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
            >
              ← {t('back')}
            </button>
            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setDialog('header')}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
            >
              {t('editHeader')}
            </button>
            <button
              type="button"
              onClick={() => setDialog('print')}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
            >
              {t('print')}
            </button>
          </div>

          <ReportPreview report={printable} />

          <div className="flex flex-wrap items-center gap-2">
            {/* Two states, one slot. Until the PDF exists there is nothing to
                share, and offering a share button that has to build the file
                first would break the user-activation rule shareReportPdf()
                depends on. */}
            {readyPdf ? (
              <button
                type="button"
                onClick={shareReportPdf}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                {t('shareOnWhatsApp')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void preparePdf()}
                disabled={pdfBusy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {pdfBusy ? t('preparing') : t('generatePdf')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={pdfBusy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-600"
            >
              {t('downloadPdf')}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
            >
              {t('excel')}
            </button>
            {canAttachCsv && (
              <button
                type="button"
                onClick={shareCsv}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
              >
                {t('sendSheetAsFile')}
              </button>
            )}
          </div>

          {/* Say exactly what each button does. A button labelled "Share PDF on
              WhatsApp" that sends text is a lie the owner finds out about in
              front of a client. */}
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <strong>{t('generatePdf')}</strong> {t('pdfExplainMake')}{' '}
            <strong>{t('shareOnWhatsApp')}</strong>
            {t('pdfExplainShare')}
            <br />
            {t('pdfExplainWhere')}
            <br />
            <strong>{t('print')}</strong> {t('pdfExplainPrint')}
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>{t('project')}</span>
              <select
                value={activeId}
                onChange={(e) => setProjectId(e.target.value)}
                className={inputClass}
              >
                {projects.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>{t('monthForAttendance')}</span>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {summary.data && (
            <section className="grid gap-3 sm:grid-cols-4">
              {/* Absent on a job priced by measured work (RISKS.md R-01). */}
              {summary.data.contractValuePaise !== null && (
                <Stat label={t('contractValue')} paise={summary.data.contractValuePaise} />
              )}
              <Stat label={t('billed')} paise={summary.data.totalBilledPaise} />
              <Stat label={t('received')} paise={summary.data.totalReceivedPaise} />
              <Stat label={t('receivable')} paise={summary.data.receivablePaise} />
            </section>
          )}

          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {reports.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{r.title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{r.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void view(r.key, r.build)}
                  disabled={busy !== null || activeId === ''}
                  className="shrink-0 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {busy === r.key ? t('preparing') : t('view')}
                </button>
              </li>
            ))}
          </ul>

          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {t('reportsOpenHint')}
            <br />
            <strong>{t('backupLabel')}</strong> {t('backupHint')}
          </p>
        </>
      )}

      {open && dialog && (
        <ReportHeaderDialog
          initial={open.header}
          saved={open.saved}
          submitLabel={dialog === 'print' ? t('openPrintView') : t('useTheseDetails')}
          onCancel={() => setDialog(null)}
          onSubmit={(header) => {
            if (dialog === 'print') {
              openPrintView(header)
              return
            }
            setOpen({ ...open, header })
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, paise }: { label: string; paise: Paise }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
        <Amount paise={paise} />
      </p>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
