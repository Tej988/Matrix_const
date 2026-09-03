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
 *
 * ---------------------------------------------------------------------------
 * A CONTRACT QUANTITY IS OPTIONAL, and usually absent.
 *
 * The owner, on the rate card: "we dont need this contract [quantity] as we
 * dont have fix number, that is depend on the work so remove this."
 *
 * This is R-01 again, one level down. The business quotes RATES, measures what
 * was actually done, and bills that; their own quotation is literally
 * `S.NO | Description | Unit | Rate`. So on most items there is no agreed
 * quantity and therefore NO CEILING - the section 4 rule has nothing to
 * compare against and cannot apply. That is a fact about the job, not a
 * weakening of the guard: for these items the measurement IS the agreement.
 *
 * What is deliberately NOT done here:
 *   - no ceiling is invented. A defaulted 0 would reject every measurement
 *     ever entered; a defaulted Infinity would be a lie living in the data.
 *   - the guard is not dropped for items that DO carry a quantity. Those keep
 *     the full section 4 check, change-order override included. The decision
 *     is made per item, not per project.
 *
 * Everything derived from a contract quantity is `null` when there is none,
 * never 0 - the precedent set by `outstanding.ts` last round. Zero reads on
 * screen as "nothing left to measure", which is the opposite of the truth.
 * ---------------------------------------------------------------------------
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

/**
 * A contract quantity as it arrives from anywhere: a stored document whose
 * field was never written, an in-memory item, or a form left blank. Null and
 * undefined mean the same thing - there is no agreed quantity - and forcing
 * every call site to normalise between them would only invite `?? 0`, which is
 * the bug this change removes.
 */
export type OptionalQty = number | null | undefined

/** True when this item has an agreed quantity, and so a section 4 ceiling. */
export function hasContractQty(item: Pick<BoqItem, 'contractQty'>): boolean {
  return item.contractQty !== undefined && item.contractQty !== null
}

/**
 * Quantity still available to measure against this item.
 *
 * NULL when the item has no contract quantity: nothing is "left", because
 * nothing was ever agreed. Zero would say the item is finished.
 */
export function remainingQty(item: Pick<BoqItem, 'contractQty' | 'completedQty'>): number | null {
  const contractQty = item.contractQty
  if (contractQty === undefined || contractQty === null) return null
  return roundQty(contractQty - item.completedQty)
}

/** Value of work approved but not yet pulled into a bill. */
export function unbilledQty(item: Pick<BoqItem, 'completedQty' | 'billedQty'>): number {
  return roundQty(item.completedQty - item.billedQty)
}

/** Percent of the agreed quantity measured so far. NULL when none was agreed. */
export function completionPercent(
  item: Pick<BoqItem, 'contractQty' | 'completedQty'>,
): number | null {
  const contractQty = item.contractQty
  if (contractQty === undefined || contractQty === null) return null
  if (contractQty === 0) return 0
  return Math.round((item.completedQty / contractQty) * 1000) / 10
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
  /**
   * Absent on a rate-only item, which is the usual case. The property is
   * required but its value may be null or undefined, so a caller must pass the
   * item's quantity through explicitly rather than forget the field exists.
   */
  contractQty: OptionalQty
  /** LIVE completed quantity, read inside the approving transaction (R-13). */
  completedQty: number
  currentQty: number
  ratePaise: Paise
  /**
   * Set only when an authorised user has explicitly approved going over the
   * contract quantity. Never defaulted to true - section 4 requires the
   * override to be a deliberate act, so it is a parameter and not a fallback.
   * Meaningless on an item with no contract quantity: nothing to override.
   */
  changeOrderApproved?: boolean
}

export function validateQuantity(input: QuantityInput): QuantityCheck {
  const { contractQty, completedQty, ratePaise } = input
  const currentQty = input.currentQty

  // These two checks are about the entry itself and hold for every item,
  // ceiling or not: a measurement of zero, of minus five, or of NaN is a
  // mistyped keyboard on any job.
  if (!Number.isFinite(currentQty)) {
    return { ok: false, rejection: { reason: 'NOT_FINITE', currentQty } }
  }
  if (currentQty <= 0) {
    return { ok: false, rejection: { reason: 'NOT_POSITIVE', currentQty } }
  }

  const rounded = roundQty(currentQty)
  const totalQty = roundQty(completedQty + rounded)
  const amountPaise = multiplyQty(rounded, ratePaise)

  // No agreed quantity, no ceiling, so EXCEEDS_CONTRACT is unreachable from
  // here - there is no number the entry could exceed. Not a change order
  // either: a change order is a departure from an agreed quantity, and the
  // only thing agreed on this item is the rate, which has not changed.
  if (contractQty === undefined || contractQty === null) {
    return { ok: true, totalQty, amountPaise, isChangeOrder: false }
  }

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

  return { ok: true, totalQty, amountPaise, isChangeOrder: exceeds }
}

