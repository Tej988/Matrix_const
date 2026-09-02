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
 * owner choose which one the dashboard leads with. No definition is privileged
 * in the data model, which means no migration whichever way that lands.
 */

export interface OutstandingInput {
  contractValuePaise: Paise
  totalBilledPaise: Paise
  totalReceivedPaise: Paise
}

export interface Outstanding {
  /** Billed but not yet paid. Negative means the client has overpaid. */
  receivablePaise: Paise
  /** Contract value not yet billed. Negative means billing exceeded contract. */
  unbilledBalancePaise: Paise
  /** Contract value not yet collected. receivable + unbilledBalance. */
  contractRemainingPaise: Paise
}

export function calculateOutstanding(input: OutstandingInput): Outstanding {
  const receivablePaise = subtract(input.totalBilledPaise, input.totalReceivedPaise)
  const unbilledBalancePaise = subtract(input.contractValuePaise, input.totalBilledPaise)

  return {
    receivablePaise,
    unbilledBalancePaise,
    // Derived from the other two rather than computed independently, so the
    // identity contractRemaining = receivable + unbilled holds by construction
    // and cannot drift.
    contractRemainingPaise: add(receivablePaise, unbilledBalancePaise),
  }
}

export const HEADLINE_FIGURES = ['receivable', 'unbilledBalance', 'contractRemaining'] as const
export type HeadlineFigure = (typeof HEADLINE_FIGURES)[number]

/** Which number the project card leads with. A Settings preference, not a law. */
export function headlineAmount(outstanding: Outstanding, figure: HeadlineFigure): Paise {
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
 */
export function isOverBilled(outstanding: Outstanding): boolean {
  return outstanding.unbilledBalancePaise < ZERO
}

/** The client has paid more than has been billed. Usually an advance. */
export function isOverPaid(outstanding: Outstanding): boolean {
  return outstanding.receivablePaise < ZERO
}
