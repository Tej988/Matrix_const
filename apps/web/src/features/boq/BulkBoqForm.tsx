import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { parseBoqPaste, suggestCode, type BoqRowError, type BoqRowWarning } from '@mc/shared'
import { UNIT_LABELS } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'

/**
 * Bulk rate-card entry.
 *
 * A bill of quantities arrives as a spreadsheet, and typing forty lines into a
 * one-item-at-a-time form is how the rate card ends up half entered. So the
 * whole block is pasted, parsed live, and shown as the table it will become -
 * with every rejected line and every duplicate visible - before a single
 * document is written.
 */
export function BulkBoqForm({
  projectId,
  existingCodes,
  existingNames,
  nextSortOrder,
  onDone,
}: {
  projectId: string
  existingCodes: string[]
  existingNames: string[]
  nextSortOrder: number
  onDone: () => void
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const repo = useMemo(() => createBoqRepository(db), [])
  const queryClient = useQueryClient()

  const [text, setText] = useState('')
  /** How many rows actually reached Firestore, so a mid-way failure can say so. */
  const [savedCount, setSavedCount] = useState(0)

  const parsed = useMemo(
    () => parseBoqPaste(text, { existingCodes, existingNames }),
    [text, existingCodes, existingNames],
  )

  const create = useMutation({
    mutationFn: async () => {
      setSavedCount(0)
      // Sequential, not parallel: sortOrder has to follow the paste order, and
      // forty simultaneous writes from a site phone is not a kindness.
      const takenCodes = [...existingCodes]
      for (const [offset, row] of parsed.valid.entries()) {
        const code = row.code ?? suggestCode(row.name, takenCodes)
        takenCodes.push(code)
        await repo.create(
          projectId,
          {
            code,
            name: row.name,
            unit: row.unit,
            contractQty: row.contractQty,
            ratePaise: row.ratePaise,
          },
          nextSortOrder + offset,
          user.uid,
        )
        setSavedCount(offset + 1)
      }
    },
    onSettled: () => {
      // Even a failure half way through leaves rows behind. Refetch either way,
      // so the list on screen is what is actually saved.
      void queryClient.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onSuccess: onDone,
  })

  const validCount = parsed.valid.length
  const rejectedCount = parsed.rows.length - validCount

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div>
        <h3 className="font-medium text-slate-900 dark:text-slate-100">{t('pasteFromSheet')}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Copy the item, unit, quantity and rate columns out of your sheet and paste them below. A
          header row is fine, and so is a comma-separated file.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        aria-label={t('pasteFromSheet')}
        placeholder={'Flooring\tSq.ft\t10000\t120\nPlaster\tSq.ft\t5000\t45'}
        className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
      />

      {parsed.rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="p-2 pl-3">#</th>
                  <th className="p-2">{t('workItem')}</th>
                  <th className="p-2">{t('unit')}</th>
                  <th className="p-2 text-right">{t('contractQty')}</th>
                  <th className="p-2 text-right">{t('ratePerUnit')}</th>
                  <th className="p-2 pr-3 text-right">{t('amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {parsed.rows.map((row) =>
                  row.ok ? (
                    <tr key={row.rowNumber}>
                      <td className="p-2 pl-3 text-xs text-slate-400 tabular-nums">
                        {row.rowNumber}
                      </td>
                      <td className="p-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{row.name}</p>
                        {row.code !== undefined && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{row.code}</p>
                        )}
                        {row.warnings.map((w, i) => (
                          <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                            {describeWarning(w)}
                          </p>
                        ))}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-200">
                        {UNIT_LABELS[row.unit]}
                      </td>
                      <td className="p-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {row.contractQty.toLocaleString('en-IN')}
                      </td>
                      <td className="p-2 text-right">
                        <Amount paise={row.ratePaise} />
                      </td>
                      <td className="p-2 pr-3 text-right font-medium">
                        <Amount paise={row.contractAmountPaise} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.rowNumber} className="bg-red-50 dark:bg-red-950/40">
                      <td className="p-2 pl-3 text-xs text-red-500 tabular-nums">
                        {row.rowNumber}
                      </td>
                      <td className="p-2 pr-3" colSpan={5}>
                        <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                          {row.raw}
                        </p>
                        <p className="text-sm text-red-700 dark:text-red-400">
                          {row.errors.map(describeError).join(' · ')}
                        </p>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                <tr className="font-medium text-slate-900 dark:text-slate-100">
                  <td className="p-3" colSpan={5}>
                    {t('total')}
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                      {validCount} of {parsed.rows.length} rows
                    </span>
                  </td>
                  <td className="p-3 pr-3 text-right">
                    <Amount paise={parsed.totalPaise} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {validCount > 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <AmountWithWords paise={parsed.totalPaise} />
            </p>
          )}

          {rejectedCount > 0 && (
            <p className="text-sm text-red-700 dark:text-red-400">
              {rejectedCount} {rejectedCount === 1 ? 'row' : 'rows'} could not be read and will be
              skipped. Fix them above and they will appear here.
            </p>
          )}
        </>
      )}

      {create.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(create.error as Error).message}
          {savedCount > 0 &&
            ` — ${savedCount} of ${validCount} items were already saved. Remove those lines before trying again.`}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={create.isPending}
          className="rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={validCount === 0 || create.isPending}
          className="flex-1 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {create.isPending
            ? `Adding ${savedCount + 1} of ${validCount}…`
            : `${t('add')} ${validCount} ${validCount === 1 ? 'item' : 'items'}`}
        </button>
      </div>
    </div>
  )
}

function describeError(error: BoqRowError): string {
  switch (error.reason) {
    case 'MISSING_FIELD':
      return `${FIELD_LABELS[error.field]} is missing`
    case 'UNKNOWN_UNIT':
      return `"${error.value}" is not a unit we know`
    case 'BAD_QUANTITY':
      return `"${error.value}" is not a quantity`
    case 'BAD_RATE':
      return `"${error.value}" is not a rate`
    case 'AMOUNT_TOO_LARGE':
      return 'Quantity × rate is beyond the amount limit — check for an extra zero'
  }
}

function describeWarning(warning: BoqRowWarning): string {
  const what = warning.field === 'code' ? 'code' : 'name'
  return warning.reason === 'DUPLICATE_IN_PASTE'
    ? `Same ${what} as row ${warning.firstRowNumber}`
    : `This ${what} is already on the rate card`
}

/**
 * Deliberately not translated per key: the surrounding message is English, and
 * these are the same four columns the single-item form names.
 */
const FIELD_LABELS = {
  code: 'Code',
  name: 'Work item',
  unit: 'Unit',
  quantity: 'Contract quantity',
  rate: 'Rate per unit',
} as const
