import type { Paise, ProjectSummary } from '@mc/types'
import { SUMMARY_SCHEMA_VERSION } from '@mc/types'
import { sum, subtract, add, ZERO } from '../money/index'
import { calculateOutstanding } from './outstanding'

/**
 * Derives a project's entire financial position from source records.
 *
 * This function is the AUTHORITATIVE definition of every summary field. The
 * incremental updates that financial transactions perform against
 * projects/{id}/summary/current are an optimisation over it - and because
 * those run client-side with no server to arbitrate (ADR-002), they can drift
 * (R-04). When they disagree, this wins.
 *
 * Pure: no Firestore, no clock, no randomness. Give it the same records and it
 * returns the same numbers, which is what makes drift detectable at all.
 */

export interface SummarySources {
  /**
   * Absent on a measure-and-bill job, which is most of them (R-01). Null and
   * undefined both mean "no agreed total".
   */
  contractValuePaise?: Paise | null | undefined
  /** Non-cancelled bills only. */
  billNetAmounts: readonly Paise[]
  /** CONFIRMED client payments only - not PENDING or SUGGESTED. */
  confirmedReceipts: readonly Paise[]
  /** APPROVED measurements only. */
  approvedMeasurementAmounts: readonly Paise[]
  /** LOCKED wage periods only. */
  lockedWageEarnings: readonly Paise[]
  /** CONFIRMED labour payments only. */
  confirmedLabourPayments: readonly Paise[]
  /**
   * Expenses EXCLUDING category LABOUR. Labour cost is already captured by
   * labourPaid, and counting both would double it.
   */
  nonLabourExpenses: readonly Paise[]
}

export function computeProjectSummary(
  projectId: string,
  sources: SummarySources,
  computedBy: string,
  computedAt: Date,
): ProjectSummary {
  const totalBilledPaise = sum(sources.billNetAmounts)
  const totalReceivedPaise = sum(sources.confirmedReceipts)
  const labourEarnedPaise = sum(sources.lockedWageEarnings)
  const labourPaidPaise = sum(sources.confirmedLabourPayments)
  const otherExpensesPaise = sum(sources.nonLabourExpenses)

  const outstanding = calculateOutstanding({
    contractValuePaise: sources.contractValuePaise,
    totalBilledPaise,
    totalReceivedPaise,
  })

  const cashOutPaise = add(labourPaidPaise, otherExpensesPaise)

  return {
    projectId,
    // Normalised to null so the stored document has one shape. Firestore has
    // no `undefined`, and a summary that omitted the field entirely would read
    // back as undefined on one client and absent on another.
    contractValuePaise: sources.contractValuePaise ?? null,
    totalBilledPaise,
    totalReceivedPaise,
    receivablePaise: outstanding.receivablePaise,
    unbilledBalancePaise: outstanding.unbilledBalancePaise,
    contractRemainingPaise: outstanding.contractRemainingPaise,
    approvedMeasuredPaise: sum(sources.approvedMeasurementAmounts),
    labourEarnedPaise,
    labourPaidPaise,
    labourPayablePaise: subtract(labourEarnedPaise, labourPaidPaise),
    otherExpensesPaise,
    cashOutPaise,
    // Cash in minus cash out. Deliberately NOT called profit: section 17
    // forbids that unless every cost is captured, and materials, overheads and
    // equipment are not in this system.
    netPositionPaise: subtract(totalReceivedPaise, cashOutPaise),
    computedAt,
    computedBy,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
  }
}

export function emptySummary(
  projectId: string,
  contractValuePaise: Paise | null | undefined,
  computedBy: string,
  computedAt: Date,
): ProjectSummary {
  return computeProjectSummary(
    projectId,
    {
      contractValuePaise,
      billNetAmounts: [],
      confirmedReceipts: [],
      approvedMeasurementAmounts: [],
      lockedWageEarnings: [],
      confirmedLabourPayments: [],
      nonLabourExpenses: [],
    },
    computedBy,
    computedAt,
  )
}

/**
 * Compares a stored summary against a freshly derived one and reports every
 * field that disagrees. Powers the reconciliation screen (R-04) - which shows a
 * diff and asks a human to accept it, rather than silently self-healing.
 */
export interface SummaryDrift {
  field: keyof ProjectSummary
  stored: Paise
  derived: Paise
  differencePaise: Paise
}

const MONETARY_FIELDS = [
  'totalBilledPaise',
  'totalReceivedPaise',
  'receivablePaise',
  'approvedMeasuredPaise',
  'labourEarnedPaise',
  'labourPaidPaise',
  'labourPayablePaise',
  'otherExpensesPaise',
  'cashOutPaise',
  'netPositionPaise',
] as const satisfies readonly (keyof ProjectSummary)[]

/**
 * The contract-derived trio, which is null on a project with no agreed total
 * (R-01) and so cannot be compared the same way.
 */
const NULLABLE_MONETARY_FIELDS = [
  'contractValuePaise',
  'unbilledBalancePaise',
  'contractRemainingPaise',
] as const satisfies readonly (keyof ProjectSummary)[]

export function detectDrift(
  stored: ProjectSummary | null,
  derived: ProjectSummary,
): SummaryDrift[] {
  if (!stored) return []

  const drift: SummaryDrift[] = []
  for (const field of MONETARY_FIELDS) {
    const s = stored[field]
    const d = derived[field]
    if (s !== d) {
      drift.push({ field, stored: s, derived: d, differencePaise: subtract(d, s) })
    }
  }

  for (const field of NULLABLE_MONETARY_FIELDS) {
    const s = stored[field]
    const d = derived[field]
    /*
     * Absent on both sides is agreement, not a zero-vs-zero comparison - a
     * project with no contract value genuinely has no unbilled balance, and
     * reporting one would be the false drift this guard exists to prevent.
     *
     * Absent on exactly one side means the contract value was added or removed
     * since the summary was written. That is a real change, but the only
     * honest "correct" value to print for it is "nothing", and this table
     * carries amounts - a fabricated ₹0 in the Correct column would be worse
     * than silence. The reconciliation write replaces the whole document, so
     * the field is corrected regardless of whether a row appears for it.
     */
    if (s === null || d === null) continue
    if (s !== d) {
      drift.push({ field, stored: s, derived: d, differencePaise: subtract(d, s) })
    }
  }

  return drift
}

export const hasDrift = (stored: ProjectSummary | null, derived: ProjectSummary): boolean =>
  detectDrift(stored, derived).length > 0

export const ZERO_PAISE: Paise = ZERO
