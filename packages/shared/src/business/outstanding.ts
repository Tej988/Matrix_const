import type { Paise } from '@mc/types'
import { subtract, add, ZERO } from '../money/index'

/**
 * The three quantities that "outstanding" can mean, kept apart on purpose.
 *
 * This module exists because the spec contradicts itself (RISKS.md R-01).
 * Section 8 says, emphatically:
 *
 *   "Do not calculate outstanding directly from contract value."
 *
 * while section 17's own worked example shows Contract 18,50,000 / Billed
 * 10,00,000 / Received 10,00,000 / Outstanding 8,50,000 - which IS
 * contract minus billed, the very calculation section 8 forbids. Both cannot
 * be right, and each is a legitimate business question:
 *
 *   receivable        - "who owes me money today?"      billed - received
 *   unbilledBalance   - "how much work is left to bill?" contract - billed
 *   contractRemaining - "how much of this job is still to collect?"
 *
 * So we compute all three, name each for exactly what it is, and let the
 * owner choose which one the dashboard leads with.
 *
 * ---------------------------------------------------------------------------
 * R-01 IS SETTLED, and the answer came from the business, not the spec.
 *
 * The owner: "in our work we dont have the total contract amount for a project
 * - like for Tata project we dont have a fix amount, all our money depends on
 * the work we have and their measurement and then bill calculate."
 *
 * Two of the three figures are contract-derived, so on a job with no agreed
 * total they do not exist. Not zero - ZERO WOULD BE A LIE, reading as
 * "nothing left to bill" on a job whose billing has barely started. They are
 * null, and the type says so, so no caller can print one by accident.
 *
 * That leaves RECEIVABLE as the only answer to "kitna baaki hai" for the
 * normal case, and it never needed a contract value to begin with. A
 * fixed-price contract still gets all three; it is now the exception.
 * ---------------------------------------------------------------------------
 */

export interface OutstandingInput {
  /**
   * Absent on a measure-and-bill job. Null and undefined mean the same thing
   * here - one comes from a stored summary, the other from a Project whose
   * field was simply never set - and forcing every caller to normalise between
   * them would only invite `?? 0`, which is the bug this change removes.
   */
  contractValuePaise?: Paise | null | undefined
  totalBilledPaise: Paise
  totalReceivedPaise: Paise
}

export interface Outstanding {
  /**
   * Billed but not yet paid. Negative means the client has overpaid.
   *
   * The only figure that survives without a contract value, and therefore the
   * operative meaning of "outstanding" for this business.
   */
  receivablePaise: Paise
  /**
   * Contract value not yet billed. Negative means billing exceeded contract.
   * NULL when there is no contract value - the question does not apply.
   */
  unbilledBalancePaise: Paise | null
  /** Contract value not yet collected. receivable + unbilledBalance, or null. */
  contractRemainingPaise: Paise | null
}

export function calculateOutstanding(input: OutstandingInput): Outstanding {
  const receivablePaise = subtract(input.totalBilledPaise, input.totalReceivedPaise)
  const contractValuePaise = input.contractValuePaise

  if (contractValuePaise === null || contractValuePaise === undefined) {
    return { receivablePaise, unbilledBalancePaise: null, contractRemainingPaise: null }
  }

  const unbilledBalancePaise = subtract(contractValuePaise, input.totalBilledPaise)

  return {
    receivablePaise,
    unbilledBalancePaise,
    // Derived from the other two rather than computed independently, so the
    // identity contractRemaining = receivable + unbilled holds by construction
    // and cannot drift.
    contractRemainingPaise: add(receivablePaise, unbilledBalancePaise),
  }
}

/** True when the contract-derived figures exist at all. */
export function hasContractFigures(
  outstanding: Outstanding,
): outstanding is Outstanding & { unbilledBalancePaise: Paise; contractRemainingPaise: Paise } {
  return outstanding.unbilledBalancePaise !== null
}

export const HEADLINE_FIGURES = ['receivable', 'unbilledBalance', 'contractRemaining'] as const
export type HeadlineFigure = (typeof HEADLINE_FIGURES)[number]

/**
 * Which number the project card leads with. A Settings preference, not a law.
 *
 * Returns null when the chosen figure does not exist on this project, so a
 * caller must decide what to show instead rather than being handed a zero.
 */
export function headlineAmount(outstanding: Outstanding, figure: HeadlineFigure): Paise | null {
  switch (figure) {
    case 'receivable':
      return outstanding.receivablePaise
    case 'unbilledBalance':
      return outstanding.unbilledBalancePaise
    case 'contractRemaining':
      return outstanding.contractRemainingPaise
  }
}

/**
 * Billing beyond the contract value is not automatically wrong - a change
 * order legitimately raises it - but it should never happen silently.
 *
 * With no contract value there is no ceiling to exceed, so this is false: the
 * bills ARE the agreement on such a job.
 */
export function isOverBilled(outstanding: Outstanding): boolean {
  return outstanding.unbilledBalancePaise !== null && outstanding.unbilledBalancePaise < ZERO
}

/** The client has paid more than has been billed. Usually an advance. */
export function isOverPaid(outstanding: Outstanding): boolean {
  return outstanding.receivablePaise < ZERO
}
