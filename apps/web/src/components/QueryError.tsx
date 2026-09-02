import { useEffect, useState } from 'react'
import { describeFirestoreError } from '../lib/firestoreErrors'

/**
 * Renders a failed query. A transient failure (index building, offline) retries
 * itself on a timer and says so; a permanent one offers a manual retry.
 *
 * Spec section 59 counts a feature incomplete without an error state, and a
 * self-healing condition that demands a manual reload is a poor one.
 */
export function QueryError({
  error,
  onRetry,
  what = 'this',
}: {
  error: unknown
  onRetry: () => void
  what?: string
}) {
  const described = describeFirestoreError(error)
  const [countdown, setCountdown] = useState(described.transient ? 10 : 0)

  useEffect(() => {
    if (!described.transient) return
    const id = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          onRetry()
          return 10
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [described.transient, onRetry])

  const tone = described.transient
    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
    : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300'

  return (
    <div role="alert" className={`space-y-2 rounded-xl border p-4 ${tone}`}>
      <p className="font-medium">{described.title}</p>
      <p className="text-sm">{described.message}</p>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-current px-4 py-2 text-sm font-medium"
        >
          Try again
        </button>
        {described.transient && (
          <span className="text-xs opacity-75">retrying in {countdown}s</span>
        )}
      </div>
      {!described.transient && (
        <p className="pt-1 text-xs opacity-60">Could not load {what}.</p>
      )}
    </div>
  )
}
