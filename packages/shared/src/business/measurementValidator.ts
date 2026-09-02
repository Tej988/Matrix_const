import type { BoqItem, MeasurementItem, MeasurementStatus, Paise, Role } from '@mc/types'
import { sum, ZERO } from '../money/index'
import { validateQuantity, type QuantityRejection } from './boqCalculator'

/**
 * Measurement validation and the approval workflow.
 *
 * Section 6: only APPROVED measurements are billable. Section 4: the
 * contract-quantity rule. The two meet here - the quantity check is evaluated
 * at APPROVAL against live BOQ quantities, not at draft time against whatever
 * was on screen when someone started typing (R-13).
 */

export interface DraftLine {
  boqItemId: string
  location: string
  description?: string
  currentQty: number
}

export interface ValidatedLine {
  boqItemId: string
  boqItemName: string
  location: string
  description?: string
  unit: BoqItem['unit']
  ratePaise: Paise
  previousQty: number
  currentQty: number
  totalQty: number
  amountPaise: Paise
  isChangeOrder: boolean
}

export type LineRejection = {
  boqItemId: string
  boqItemName: string
  location: string
} & QuantityRejection

export interface MeasurementValidation {
  lines: ValidatedLine[]
  rejections: LineRejection[]
  totalAmountPaise: Paise
  hasChangeOrder: boolean
  ok: boolean
}

/**
 * Validates every line against the CURRENT state of the rate card.
 *
 * Two lines against the same BOQ item accumulate: the second is checked against
 * the first's quantity too. Otherwise a sheet could list Block A 6,000 and
 * Block B 6,000 against a 10,000 contract and each would pass alone.
 */
export function validateMeasurement(
  draft: readonly DraftLine[],
  boqItems: readonly BoqItem[],
  options: { changeOrderApproved?: boolean } = {},
): MeasurementValidation {
  const byId = new Map(boqItems.map((i) => [i.id, i]))
  const runningQty = new Map<string, number>()

  const lines: ValidatedLine[] = []
  const rejections: LineRejection[] = []

  for (const line of draft) {
    const item = byId.get(line.boqItemId)
    if (!item) {
      rejections.push({
        boqItemId: line.boqItemId,
        boqItemName: 'Unknown item',
        location: line.location,
        reason: 'NOT_FINITE',
        currentQty: line.currentQty,
      })
      continue
    }

    // Previous = what the BOQ says, plus anything earlier on this same sheet.
    const alreadyOnSheet = runningQty.get(item.id) ?? 0
    const previousQty = item.completedQty + alreadyOnSheet

    const check = validateQuantity({
      contractQty: item.contractQty,
      completedQty: previousQty,
      currentQty: line.currentQty,
      ratePaise: item.ratePaise,
      ...(options.changeOrderApproved === true ? { changeOrderApproved: true } : {}),
    })

    if (!check.ok) {
      rejections.push({
        boqItemId: item.id,
        boqItemName: item.name,
        location: line.location,
        ...check.rejection,
      })
      continue
    }

    runningQty.set(item.id, alreadyOnSheet + line.currentQty)

    lines.push({
      boqItemId: item.id,
      boqItemName: item.name,
      location: line.location,
      unit: item.unit,
      ratePaise: item.ratePaise,
      previousQty,
      currentQty: line.currentQty,
      totalQty: check.totalQty,
      amountPaise: check.amountPaise,
      isChangeOrder: check.isChangeOrder,
      ...(line.description ? { description: line.description } : {}),
    })
  }

  return {
    lines,
    rejections,
    totalAmountPaise: lines.length > 0 ? sum(lines.map((l) => l.amountPaise)) : ZERO,
    hasChangeOrder: lines.some((l) => l.isChangeOrder),
    ok: rejections.length === 0 && lines.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Legal status moves. Everything else is rejected, so a measurement cannot skip
 * approval on its way to a bill.
 */
const TRANSITIONS: Record<MeasurementStatus, readonly MeasurementStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'DRAFT'],
  // Approval is final. A mistake is corrected by a negative measurement or a
  // change order, never by quietly reopening an approved sheet that a bill may
  // already reference (ADR-007).
  APPROVED: [],
  REJECTED: ['DRAFT'],
}

export function canTransition(from: MeasurementStatus, to: MeasurementStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Who may perform a transition.
 *
 * A supervisor may enter and submit but NEVER approve - that separation of duty
 * is what makes the approval step mean something rather than being a formality
 * (SECURITY.md section 2).
 */
export function canPerformTransition(
  role: Role,
  from: MeasurementStatus,
  to: MeasurementStatus,
): boolean {
  if (!canTransition(from, to)) return false
  if (to === 'APPROVED' || to === 'REJECTED') {
    return role === 'OWNER' || role === 'ADMIN'
  }
  return role === 'OWNER' || role === 'ADMIN' || role === 'SUPERVISOR'
}

export function isBillable(m: { status: MeasurementStatus; billId?: string }): boolean {
  return m.status === 'APPROVED' && !m.billId
}

/** The BOQ quantity deltas an approval must apply, keyed by BOQ item. */
export function completedQtyDeltas(lines: readonly MeasurementItem[]): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const line of lines) {
    deltas.set(line.boqItemId, (deltas.get(line.boqItemId) ?? 0) + line.currentQty)
  }
  return deltas
}
