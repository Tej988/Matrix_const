import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { createSettingsRepository } from '@mc/shared/repositories/settings'
import {
  Dates,
  Money,
  boqTotals,
  contractCoverage,
  remainingQty,
  completionPercent,
  suggestCode,
} from '@mc/shared'
import {
  UNITS,
  UNIT_LABELS,
  type BoqItem,
  type BusinessProfile,
  type Paise,
  type Unit,
} from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'
import { BulkBoqForm } from './BulkBoqForm'
import {
  DEFAULT_ATTENTION,
  DEFAULT_COVERING,
  defaultQuotationTerms,
  openPrintWindow,
  writeQuotation,
  type QuotationDetails,
  type QuotationLine,
} from './QuotationPdf'
import {
  BUSINESS_NOT_SET_WARNING,
  hasBusinessName,
  letterheadFor,
  useBusinessProfile,
} from '../settings/BusinessProfileForm'

/**
 * The rate card. Section 5 - every rate is configurable per project, and none
 * of the sample figures from the spec are hardcoded anywhere.
 */
export function BoqSection({
  projectId,
  contractValuePaise,
}: {
  projectId: string
  /** Absent on a job with no agreed total, which is most of them (R-01). */
  contractValuePaise?: Paise | undefined
}) {
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createBoqRepository(db), [])
  /* Two ways in, one at a time: a form and a paste area open together is just
     two places to lose your work. Quoting shares the switch for the same
     reason. */
  const [mode, setMode] = useState<'none' | 'single' | 'bulk' | 'quote'>('none')

  const items = useQuery({
    queryKey: ['boq', projectId],
    queryFn: () => repo.listForProject(projectId),
  })

  if (items.isPending) return <p className="text-slate-500">Loading rate card…</p>
  if (items.isError) {
    return (
      <QueryError error={items.error} onRetry={() => void items.refetch()} what="the rate card" />
    )
  }

  const totals = boqTotals(items.data)
  const coverage = contractCoverage(items.data, contractValuePaise)
  const showMoney = can('financials:view')

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Rate card (BOQ)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}
            {totals.itemCount > 0 && ` · ${totals.completionPercent}% complete by value`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The rate card IS the quotation, minus the quantities. Offered here
              rather than under Reports because this is the screen the rates
              were typed on. */}
          {showMoney && items.data.length > 0 && (
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'quote' ? 'none' : 'quote'))}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
            >
              {mode === 'quote' ? t('cancel') : 'Quotation'}
            </button>
          )}
          {can('boq:write') && (
            <>
              {/* A real BOQ is dozens of lines. The paste route is offered beside
                  the form, not buried behind it. */}
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'bulk' ? 'none' : 'bulk'))}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
              >
                {mode === 'bulk' ? t('cancel') : t('pasteFromSheet')}
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'single' ? 'none' : 'single'))}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                {mode === 'single' ? t('cancel') : t('addWorkItem')}
              </button>
            </>
          )}
        </div>
      </div>

      {mode === 'single' && (
        <AddBoqItemForm
          projectId={projectId}
          existingCodes={items.data.map((i) => i.code)}
          nextSortOrder={items.data.length}
          onDone={() => setMode('none')}
        />
      )}

      {mode === 'bulk' && (
        <BulkBoqForm
          projectId={projectId}
          existingCodes={items.data.map((i) => i.code)}
          existingNames={items.data.map((i) => i.name)}
          nextSortOrder={items.data.length}
          onDone={() => setMode('none')}
        />
      )}

      {mode === 'quote' && <QuotationPanel projectId={projectId} items={items.data} />}

      {items.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">No work items yet.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Add the agreed items and rates — measurements and bills are built from these.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3 text-right">Contract</th>
                {showMoney && <th className="p-3 text-right">Rate</th>}
                {showMoney && <th className="p-3 text-right">Amount</th>}
                <th className="p-3 text-right">Done</th>
                <th className="p-3 text-right">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {items.data.map((i) => (
                <tr key={i.id}>
                  <td className="p-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{i.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {i.code}
                      {i.status === 'CLOSED' && ' · closed'}
                    </p>
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {i.contractQty.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs text-slate-400">{UNIT_LABELS[i.unit]}</span>
                  </td>
                  {showMoney && (
                    <td className="p-3 text-right">
                      <Amount paise={i.ratePaise} />
                    </td>
                  )}
                  {showMoney && (
                    <td className="p-3 text-right font-medium">
                      <Amount paise={i.contractAmountPaise} />
                    </td>
                  )}
                  <td className="p-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {i.completedQty.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs text-slate-400">{completionPercent(i)}%</span>
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {remainingQty(i).toLocaleString('en-IN')}
                  </td>
                </tr>
              ))}
            </tbody>
            {showMoney && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                <tr className="font-medium text-slate-900 dark:text-slate-100">
                  <td className="p-3" colSpan={3}>
                    Rate card total
                  </td>
                  <td className="p-3 text-right">
                    <Amount paise={totals.contractValuePaise} />
                  </td>
                  <td className="p-3 text-right" colSpan={2}>
                    <Amount paise={totals.completedValuePaise} /> done
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/*
        A rate card that does not add up to the contract value is not
        necessarily wrong - a contract can include unitemised work - but the
        owner should see the gap here rather than discover it at billing.

        `coverage` is null when the project has no agreed total, and then
        nothing renders: there is no second figure to reconcile against, and
        the warning was comparing a real rate card to an invented contract
        value ("totals ₹7,000 against a ₹50,00,000 contract" - R-01).
      */}
      {showMoney && items.data.length > 0 && coverage && !coverage.matches && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The rate card totals <Amount paise={coverage.boqTotalPaise} />, but the contract value is{' '}
          <Amount paise={coverage.contractValuePaise} /> &mdash; a difference of{' '}
          <Amount paise={coverage.differencePaise} signed />.{' '}
          {coverage.differencePaise > 0
            ? 'Some contract work may not be itemised yet.'
            : 'The rate card exceeds the agreed contract.'}
        </p>
      )}
    </section>
  )
}

