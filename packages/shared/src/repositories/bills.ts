import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import type {
  Bill,
  BillItem,
  BillStatus,
  BoqItem,
  DateKey,
  Measurement,
  MeasurementItem,
  Paise,
  Project,
  Unit,
} from '@mc/types'
import {
  calculateBill,
  consolidateLines,
  counterIdFor,
  formatBillNumber,
} from '../business/billCalculator'
import { calculateOutstanding } from '../business/outstanding'
import { subtract, add } from '../money/index'

/**
 * The summary's contract value, or null when the project has no agreed total
 * (R-01). Never defaulted to zero: a zero here would make `unbilledBalance`
 * come back negative and read as "over-billed" on every measure-and-bill job.
 */
function storedContractValue(data: Record<string, unknown> | undefined): Paise | null {
  const v = data?.['contractValuePaise']
  return typeof v === 'number' ? (v as Paise) : null
}

function toBill(id: string, d: Record<string, unknown>): Bill {
  return {
    id,
    projectId: d['projectId'] as string,
    projectName: (d['projectName'] as string) ?? '',
    clientId: (d['clientId'] as string) ?? '',
    clientName: (d['clientName'] as string) ?? '',
    billNumber: (d['billNumber'] as string) ?? '',
    billDate: d['billDate'] as DateKey,
    periodFrom: d['periodFrom'] as DateKey,
    periodTo: d['periodTo'] as DateKey,
    measurementIds: (d['measurementIds'] as string[]) ?? [],
    subtotalPaise: (d['subtotalPaise'] as Paise) ?? (0 as Paise),
    tax: d['tax'] as Bill['tax'],
    deductions: d['deductions'] as Bill['deductions'],
    netAmountPaise: (d['netAmountPaise'] as Paise) ?? (0 as Paise),
    amountReceivedPaise: (d['amountReceivedPaise'] as Paise) ?? (0 as Paise),
    status: (d['status'] as BillStatus) ?? 'DRAFT',
    ...(d['cancellationReason'] ? { cancellationReason: d['cancellationReason'] as string } : {}),
  }
}

