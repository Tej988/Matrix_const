import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createBoqRepository } from '@mc/shared/repositories/boq'
import { parseBoqPaste, suggestCode, type BoqRowError, type BoqRowWarning } from '@mc/shared'
import { UNIT_LABELS } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { Amount, AmountWithWords } from '../../components/Money'
import { useTranslation, type Translate } from '../../i18n/useTranslation'

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
            // Spread, not `contractQty: undefined` - Firestore rejects an
            // explicit undefined, and exactOptionalPropertyTypes rejects it here.
            ...(row.contractQty !== undefined ? { contractQty: row.contractQty } : {}),
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
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('pasteFromSheetHint')}</p>
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
                            {describeWarning(t, w)}
                          </p>
                        ))}
                      </td>
                      <td className="p-2 text-slate-700 dark:text-slate-200">
                        {UNIT_LABELS[row.unit]}
                      </td>
                      <td className="p-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {row.contractQty?.toLocaleString('en-IN') ?? (
                          <span className="text-slate-400">&mdash;</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <Amount paise={row.ratePaise} />
                      </td>
                      <td className="p-2 pr-3 text-right font-medium">
                        {row.contractAmountPaise === undefined ? (
                          <span className="text-slate-400">&mdash;</span>
                        ) : (
                          <Amount paise={row.contractAmountPaise} />
                        )}
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
                          {row.errors.map((e) => describeError(t, e)).join(' · ')}
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
                      {t('rowsOfTotal', { ok: validCount, all: parsed.rows.length })}
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
              {t('countRowsRejected', { n: rejectedCount })}
            </p>
          )}
        </>
      )}

      {create.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(create.error as Error).message}
          {savedCount > 0 && t('partiallySaved', { saved: savedCount, total: validCount })}
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
            ? t('addingNofM', { done: savedCount + 1, total: validCount })
            : t('addItems', { n: validCount })}
        </button>
      </div>
    </div>
  )
}

function describeError(t: Translate, error: BoqRowError): string {
  switch (error.reason) {
    case 'MISSING_FIELD':
      return t('boqMissingField', { field: t(FIELD_LABELS[error.field]) })
    case 'UNKNOWN_UNIT':
      return t('boqUnknownUnit', { value: error.value })
    case 'BAD_QUANTITY':
      return t('boqBadQuantity', { value: error.value })
    case 'BAD_RATE':
      return t('boqBadRate', { value: error.value })
    case 'AMOUNT_TOO_LARGE':
      return t('boqAmountTooLarge')
  }
}

function describeWarning(t: Translate, warning: BoqRowWarning): string {
  const what = warning.field === 'code' ? t('wordCode') : t('wordName')
  return warning.reason === 'DUPLICATE_IN_PASTE'
    ? t('boqDuplicateInPaste', { what, row: warning.firstRowNumber })
    : t('boqAlreadyOnRateCard', { what })
}

/**
 * The same four columns the single-item form names, so the paste diagnostics
 * and the form agree on what each field is called in either language.
 */
const FIELD_LABELS = {
  code: 'code',
  name: 'workItem',
  unit: 'unit',
  quantity: 'contractQty',
  rate: 'ratePerUnit',
} as const
