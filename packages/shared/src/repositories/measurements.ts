import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type {
  BoqItem,
  Measurement,
  MeasurementItem,
  MeasurementStatus,
  Paise,
  Period,
  Unit,
} from '@mc/types'
import { validateQuantity } from '../business/boqCalculator'
import { sum } from '../money/index'
import type { ValidatedLine } from '../business/measurementValidator'

function toMeasurement(id: string, d: Record<string, unknown>): Measurement {
  return {
    id,
    projectId: d['projectId'] as string,
    period: d['period'] as Period,
    date: d['date'] as Measurement['date'],
    title: (d['title'] as string) ?? '',
    status: (d['status'] as MeasurementStatus) ?? 'DRAFT',
    totalAmountPaise: (d['totalAmountPaise'] as Paise) ?? (0 as Paise),
    enteredBy: (d['enteredBy'] as string) ?? '',
    enteredByName: (d['enteredByName'] as string) ?? '',
    ...(d['approvedBy'] ? { approvedBy: d['approvedBy'] as string } : {}),
    ...(d['rejectionReason'] ? { rejectionReason: d['rejectionReason'] as string } : {}),
    ...(d['billId'] ? { billId: d['billId'] as string } : {}),
  }
}

function toItem(id: string, d: Record<string, unknown>): MeasurementItem {
  return {
    id,
    boqItemId: d['boqItemId'] as string,
    boqItemName: (d['boqItemName'] as string) ?? '',
    location: (d['location'] as string) ?? '',
    unit: (d['unit'] as Unit) ?? 'NOS',
    ratePaise: (d['ratePaise'] as Paise) ?? (0 as Paise),
    previousQty: (d['previousQty'] as number) ?? 0,
    currentQty: (d['currentQty'] as number) ?? 0,
    totalQty: (d['totalQty'] as number) ?? 0,
    amountPaise: (d['amountPaise'] as Paise) ?? (0 as Paise),
    isChangeOrder: (d['isChangeOrder'] as boolean) ?? false,
    ...(d['description'] ? { description: d['description'] as string } : {}),
  }
}

export class ApprovalRejected extends Error {
  constructor(
    message: string,
    readonly failures: { boqItemName: string; allowedQty: number; requestedQty: number }[],
  ) {
    super(message)
    this.name = 'ApprovalRejected'
  }
}

