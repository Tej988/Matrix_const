import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createMeasurementRepository, ApprovalRejected } from '@mc/shared/repositories/measurements'
import { Dates, canPerformTransition } from '@mc/shared'
import type { Measurement, MeasurementStatus } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { NewMeasurementForm } from './NewMeasurementForm'

const STATUS_TONE: Record<MeasurementStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  SUBMITTED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

export function MeasurementsSection({ projectId }: { projectId: string }) {
  const user = useCurrentUser()
  const { can } = useAuth()
  const repo = useMemo(() => createMeasurementRepository(db), [])
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  const measurements = useQuery({
    queryKey: ['measurements', projectId],
    queryFn: () => repo.listForProject(projectId),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['measurements', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['boq', projectId] })
  }

  const submit = useMutation({
    mutationFn: (m: Measurement) => repo.submit(m.id, user.uid),
    onSuccess: invalidate,
  })

  const approve = useMutation({
    mutationFn: async ({ m, changeOrder }: { m: Measurement; changeOrder: boolean }) => {
      const items = await repo.listItems(m.id)
      await repo.approve(
        m,
        items,
        { uid: user.uid, displayName: user.displayName },
        changeOrder ? { changeOrderApproved: true } : {},
      )
    },
    onSuccess: () => {
      setApprovalError(null)
      invalidate()
    },
    onError: (e) => {
      // The re-check inside the transaction found the live quantities no longer
      // allow this sheet. Say exactly which item and by how much (R-13).
      if (e instanceof ApprovalRejected) {
        setApprovalError(
          `${e.message} ${e.failures
            .map((f) => `${f.boqItemName}: asked for ${f.requestedQty}, only ${f.allowedQty} left`)
            .join('; ')}`,
        )
      } else {
        setApprovalError((e as Error).message)
      }
    },
  })

  const reject = useMutation({
    mutationFn: ({ m, reason }: { m: Measurement; reason: string }) =>
      repo.reject(m.id, reason, user.uid),
    onSuccess: invalidate,
  })

  if (measurements.isPending) return <p className="text-slate-500">Loading measurements…</p>
  if (measurements.isError) {
    return (
      <QueryError
        error={measurements.error}
        onRetry={() => void measurements.refetch()}
        what="measurements"
      />
    )
  }

  const showMoney = can('financials:view')

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Measurement book
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {measurements.data.length} {measurements.data.length === 1 ? 'sheet' : 'sheets'}
          </p>
        </div>
        {can('measurement:create') && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {adding ? 'Cancel' : 'New measurement'}
          </button>
        )}
      </div>

      {adding && (
        <NewMeasurementForm
          projectId={projectId}
          onDone={() => {
            setAdding(false)
            invalidate()
          }}
        />
      )}

      {approvalError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {approvalError}
        </p>
      )}

      {measurements.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">No measurements yet.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Record work done against the rate card. Only approved sheets can be billed.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {measurements.data.map((m) => {
            const canApprove = canPerformTransition(user.role, m.status, 'APPROVED')
            const canSubmit = canPerformTransition(user.role, m.status, 'SUBMITTED')
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{m.title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {Dates.formatPeriod(m.period)} · {Dates.formatDateKey(m.date)} ·{' '}
                    {m.enteredByName}
                    {m.billId && ' · billed'}
                  </p>
                  {m.rejectionReason && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      Rejected: {m.rejectionReason}
                    </p>
                  )}
                </div>

                {showMoney && (
                  <span className="shrink-0 font-medium text-slate-900 dark:text-slate-100">
                    <Amount paise={m.totalAmountPaise} />
                  </span>
                )}

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[m.status]}`}
                >
                  {m.status.toLowerCase()}
                </span>

                <div className="flex shrink-0 gap-2">
                  {canSubmit && m.status !== 'SUBMITTED' && (
                    <button
                      type="button"
                      onClick={() => submit.mutate(m)}
                      disabled={submit.isPending}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                    >
                      Submit
                    </button>
                  )}
                  {canApprove && (
                    <>
                      <button
                        type="button"
                        onClick={() => approve.mutate({ m, changeOrder: false })}
                        disabled={approve.isPending}
                        className="rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt('Why is this being rejected?')
                          if (reason) reject.mutate({ m, reason })
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {user.role === 'SUPERVISOR' && measurements.data.some((m) => m.status === 'SUBMITTED') && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Submitted sheets are waiting for the owner to approve. You cannot approve your own
          measurements.
        </p>
      )}
    </section>
  )
}
