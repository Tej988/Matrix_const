import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { createLabourRepository, createAttendanceRepository } from '@mc/shared/repositories/labour'
import {
  Dates,
  Money,
  toCsv,
  csvAmount,
  csvBlobParts,
  calculateOutstanding,
  calculateWage,
} from '@mc/shared'
import type { DateKey, Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import { openReportForPrint } from './reportPdf'

/**
 * Reports and export. Sections 37 and 41.
 *
 * Each report is declared ONCE as columns plus rows, then rendered to either
 * PDF or CSV. Defining it twice would guarantee the two drift apart, and a
 * printed report that disagrees with the spreadsheet is worse than having
 * only one of them.
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

const forCsv = (cell: Cell, kind: ColumnKind): string =>
  kind === 'amount' ? csvAmount(Number(cell)) : String(cell)

const forPrint = (cell: Cell, kind: ColumnKind): string =>
  kind === 'amount'
    ? Money.formatPaise(Number(cell) as Paise)
    : kind === 'number'
      ? Number(cell).toLocaleString('en-IN')
      : String(cell)

export function ReportsPage() {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const paymentRepo = useMemo(() => createPaymentRepository(db), [])
  const billRepo = useMemo(() => createBillRepository(db), [])
  const boqRepo = useMemo(() => createBoqRepository(db), [])
  const labourRepo = useMemo(() => createLabourRepository(db), [])
  const attendanceRepo = useMemo(() => createAttendanceRepository(db), [])

  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState(Dates.currentPeriod() as string)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

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

  async function emit(key: string, format: 'pdf' | 'csv', build: () => Promise<ReportData>) {
    setBusy(`${key}-${format}`)
    setError(null)
    try {
      const data = await build()

      if (format === 'csv') {
        const csv = toCsv(
          data.columns.map((c) => c.header),
          data.rows.map((row) =>
            row.map((cell, i) => forCsv(cell, data.columns[i]?.kind ?? 'text')),
          ),
        )
        const [content, mime] = csvBlobParts(csv)
        const url = URL.createObjectURL(new Blob([content], { type: mime }))
        const a = document.createElement('a')
        a.href = url
        a.download = `${data.file}.csv`
        a.click()
        URL.revokeObjectURL(url)
        return
      }

      const opened = openReportForPrint(
        {
          title: data.title,
          businessName: 'Matrix Construction',
          ...(data.subtitle ? { subtitle: data.subtitle } : {}),
          ...(data.stats ? { stats: data.stats } : {}),
          ...(data.totals
            ? { totals: data.totals.map((c, i) => forPrint(c, data.columns[i]?.kind ?? 'text')) }
            : {}),
          numericColumns: data.columns
            .map((c, i) => (c.kind === 'text' ? -1 : i))
            .filter((i) => i >= 0),
        },
        data.columns.map((c) => c.header),
        data.rows.map((row) =>
          row.map((cell, i) => forPrint(cell, data.columns[i]?.kind ?? 'text')),
        ),
      )
      if (!opened) {
        setError(t('popupBlocked'))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
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
              i.contractQty,
              i.ratePaise,
              i.contractAmountPaise,
              i.completedQty,
              i.billedQty,
              Math.round((i.contractQty - i.completedQty) * 1000) / 1000,
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
      <QueryError error={projects.error} onRetry={() => void projects.refetch()} what="projects" />
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
          <Stat label={t('contractValue')} paise={summary.data.contractValuePaise} />
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
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void emit(r.key, 'pdf', r.build)}
                disabled={busy !== null || activeId === ''}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {busy === `${r.key}-pdf` ? t('preparing') : 'PDF'}
              </button>
              <button
                type="button"
                onClick={() => void emit(r.key, 'csv', r.build)}
                disabled={busy !== null || activeId === ''}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-600"
              >
                {busy === `${r.key}-csv` ? t('preparing') : t('excel')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <strong>PDF</strong> opens a print view — choose &ldquo;Save as PDF&rdquo; as the printer.
        <br />
        <strong>Backup (§41).</strong> These downloads are the backup mechanism. There is no
        automatic off-site backup, because that needs a scheduled job the free plan cannot run.
        Download the outstanding, billing and payment reports periodically and keep them safe.
      </p>
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