export function createMeasurementRepository(db: Firestore) {
  return {
    async listForProject(projectId: string): Promise<Measurement[]> {
      const snap = await getDocs(
        query(
          collection(db, 'measurements'),
          where('projectId', '==', projectId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => toMeasurement(d.id, d.data()))
    },

    async get(id: string): Promise<Measurement | null> {
      const snap = await getDoc(doc(db, 'measurements', id))
      return snap.exists() ? toMeasurement(snap.id, snap.data()) : null
    },

    async listItems(measurementId: string): Promise<MeasurementItem[]> {
      const snap = await getDocs(collection(db, 'measurements', measurementId, 'items'))
      return snap.docs.map((d) => toItem(d.id, d.data()))
    },

    /** Header and every line written together - a sheet with no lines is meaningless. */
    async create(
      input: {
        projectId: string
        period: Period
        date: Measurement['date']
        title: string
        lines: readonly ValidatedLine[]
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      const ref = doc(collection(db, 'measurements'))
      const batch = writeBatch(db)

      batch.set(ref, {
        projectId: input.projectId,
        period: input.period,
        date: input.date,
        title: input.title,
        status: 'DRAFT' satisfies MeasurementStatus,
        totalAmountPaise: sum(input.lines.map((l) => l.amountPaise)),
        enteredBy: actor.uid,
        enteredByName: actor.displayName,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })

      for (const line of input.lines) {
        batch.set(doc(collection(db, 'measurements', ref.id, 'items')), {
          boqItemId: line.boqItemId,
          boqItemName: line.boqItemName,
          location: line.location,
          unit: line.unit,
          ratePaise: line.ratePaise,
          previousQty: line.previousQty,
          currentQty: line.currentQty,
          totalQty: line.totalQty,
          amountPaise: line.amountPaise,
          isChangeOrder: line.isChangeOrder,
          ...(line.description ? { description: line.description } : {}),
        })
      }

      await batch.commit()
      return ref.id
    },

    async submit(measurementId: string, actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'measurements', measurementId), {
        status: 'SUBMITTED' satisfies MeasurementStatus,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    async reject(measurementId: string, reason: string, actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'measurements', measurementId), {
        status: 'REJECTED' satisfies MeasurementStatus,
        rejectionReason: reason,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    /**
     * Approval. The one operation in this phase that must be atomic.
     *
     * Inside a single transaction it re-reads every BOQ item, re-runs the
     * section 4 check against LIVE quantities, moves completedQty, flips the
     * status, and writes the audit entry. Re-checking here rather than trusting
     * the draft is what closes R-13: two supervisors can each draft a sheet
     * that is valid alone, and the second approval must fail.
     *
     * Requires a connection - transactions do not work offline (R-02). That is
     * acceptable: approval is an office action, not a site one.
     */
    async approve(
      measurement: Measurement,
      items: readonly MeasurementItem[],
      actor: { uid: string; displayName: string },
      options: { changeOrderApproved?: boolean } = {},
    ): Promise<void> {
      await runTransaction(db, async (tx) => {
        const boqIds = [...new Set(items.map((i) => i.boqItemId))]

        // All reads must precede all writes inside a Firestore transaction.
        const boqSnaps = await Promise.all(boqIds.map((id) => tx.get(doc(db, 'boqItems', id))))
        const measurementSnap = await tx.get(doc(db, 'measurements', measurement.id))

        if (!measurementSnap.exists()) throw new Error('Measurement no longer exists')
        if (measurementSnap.data()['status'] !== 'SUBMITTED') {
          throw new Error('Only a submitted measurement can be approved')
        }

        const live = new Map<string, BoqItem>()
        boqSnaps.forEach((snap, idx) => {
          if (!snap.exists()) throw new Error(`Rate card item ${boqIds[idx]} no longer exists`)
          live.set(snap.id, { id: snap.id, ...(snap.data() as Omit<BoqItem, 'id'>) })
        })

        // Re-validate against live quantities, accumulating within the sheet.
        const running = new Map<string, number>()
        const failures: { boqItemName: string; allowedQty: number; requestedQty: number }[] = []

        for (const line of items) {
          const item = live.get(line.boqItemId)
          if (!item) continue
          const already = running.get(item.id) ?? 0
          const check = validateQuantity({
            // Straight off the LIVE document. An item that carries a contract
            // quantity is re-checked against it here, which is where R-13 is
            // actually closed; an item that carries none has no ceiling to
            // re-check and passes on the strength of the measurement itself.
            // Never `?? 0` - that would turn every rate-only item into a
            // contract for no work and fail every approval.
            contractQty: item.contractQty,
            completedQty: item.completedQty + already,
            currentQty: line.currentQty,
            ratePaise: item.ratePaise,
            ...(options.changeOrderApproved === true ? { changeOrderApproved: true } : {}),
          })
          if (!check.ok) {
            if (check.rejection.reason === 'EXCEEDS_CONTRACT') {
              failures.push({
                boqItemName: item.name,
                allowedQty: check.rejection.allowedQty,
                requestedQty: line.currentQty,
              })
            }
            continue
          }
          running.set(item.id, already + line.currentQty)
        }

        if (failures.length > 0) {
          throw new ApprovalRejected(
            'Approving this would exceed the agreed contract quantity.',
            failures,
          )
        }

        for (const [boqItemId, delta] of running) {
          const item = live.get(boqItemId)
          if (!item) continue
          tx.update(doc(db, 'boqItems', boqItemId), {
            completedQty: item.completedQty + delta,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
        }

        tx.update(doc(db, 'measurements', measurement.id), {
          status: 'APPROVED' satisfies MeasurementStatus,
          approvedBy: actor.uid,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'MEASUREMENT_APPROVED',
          entityType: 'measurement',
          entityId: measurement.id,
          projectId: measurement.projectId,
          after: {
            totalAmountPaise: measurement.totalAmountPaise,
            lineCount: items.length,
            changeOrder: options.changeOrderApproved === true,
          },
          at: serverTimestamp(),
        })
      })
    },
  }
}

export type MeasurementRepository = ReturnType<typeof createMeasurementRepository>