// ---------------------------------------------------------------------------
// Roll-ups
// ---------------------------------------------------------------------------

export interface BoqTotals {
  itemCount: number
  /**
   * How the rate card splits. A screen that prints a contract total has to be
   * able to say "over 4 of 11 items" rather than present a figure that
   * silently omits seven rows.
   */
  itemsWithContractQty: number
  itemsWithoutContractQty: number
  /** Summed over the items that HAVE a contract amount, and only those. */
  contractValuePaise: Paise
  /** Measured and billed value cover EVERY item - they need no contract. */
  completedValuePaise: Paise
  billedValuePaise: Paise
  /**
   * Contract value not yet measured, over the contract-bearing items only.
   * NULL when no item has a contract quantity: there is no agreed total to
   * count down from, and 0 would read as "the job is finished".
   */
  remainingValuePaise: Paise | null
  /**
   * Weighted by value, not by item count - a percentage of money, not of rows.
   * NULL for the same reason: a percentage needs a denominator.
   */
  completionPercent: number | null
}

export function boqTotals(items: readonly BoqItem[]): BoqTotals {
  const withContract = items.filter(hasContractQty)

  const contractValuePaise = sum(withContract.map((i) => i.contractAmountPaise ?? ZERO))
  const completedValuePaise = sum(items.map((i) => multiplyQty(i.completedQty, i.ratePaise)))
  const billedValuePaise = sum(items.map((i) => multiplyQty(i.billedQty, i.ratePaise)))

  // Both sides of the ratio are restricted to the same subset of items, so
  // "20.2% complete" is 20.2% of something that actually has a total. Mixing
  // a full-card numerator into a partial denominator could print past 100%.
  const completedAgainstContract = sum(
    withContract.map((i) => multiplyQty(i.completedQty, i.ratePaise)),
  )

  let remainingValuePaise: Paise | null = null
  let percent: number | null = null
  if (withContract.length > 0) {
    remainingValuePaise = subtract(contractValuePaise, completedAgainstContract)
    // A rate card of contract-bearing items all priced at nil is a real state -
    // owner-supplied material, measured but not charged for - and dividing by
    // it would be NaN rather than a percentage.
    percent =
      contractValuePaise === ZERO
        ? 0
        : Math.round((completedAgainstContract / contractValuePaise) * 1000) / 10
  }

  return {
    itemCount: items.length,
    itemsWithContractQty: withContract.length,
    itemsWithoutContractQty: items.length - withContract.length,
    contractValuePaise,
    completedValuePaise,
    billedValuePaise,
    remainingValuePaise,
    completionPercent: percent,
  }
}

export interface ContractCoverage {
  boqTotalPaise: Paise
  /**
   * The contract value that was compared against. Carried on the result so the
   * caller can name both sides of the gap without re-narrowing the optional
   * input it just passed in.
   */
  contractValuePaise: Paise
  differencePaise: Paise
  matches: boolean
}

/**
 * A BOQ total that disagrees with the project's contract value is not
 * automatically wrong - a contract can include items not itemised - but the
 * owner should be able to see the gap rather than discover it at billing.
 *
 * Returns NULL when the project has no contract value (R-01): there is then
 * nothing to reconcile the rate card against, and the amber "the rate card
 * totals ₹7,000 but the contract is ₹50,00,000" warning is comparing a real
 * number against an invented one. Null rather than a `matches: true` result,
 * so the caller renders nothing instead of quietly claiming agreement.
 *
 * Also NULL when a non-empty rate card carries no quantities at all: its total
 * is then ₹0 by construction, and "the rate card totals ₹0 — a difference of
 * ₹18,50,000" is the same invented comparison seen from the other side.
 */
export function contractCoverage(
  items: readonly BoqItem[],
  projectContractValuePaise: Paise | null | undefined,
): ContractCoverage | null {
  if (projectContractValuePaise === null || projectContractValuePaise === undefined) return null

  const priced = items.filter(hasContractQty)
  if (items.length > 0 && priced.length === 0) return null

  const boqTotalPaise = sum(priced.map((i) => i.contractAmountPaise ?? ZERO))
  const differencePaise = subtract(projectContractValuePaise, boqTotalPaise)
  return {
    boqTotalPaise,
    contractValuePaise: projectContractValuePaise,
    differencePaise,
    matches: differencePaise === ZERO,
  }
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