export function createBillRepository(db: Firestore) {
  return {
    async listForProject(projectId: string): Promise<Bill[]> {
      const snap = await getDocs(
        query(
          collection(db, 'bills'),
          where('projectId', '==', projectId),
          orderBy('billDate', 'desc'),
        ),
      )
      return snap.docs.map((d) => toBill(d.id, d.data()))
    },

    async get(id: string): Promise<Bill | null> {
      const snap = await getDoc(doc(db, 'bills', id))
      return snap.exists() ? toBill(snap.id, snap.data()) : null
    },

    async listItems(billId: string): Promise<BillItem[]> {
      const snap = await getDocs(collection(db, 'bills', billId, 'items'))
      return snap.docs.map((d) => ({
        id: d.id,
        boqItemId: d.data()['boqItemId'] as string,
        name: d.data()['name'] as string,
        unit: d.data()['unit'] as Unit,
        ratePaise: d.data()['ratePaise'] as Paise,
        quantity: d.data()['quantity'] as number,
        amountPaise: d.data()['amountPaise'] as Paise,
      }))
    },

    /**
     * Generates a bill from approved measurements.
     *
     * The most intricate write in the system. One transaction:
     *
     *   1. allocate the next bill number for this financial year (R-11)
     *   2. create the bill and its frozen line items
     *   3. stamp billId onto each measurement so it cannot be billed twice
     *   4. advance billedQty on each BOQ item
     *   5. add totalBilled to the project summary and recompute receivable
     *   6. append the audit entry
     *
     * Step 3 is what makes double-billing impossible: the measurement carries
     * its bill, and a re-run finds it already stamped.
     *
     * Bill numbers are allocated HERE, at generation, not when a draft is
     * created - so abandoned drafts leave no gaps in the sequence, which
     * matters if GST invoicing is ever switched on (ADR-003).
     */
    async generate(
      input: {
        project: Pick<Project, 'id' | 'name' | 'clientId' | 'clientName' | 'taxProfile'>
        measurements: readonly Measurement[]
        items: readonly MeasurementItem[]
        billDate: DateKey
        periodFrom: DateKey
        periodTo: DateKey
        numberPrefix: string
        otherDeduction?: { label?: string; amountPaise: Paise }
      },
      actor: { uid: string; displayName: string },
    ): Promise<{ billId: string; billNumber: string }> {
      const lines = consolidateLines(input.items)
      const totals = calculateBill(
        lines,
        input.project.taxProfile,
        input.otherDeduction ?? { amountPaise: 0 as Paise },
      )

      const billRef = doc(collection(db, 'bills'))
      const counterRef = doc(db, 'counters', counterIdFor(input.billDate))
      const summaryRef = doc(db, 'projects', input.project.id, 'summary', 'current')

      const billNumber = await runTransaction(db, async (tx) => {
        // --- all reads first ---
        const counterSnap = await tx.get(counterRef)
        const summarySnap = await tx.get(summaryRef)
        const measurementSnaps = await Promise.all(
          input.measurements.map((m) => tx.get(doc(db, 'measurements', m.id))),
        )
        const boqIds = [...new Set(lines.map((l) => l.boqItemId))]
        const boqSnaps = await Promise.all(boqIds.map((id) => tx.get(doc(db, 'boqItems', id))))

        // Refuse if any measurement has been billed since the UI loaded.
        measurementSnaps.forEach((snap, i) => {
          if (!snap.exists()) throw new Error('A measurement no longer exists')
          const data = snap.data()
          if (data['status'] !== 'APPROVED') {
            throw new Error('Only approved measurements can be billed')
          }
          if (data['billId']) {
            throw new Error(
              `"${input.measurements[i]?.title}" has already been billed on another invoice.`,
            )
          }
        })

        const next = ((counterSnap.data()?.['current'] as number | undefined) ?? 0) + 1
        const number = formatBillNumber(input.numberPrefix, input.billDate, next)

        // --- writes ---
        tx.set(counterRef, { current: increment(1) }, { merge: true })

        tx.set(billRef, {
          projectId: input.project.id,
          projectName: input.project.name,
          clientId: input.project.clientId,
          clientName: input.project.clientName,
          billNumber: number,
          billDate: input.billDate,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          measurementIds: input.measurements.map((m) => m.id),
          subtotalPaise: totals.subtotalPaise,
          tax: totals.tax,
          deductions: totals.deductions,
          netAmountPaise: totals.netAmountPaise,
          amountReceivedPaise: 0,
          status: 'GENERATED' satisfies BillStatus,
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        for (const line of lines) {
          tx.set(doc(collection(db, 'bills', billRef.id, 'items')), {
            boqItemId: line.boqItemId,
            name: line.name,
            unit: line.unit,
            ratePaise: line.ratePaise,
            quantity: line.quantity,
            amountPaise: line.amountPaise,
          })
        }

        for (const m of input.measurements) {
          tx.update(doc(db, 'measurements', m.id), {
            billId: billRef.id,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
        }

        boqSnaps.forEach((snap, i) => {
          const id = boqIds[i]
          if (!snap.exists() || !id) return
          const item = snap.data() as Omit<BoqItem, 'id'>
          const qty = lines.find((l) => l.boqItemId === id)?.quantity ?? 0
          tx.update(doc(db, 'boqItems', id), {
            billedQty: item.billedQty + qty,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
        })

        const totalBilled = add(
          (summarySnap.data()?.['totalBilledPaise'] as Paise | undefined) ?? (0 as Paise),
          totals.netAmountPaise,
        )
        const received =
          (summarySnap.data()?.['totalReceivedPaise'] as Paise | undefined) ?? (0 as Paise)

        // Through the business function rather than re-derived inline, so this
        // incremental path cannot disagree with the authoritative recompute
        // about what an absent contract value means.
        const outstanding = calculateOutstanding({
          contractValuePaise: storedContractValue(summarySnap.data()),
          totalBilledPaise: totalBilled,
          totalReceivedPaise: received,
        })

        tx.set(
          summaryRef,
          {
            totalBilledPaise: totalBilled,
            receivablePaise: outstanding.receivablePaise,
            unbilledBalancePaise: outstanding.unbilledBalancePaise,
            contractRemainingPaise: outstanding.contractRemainingPaise,
            computedAt: serverTimestamp(),
            computedBy: actor.uid,
          },
          { merge: true },
        )

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'BILL_GENERATED',
          entityType: 'bill',
          entityId: billRef.id,
          projectId: input.project.id,
          after: { billNumber: number, netAmountPaise: totals.netAmountPaise },
          at: serverTimestamp(),
        })

        return number
      })

      return { billId: billRef.id, billNumber }
    },

    async markSent(billId: string, actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'bills', billId), {
        status: 'SENT' satisfies BillStatus,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    /**
     * Cancellation, not deletion (ADR-007). Reverses the billed amount out of
     * the summary and releases the measurements so the work can be rebilled.
     */
    async cancel(
      bill: Bill,
      reason: string,
      actor: { uid: string; displayName: string },
    ): Promise<void> {
      const summaryRef = doc(db, 'projects', bill.projectId, 'summary', 'current')

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)
        const billSnap = await tx.get(doc(db, 'bills', bill.id))

        if (!billSnap.exists()) throw new Error('Bill no longer exists')
        if (billSnap.data()['status'] === 'CANCELLED') {
          throw new Error('This bill is already cancelled')
        }
        if ((billSnap.data()['amountReceivedPaise'] as number) > 0) {
          throw new Error('Money has been received against this bill. Reverse the payment first.')
        }

        tx.update(doc(db, 'bills', bill.id), {
          status: 'CANCELLED' satisfies BillStatus,
          cancellationReason: reason,
          cancelledBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        for (const id of bill.measurementIds) {
          tx.update(doc(db, 'measurements', id), {
            billId: null,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
        }

        const totalBilled = subtract(
          (summarySnap.data()?.['totalBilledPaise'] as Paise | undefined) ?? (0 as Paise),
          bill.netAmountPaise,
        )
        const received =
          (summarySnap.data()?.['totalReceivedPaise'] as Paise | undefined) ?? (0 as Paise)

        const outstanding = calculateOutstanding({
          contractValuePaise: storedContractValue(summarySnap.data()),
          totalBilledPaise: totalBilled,
          totalReceivedPaise: received,
        })

        tx.set(
          summaryRef,
          {
            totalBilledPaise: totalBilled,
            receivablePaise: outstanding.receivablePaise,
            // contractRemaining is contract - received, which a cancellation
            // does not move.
            unbilledBalancePaise: outstanding.unbilledBalancePaise,
            computedAt: serverTimestamp(),
            computedBy: actor.uid,
          },
          { merge: true },
        )

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'BILL_CANCELLED',
          entityType: 'bill',
          entityId: bill.id,
          projectId: bill.projectId,
          before: { status: bill.status, netAmountPaise: bill.netAmountPaise },
          reason,
          at: serverTimestamp(),
        })
      })
    },
  }
}

export type BillRepository = ReturnType<typeof createBillRepository>
