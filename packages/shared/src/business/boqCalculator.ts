import type { BoqItem, Paise, Unit } from '@mc/types'
import { multiplyQty, sum, subtract, ZERO } from '../money/index'

/**
 * BOQ arithmetic and the contract-quantity rule.
 *
 * Section 4 states the rule the whole billing chain rests on:
 *
 *   previously completed quantity + current quantity <= contract quantity
 *
 *   "unless an authorized user explicitly approves an additional
 *    quantity/change order"
 *
 * Everything here is pure. The transaction that approves a measurement calls
 * `validateQuantity` against the LIVE completedQty, which is what actually
 * prevents two supervisors from jointly overshooting the contract (R-13).
 */

/** Quantities are rounded to 3 decimals - beyond that is measurement noise. */
export const QTY_PRECISION = 3

export function roundQty(qty: number): number {
  if (!Number.isFinite(qty)) {
    throw new TypeError(`Quantity must be finite, received ${qty}`)
  }
  const factor = 10 ** QTY_PRECISION
  return Math.round(qty * factor) / factor
}

/** contractQty x rate, rounded once. The section 5 worked example. */
export function contractAmount(contractQty: number, ratePaise: Paise): Paise {
  return multiplyQty(roundQty(contractQty), ratePaise)
}

/** Quantity still available to measure against this item. */
export function remainingQty(item: Pick<BoqItem, 'contractQty' | 'completedQty'>): number {
  return roundQty(item.contractQty - item.completedQty)
}

/** Value of work approved but not yet pulled into a bill. */
export function unbilledQty(item: Pick<BoqItem, 'completedQty' | 'billedQty'>): number {
  return roundQty(item.completedQty - item.billedQty)
}

export function completionPercent(item: Pick<BoqItem, 'contractQty' | 'completedQty'>): number {
  if (item.contractQty === 0) return 0
  return Math.round((item.completedQty / item.contractQty) * 1000) / 10
}

// ---------------------------------------------------------------------------
// The section 4 rule
// ---------------------------------------------------------------------------

export type QuantityRejection =
  | { reason: 'NOT_POSITIVE'; currentQty: number }
  | { reason: 'NOT_FINITE'; currentQty: number }
  | {
      reason: 'EXCEEDS_CONTRACT'
      contractQty: number
      completedQty: number
      currentQty: number
      /** How much the entry overshoots by. Always positive. */
      excessQty: number
      /** The largest quantity that would have been accepted. */
      allowedQty: number
    }

export type QuantityCheck =
  | { ok: true; totalQty: number; amountPaise: Paise; isChangeOrder: boolean }
  | { ok: false; rejection: QuantityRejection }

export interface QuantityInput {
  contractQty: number
  /** LIVE completed quantity, read inside the approving transaction (R-13). */
  completedQty: number
  currentQty: number
  ratePaise: Paise
  /**
   * Set only when an authorised user has explicitly approved going over the
   * contract quantity. Never defaulted to true - section 4 requires the
   * override to be a deliberate act, so it is a parameter and not a fallback.
   */
  changeOrderApproved?: boolean
}

export function validateQuantity(input: QuantityInput): QuantityCheck {
  const { contractQty, completedQty, ratePaise } = input
  const currentQty = input.currentQty

  if (!Number.isFinite(currentQty)) {
    return { ok: false, rejection: { reason: 'NOT_FINITE', currentQty } }
  }
  if (currentQty <= 0) {
    return { ok: false, rejection: { reason: 'NOT_POSITIVE', currentQty } }
  }

  const rounded = roundQty(currentQty)
  const totalQty = roundQty(completedQty + rounded)
  const exceeds = totalQty > contractQty

  if (exceeds && input.changeOrderApproved !== true) {
    return {
      ok: false,
      rejection: {
        reason: 'EXCEEDS_CONTRACT',
        contractQty,
        completedQty,
        currentQty: rounded,
        excessQty: roundQty(totalQty - contractQty),
        allowedQty: Math.max(0, roundQty(contractQty - completedQty)),
      },
    }
  }

  return {
    ok: true,
    totalQty,
    amountPaise: multiplyQty(rounded, ratePaise),
    isChangeOrder: exceeds,
  }
}

// ---------------------------------------------------------------------------
// Roll-ups
// ---------------------------------------------------------------------------

export interface BoqTotals {
  itemCount: number
  contractValuePaise: Paise
  completedValuePaise: Paise
  billedValuePaise: Paise
  remainingValuePaise: Paise
  /** Weighted by value, not by item count - a percentage of money, not of rows. */
  completionPercent: number
}

export function boqTotals(items: readonly BoqItem[]): BoqTotals {
  const contractValuePaise = sum(items.map((i) => i.contractAmountPaise))
  const completedValuePaise = sum(items.map((i) => multiplyQty(i.completedQty, i.ratePaise)))
  const billedValuePaise = sum(items.map((i) => multiplyQty(i.billedQty, i.ratePaise)))

  return {
    itemCount: items.length,
    contractValuePaise,
    completedValuePaise,
    billedValuePaise,
    remainingValuePaise: subtract(contractValuePaise, completedValuePaise),
    completionPercent:
      contractValuePaise === ZERO
        ? 0
        : Math.round((completedValuePaise / contractValuePaise) * 1000) / 10,
  }
}

/**
 * A BOQ total that disagrees with the project's contract value is not
 * automatically wrong - a contract can include items not itemised - but the
 * owner should be able to see the gap rather than discover it at billing.
 */
export function contractCoverage(
  items: readonly BoqItem[],
  projectContractValuePaise: Paise,
): { boqTotalPaise: Paise; differencePaise: Paise; matches: boolean } {
  const boqTotalPaise = sum(items.map((i) => i.contractAmountPaise))
  const differencePaise = subtract(projectContractValuePaise, boqTotalPaise)
  return { boqTotalPaise, differencePaise, matches: differencePaise === ZERO }
}

/** A stable, readable code when the user does not supply one: `FLO-01`. */
export function suggestCode(name: string, existing: readonly string[]): string {
  const prefix = (name.replace(/[^a-zA-Z]/g, '').slice(0, 3) || 'ITM').toUpperCase()
  let n = 1
  let candidate = `${prefix}-${String(n).padStart(2, '0')}`
  while (existing.includes(candidate)) {
    n += 1
    candidate = `${prefix}-${String(n).padStart(2, '0')}`
  }
  return candidate
}

export type { Unit }
