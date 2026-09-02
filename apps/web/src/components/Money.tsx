import { Money as M } from '@mc/shared'
import type { Paise } from '@mc/types'

/**
 * The only way money reaches the screen. Components never format amounts
 * themselves - spec section 50, and it keeps Indian digit grouping and the
 * paise convention (ADR-004) in exactly one place.
 */
export function Amount({
  paise,
  className = '',
  signed = false,
}: {
  paise: Paise
  className?: string
  signed?: boolean
}) {
  const negative = paise < 0
  const tone = !signed ? '' : negative ? 'text-red-600 dark:text-red-400' : ''
  return (
    <span className={`tabular-nums ${tone} ${className}`.trim()}>{M.formatPaise(paise)}</span>
  )
}

/**
 * Figure plus words, for confirmation dialogs and anywhere a misplaced zero
 * would be expensive (spec section 28).
 */
export function AmountWithWords({ paise }: { paise: Paise }) {
  return (
    <span>
      <strong className="tabular-nums">{M.formatPaise(paise)}</strong>
      <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">
        ({M.formatPaiseInWords(paise)})
      </span>
    </span>
  )
}