function AddBoqItemForm({
  projectId,
  existingCodes,
  nextSortOrder,
  onDone,
}: {
  projectId: string
  existingCodes: string[]
  nextSortOrder: number
  onDone: () => void
}) {
  const user = useCurrentUser()
  const repo = useMemo(() => createBoqRepository(db), [])
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [unit, setUnit] = useState<Unit>('SQFT')
  const [qtyInput, setQtyInput] = useState('')
  const [rateInput, setRateInput] = useState('')

  const qty = Number(qtyInput.replace(/,/g, ''))
  const qtyValid = qtyInput.trim() !== '' && Number.isFinite(qty) && qty > 0

  let ratePaise: Paise | null = null
  let rateError: string | null = null
  if (rateInput.trim() !== '') {
    try {
      ratePaise = Money.parseRupees(rateInput)
    } catch {
      rateError = 'Enter a rate like 120'
    }
  }

  // The live total is the whole point: 2500 × ₹120 should read ₹3,00,000
  // before anyone commits it.
  const amount = qtyValid && ratePaise !== null ? Money.multiplyQty(qty, ratePaise) : null

  const create = useMutation({
    mutationFn: () => {
      if (!qtyValid || ratePaise === null) throw new Error('Form is incomplete')
      return repo.create(
        projectId,
        {
          code: code.trim() || suggestCode(name, existingCodes),
          name: name.trim(),
          unit,
          contractQty: qty,
          ratePaise,
        },
        nextSortOrder,
        user.uid,
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['boq', projectId] })
      onDone()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Work item">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flooring"
            className={inputClass}
          />
        </Field>
        <Field label="Code (optional)">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={name ? suggestCode(name, existingCodes) : 'FLO-01'}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Unit">
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className={inputClass}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contract quantity">
          <input
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            inputMode="decimal"
            placeholder="10000"
            className={inputClass}
          />
        </Field>
        <Field label="Rate per unit">
          <input
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            inputMode="decimal"
            placeholder="120"
            className={inputClass}
          />
          {rateError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{rateError}</p>}
        </Field>
      </div>

      {amount !== null && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {qty.toLocaleString('en-IN')} {UNIT_LABELS[unit]} × <Amount paise={ratePaise!} /> ={' '}
          <AmountWithWords paise={amount} />
        </p>
      )}

      {create.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(create.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={!qtyValid || ratePaise === null || name.trim() === '' || create.isPending}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {create.isPending ? 'Adding…' : 'Add work item'}
      </button>
    </form>
  )
}

/**
 * Quotation from the rate card, in the format the owner already issues.
 *
 * Split in two so the stored Terms & Conditions can seed the textarea through
 * a useState initialiser instead of an effect that syncs state to a query.
 */
function QuotationPanel({ projectId, items }: { projectId: string; items: readonly BoqItem[] }) {
  const { t } = useTranslation()
  const business = useBusinessProfile()

  if (business.isPending) return <p className="text-slate-500">{t('loading')}</p>
  if (business.isError) {
    return (
      <QueryError
        error={business.error}
        onRetry={() => void business.refetch()}
        what="the business details"
      />
    )
  }

  return <QuotationFields projectId={projectId} items={items} business={business.data} />
}

function QuotationFields({
  projectId,
  items,
  business,
}: {
  projectId: string
  items: readonly BoqItem[]
  business: BusinessProfile
}) {
  const { t } = useTranslation()
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const settingsRepo = useMemo(() => createSettingsRepository(db), [])

  const [reference, setReference] = useState('')
  const [workTitle, setWorkTitle] = useState('')
  const [terms, setTerms] = useState(() => defaultQuotationTerms(business).join('\n'))
  const [error, setError] = useState<string | null>(null)

  /*
   * Rates only - no quantity, no amount, no total. Nothing has been measured
   * yet, so a total here would be a guess printed like a commitment.
   *
   * Closed items are dropped: finished work is not something you quote for.
   */
  const lines: QuotationLine[] = items
    .filter((i) => i.status === 'ACTIVE')
    .map((i) => ({
      description: i.description ? `${i.name} — ${i.description}` : i.name,
      unit: i.unit,
      ratePaise: i.ratePaise,
    }))

  const print = useMutation({
    // The window is claimed synchronously in the click handler below and passed
    // in. Opening it here, after the await, loses user-activation and the
    // browser blocks the pop-up silently.
    mutationFn: async (win: Window) => {
      // Both read fresh: this sheet goes to a client, so a site address or a
      // letterhead corrected a minute ago has to be on it.
      const [project, profile] = await Promise.all([
        projectRepo.get(projectId),
        settingsRepo.getBusiness(),
      ])

      const details: QuotationDetails = {
        date: Dates.todayKey(),
        attention: DEFAULT_ATTENTION,
        clientName: project?.clientName ?? '',
        projectName: project?.name ?? '',
        workTitle: workTitle.trim() || 'the work detailed below',
        covering: DEFAULT_COVERING,
        terms: terms.split('\n'),
        // Conditional spread - exactOptionalPropertyTypes rejects an explicit
        // undefined where the property is merely optional.
        ...(reference.trim() ? { ref: reference.trim() } : {}),
        ...(project?.siteAddress ? { siteAddress: project.siteAddress } : {}),
      }

      writeQuotation(win, details, lines, letterheadFor(profile))
    },
    onError: (e, win) => {
      // Otherwise the claimed window sits on "Preparing…" forever.
      win.close()
      setError((e as Error).message)
    },
  })

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      {!hasBusinessName(business) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {BUSINESS_NOT_SET_WARNING}
        </p>
      )}

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Prints the {lines.length} open rate card {lines.length === 1 ? 'item' : 'items'} as a
        quotation — description, unit and rate. Quantities and totals are left off deliberately.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${t('reference')} (${t('optional')})`}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="LS/2026/014"
            className={inputClass}
          />
        </Field>
        <Field label="Work quoted">
          <input
            value={workTitle}
            onChange={(e) => setWorkTitle(e.target.value)}
            placeholder="Tile & marble fitting work"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Terms & Conditions — one per line">
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={4}
          className={inputClass}
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={print.isPending || lines.length === 0}
        onClick={() => {
          setError(null)
          const win = openPrintWindow()
          if (!win) {
            setError(t('popupBlocked'))
            return
          }
          print.mutate(win)
        }}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {print.isPending ? t('preparing') : t('print')}
      </button>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  )
}
