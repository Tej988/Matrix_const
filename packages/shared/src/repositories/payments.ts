import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type {
  ClientPayment,
  ClientPaymentMethod,
  DateKey,
  Expense,
  ExpenseCategory,
  LabourPayment,
  Paise,
  PaymentMethod,
  WagePeriod,
} from '@mc/types'
import { add, subtract } from '../money/index'
import type { DocumentKind, StoredFileRef } from '../storage/index'

/**
 * All money movement. Every write here follows the same shape:
 *
 *   transaction {
 *     reject if the idempotency key already exists   (critical test 10)
 *     write the record
 *     append a ledger entry                          (section 18)
 *     update the project summary                     (section 23)
 *     append an audit entry                          (section 19)
 *   }
 *
 * Five writes, one atomic commit. Since there is no server (ADR-002), this is
 * the closest thing to a financial boundary the system has - and it fails
 * loudly offline rather than appearing to succeed (R-02).
 */

export class DuplicatePayment extends Error {
  constructor(readonly idempotencyKey: string) {
    super('This payment has already been recorded.')
    this.name = 'DuplicatePayment'
  }
}

async function assertNotDuplicate(
  db: Firestore,
  collectionName: string,
  idempotencyKey: string,
): Promise<void> {
  const existing = await getDocs(
    query(collection(db, collectionName), where('idempotencyKey', '==', idempotencyKey)),
  )
  if (!existing.empty) throw new DuplicatePayment(idempotencyKey)
}

/**
 * A stored labour payment. `isAdvance` marks money handed over before the
 * wages that earn it. Documents written before advances existed simply lack
 * the field, so readers must treat a missing flag as "not an advance".
 */
export interface LabourPaymentRecord extends LabourPayment {
  isAdvance?: boolean | undefined
}

export function createPaymentRepository(db: Firestore) {
  return {
    // ---- client payments (money in) ----

    async listClientPayments(projectId: string): Promise<ClientPayment[]> {
      const snap = await getDocs(
        query(
          collection(db, 'clientPayments'),
          where('projectId', '==', projectId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClientPayment, 'id'>) }))
    },

    /**
     * Records money received from a client, confirmed immediately because a
     * human is typing it from a bank message they are looking at.
     *
     * Import- and OCR-derived payments take a different path: they land as
     * SUGGESTED and require a human transition (section 9, section 34).
     */
    async recordClientPayment(
      input: {
        projectId: string
        clientId: string
        billId?: string
        amountPaise: Paise
        date: DateKey
        method: ClientPaymentMethod
        reference: string
        idempotencyKey: string
        notes?: string
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      await assertNotDuplicate(db, 'clientPayments', input.idempotencyKey)

      const paymentRef = doc(collection(db, 'clientPayments'))
      const summaryRef = doc(db, 'projects', input.projectId, 'summary', 'current')

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)
        const billSnap = input.billId ? await tx.get(doc(db, 'bills', input.billId)) : null

        tx.set(paymentRef, {
          projectId: input.projectId,
          clientId: input.clientId,
          amountPaise: input.amountPaise,
          date: input.date,
          method: input.method,
          source: 'MANUAL',
          status: 'CONFIRMED',
          idempotencyKey: input.idempotencyKey,
          confirmedBy: actor.uid,
          confirmedAt: serverTimestamp(),
          ...(input.billId ? { billId: input.billId } : {}),
          ...(input.reference ? { bankReference: input.reference } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        tx.set(doc(collection(db, 'transactions')), {
          projectId: input.projectId,
          type: 'CLIENT_PAYMENT',
          direction: 'IN',
          amountPaise: input.amountPaise,
          date: input.date,
          refType: 'clientPayment',
          refId: paymentRef.id,
          description: `Received from client via ${input.method}`,
          status: 'ACTIVE',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        })

        // Roll the payment into the bill it settles, if any.
        if (billSnap?.exists()) {
          const received = add(
            (billSnap.data()['amountReceivedPaise'] as Paise) ?? (0 as Paise),
            input.amountPaise,
          )
          const net = (billSnap.data()['netAmountPaise'] as Paise) ?? (0 as Paise)
          tx.update(doc(db, 'bills', input.billId as string), {
            amountReceivedPaise: received,
            status: received >= net ? 'PAID' : 'PARTIALLY_PAID',
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
        }

        const data = summarySnap.data() ?? {}
        const received = add(
          (data['totalReceivedPaise'] as Paise) ?? (0 as Paise),
          input.amountPaise,
        )
        const billed = (data['totalBilledPaise'] as Paise) ?? (0 as Paise)
        const contract = (data['contractValuePaise'] as Paise) ?? (0 as Paise)
        const cashOut = (data['cashOutPaise'] as Paise) ?? (0 as Paise)

        tx.set(
          summaryRef,
          {
            totalReceivedPaise: received,
            receivablePaise: subtract(billed, received),
            contractRemainingPaise: subtract(contract, received),
            netPositionPaise: subtract(received, cashOut),
            computedAt: serverTimestamp(),
            computedBy: actor.uid,
          },
          { merge: true },
        )

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'CLIENT_PAYMENT_RECORDED',
          entityType: 'clientPayment',
          entityId: paymentRef.id,
          projectId: input.projectId,
          after: { amountPaise: input.amountPaise, method: input.method },
          at: serverTimestamp(),
        })
      })

      return paymentRef.id
    },

    // ---- labour payments (money out) ----

    async listLabourPayments(projectId: string): Promise<LabourPaymentRecord[]> {
      const snap = await getDocs(
        query(
          collection(db, 'labourPayments'),
          where('projectId', '==', projectId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabourPaymentRecord, 'id'>) }))
    },

    async paymentsForLabour(labourId: string): Promise<LabourPaymentRecord[]> {
      const snap = await getDocs(
        query(
          collection(db, 'labourPayments'),
          where('labourId', '==', labourId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabourPaymentRecord, 'id'>) }))
    },

    /**
     * Records a wage payment, or an advance against wages not yet earned.
     * Section 15 - never initiates a PhonePe transfer either way.
     *
     * `date` is the day the money changed hands, supplied by the caller rather
     * than assumed to be today: cash paid on site on Friday is routinely
     * entered on Monday, and dating it Monday moves it into the wrong wage
     * period. `paidByUid`/`paidByName` are who handed it over, which is a
     * different question from who typed it in (`createdBy`).
     */
    async recordLabourPayment(
      input: {
        labourId: string
        labourName: string
        projectId: string
        wagePeriodId?: string
        amountPaise: Paise
        date: DateKey
        method: PaymentMethod
        reference: string
        idempotencyKey: string
        /** Paid before the wages that earn it. Recovered later by the ledger. */
        isAdvance?: boolean
        paidByUid: string
        paidByName: string
        /** An already-uploaded proof. Absent is normal - ADR-009 fails soft. */
        documentId?: string
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      await assertNotDuplicate(db, 'labourPayments', input.idempotencyKey)

      const isAdvance = input.isAdvance ?? false

      const paymentRef = doc(collection(db, 'labourPayments'))
      const summaryRef = doc(db, 'projects', input.projectId, 'summary', 'current')
      const documentRef = input.documentId ? doc(db, 'documents', input.documentId) : null

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)
        /*
         * Read before writing the back-pointer, and only write it if the record
         * is really there. A blind write would be a CREATE if the metadata
         * record had gone missing, Rules would reject it for having no
         * `provider`, and a missing attachment would take the payment down with
         * it. ADR-009 is explicit: a file must never fail a payment.
         */
        const documentSnap = documentRef ? await tx.get(documentRef) : null

        tx.set(paymentRef, {
          labourId: input.labourId,
          labourName: input.labourName,
          projectId: input.projectId,
          amountPaise: input.amountPaise,
          date: input.date,
          method: input.method,
          status: 'CONFIRMED',
          idempotencyKey: input.idempotencyKey,
          isAdvance,
          paidByUid: input.paidByUid,
          paidByName: input.paidByName,
          ...(input.wagePeriodId ? { wagePeriodId: input.wagePeriodId } : {}),
          ...(input.documentId ? { documentId: input.documentId } : {}),
          ...(input.method === 'PHONEPE' && input.reference
            ? { phonepeTransactionId: input.reference }
            : {}),
          ...(input.method === 'BANK_TRANSFER' && input.reference
            ? { bankTransactionId: input.reference }
            : {}),
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        if (documentRef && documentSnap?.exists()) {
          tx.update(documentRef, {
            linkedRefType: 'labourPayment',
            linkedRefId: paymentRef.id,
          })
        }

        tx.set(doc(collection(db, 'transactions')), {
          projectId: input.projectId,
          type: 'LABOUR_PAYMENT',
          direction: 'OUT',
          amountPaise: input.amountPaise,
          date: input.date,
          refType: 'labourPayment',
          refId: paymentRef.id,
          description: `${isAdvance ? 'Advance' : 'Wage'} paid to ${input.labourName} via ${input.method} by ${input.paidByName}`,
          status: 'ACTIVE',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        })

        // An advance is cash out like any other payment, so it counts in
        // labourPaid and pushes labourPayable negative until wages catch up.
        // Recovery is a reporting concern (wageCalculator), not a reason to
        // leave money out of the summary - that is how a summary drifts.
        const data = summarySnap.data() ?? {}
        const paid = add((data['labourPaidPaise'] as Paise) ?? (0 as Paise), input.amountPaise)
        const earned = (data['labourEarnedPaise'] as Paise) ?? (0 as Paise)
        const otherExpenses = (data['otherExpensesPaise'] as Paise) ?? (0 as Paise)
        const received = (data['totalReceivedPaise'] as Paise) ?? (0 as Paise)
        const cashOut = add(paid, otherExpenses)

        tx.set(
          summaryRef,
          {
            labourPaidPaise: paid,
            labourPayablePaise: subtract(earned, paid),
            cashOutPaise: cashOut,
            netPositionPaise: subtract(received, cashOut),
            computedAt: serverTimestamp(),
            computedBy: actor.uid,
          },
          { merge: true },
        )

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'LABOUR_PAYMENT_RECORDED',
          entityType: 'labourPayment',
          entityId: paymentRef.id,
          projectId: input.projectId,
          after: {
            labourName: input.labourName,
            amountPaise: input.amountPaise,
            isAdvance,
            date: input.date,
            paidByUid: input.paidByUid,
            paidByName: input.paidByName,
            ...(input.documentId ? { documentId: input.documentId } : {}),
          },
          at: serverTimestamp(),
        })
      })

      return paymentRef.id
    },

    // ---- attachments ----
    //
    // The `documents` collection has no repository of its own yet, and it lands
    // here rather than getting one because payment proofs are the first and
    // only writer of it. The alternative - a component importing Firestore
    // directly - breaks the one layering rule the project has
    // (ARCHITECTURE.md section 4). Move this out the day a second caller
    // appears.

    /**
     * Storage-agnostic file metadata (ADR-009). `provider` and `externalId` are
     * whatever the adapter handed back; nothing here interprets them.
     *
     * `linkedRefId` is optional because a proof is usually uploaded a moment
     * BEFORE the payment it belongs to exists. `recordLabourPayment` fills it
     * in from inside the same transaction that creates the payment.
     */
    async recordDocument(
      input: {
        ref: StoredFileRef
        kind: DocumentKind
        projectId: string
        linkedRefType: string
        linkedRefId?: string
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      const documentRef = doc(collection(db, 'documents'))

      await setDoc(documentRef, {
        projectId: input.projectId,
        kind: input.kind,
        provider: input.ref.provider,
        externalId: input.ref.externalId,
        fileName: input.ref.fileName,
        mimeType: input.ref.mimeType,
        sizeBytes: input.ref.sizeBytes,
        linkedRefType: input.linkedRefType,
        ...(input.linkedRefId ? { linkedRefId: input.linkedRefId } : {}),
        status: 'AVAILABLE',
        uploadedBy: actor.uid,
        uploadedAt: serverTimestamp(),
      })

      return documentRef.id
    },

    /**
     * Attaches a proof to a payment that is already recorded - the retry path
     * for ADR-009's fail-soft rule. The money went in without the photo; this
     * catches the photo up afterwards without touching a single figure.
     *
     * A batch rather than a transaction: nothing is read, nothing is computed,
     * and no amount moves.
     */
    async attachDocumentToLabourPayment(
      input: { paymentId: string; documentId: string; projectId: string },
      actor: { uid: string; displayName: string },
    ): Promise<void> {
      const batch = writeBatch(db)

      batch.update(doc(db, 'labourPayments', input.paymentId), {
        documentId: input.documentId,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })

      batch.update(doc(db, 'documents', input.documentId), {
        linkedRefType: 'labourPayment',
        linkedRefId: input.paymentId,
      })

      batch.set(doc(collection(db, 'auditLogs')), {
        userId: actor.uid,
        userName: actor.displayName,
        action: 'LABOUR_PAYMENT_PROOF_ATTACHED',
        entityType: 'labourPayment',
        entityId: input.paymentId,
        projectId: input.projectId,
        after: { documentId: input.documentId },
        at: serverTimestamp(),
      })

      await batch.commit()
    },

    // ---- expenses ----

    async listExpenses(projectId: string): Promise<Expense[]> {
      const snap = await getDocs(
        query(
          collection(db, 'expenses'),
          where('projectId', '==', projectId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Expense, 'id'>) }))
    },

    async recordExpense(
      input: {
        projectId: string
        category: ExpenseCategory
        amountPaise: Paise
        date: DateKey
        description: string
        paymentMethod: PaymentMethod
        vendorName?: string
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      const expenseRef = doc(collection(db, 'expenses'))
      const summaryRef = doc(db, 'projects', input.projectId, 'summary', 'current')

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)

        tx.set(expenseRef, {
          projectId: input.projectId,
          category: input.category,
          amountPaise: input.amountPaise,
          date: input.date,
          description: input.description,
          paymentMethod: input.paymentMethod,
          status: 'RECORDED',
          ...(input.vendorName ? { vendorName: input.vendorName } : {}),
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        })

        tx.set(doc(collection(db, 'transactions')), {
          projectId: input.projectId,
          type: 'EXPENSE',
          direction: 'OUT',
          amountPaise: input.amountPaise,
          date: input.date,
          refType: 'expense',
          refId: expenseRef.id,
          description: input.description,
          status: 'ACTIVE',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        })

        // LABOUR-category expenses are deliberately NOT added to
        // otherExpenses: labourPaid already covers wages, and counting both
        // would double the cost of every worker.
        if (input.category !== 'LABOUR') {
          const data = summarySnap.data() ?? {}
          const other = add(
            (data['otherExpensesPaise'] as Paise) ?? (0 as Paise),
            input.amountPaise,
          )
          const labourPaid = (data['labourPaidPaise'] as Paise) ?? (0 as Paise)
          const received = (data['totalReceivedPaise'] as Paise) ?? (0 as Paise)
          const cashOut = add(labourPaid, other)

          tx.set(
            summaryRef,
            {
              otherExpensesPaise: other,
              cashOutPaise: cashOut,
              netPositionPaise: subtract(received, cashOut),
              computedAt: serverTimestamp(),
              computedBy: actor.uid,
            },
            { merge: true },
          )
        }

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'EXPENSE_RECORDED',
          entityType: 'expense',
          entityId: expenseRef.id,
          projectId: input.projectId,
          after: { category: input.category, amountPaise: input.amountPaise },
          at: serverTimestamp(),
        })
      })

      return expenseRef.id
    },

    // ---- wage periods ----

    async listWagePeriods(projectId: string): Promise<WagePeriod[]> {
      const snap = await getDocs(
        query(
          collection(db, 'wagePeriods'),
          where('projectId', '==', projectId),
          orderBy('periodFrom', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WagePeriod, 'id'>) }))
    },

    /**
     * Locks a wage period: freezes the computed figures, stamps every
     * contributing attendance record so it can no longer be edited, and adds
     * the earnings to the project summary.
     *
     * Locking is what makes labourEarned real. Before it, the number is a
     * preview that attendance edits can still move.
     */
    async lockWagePeriod(
      input: {
        period: Omit<WagePeriod, 'id' | 'status'>
        attendanceIds: readonly string[]
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      const periodRef = doc(collection(db, 'wagePeriods'))
      const summaryRef = doc(db, 'projects', input.period.projectId, 'summary', 'current')

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)

        tx.set(periodRef, {
          ...input.period,
          status: 'LOCKED',
          lockedBy: actor.uid,
          lockedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
        })

        for (const id of input.attendanceIds) {
          tx.update(doc(db, 'attendance', id), { wagePeriodId: periodRef.id })
        }

        tx.set(doc(collection(db, 'transactions')), {
          projectId: input.period.projectId,
          type: 'ADJUSTMENT',
          direction: 'ACCRUAL',
          amountPaise: input.period.earnedAmountPaise,
          date: input.period.periodTo,
          refType: 'wagePeriod',
          refId: periodRef.id,
          description: `Wages earned by ${input.period.labourName}`,
          status: 'ACTIVE',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        })

        const data = summarySnap.data() ?? {}
        const earned = add(
          (data['labourEarnedPaise'] as Paise) ?? (0 as Paise),
          input.period.earnedAmountPaise,
        )
        const paid = (data['labourPaidPaise'] as Paise) ?? (0 as Paise)

        tx.set(
          summaryRef,
          {
            labourEarnedPaise: earned,
            labourPayablePaise: subtract(earned, paid),
            computedAt: serverTimestamp(),
            computedBy: actor.uid,
          },
          { merge: true },
        )

        tx.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'WAGE_PERIOD_LOCKED',
          entityType: 'wagePeriod',
          entityId: periodRef.id,
          projectId: input.period.projectId,
          after: {
            labourName: input.period.labourName,
            earnedAmountPaise: input.period.earnedAmountPaise,
            payableDays: input.period.payableDays,
          },
          at: serverTimestamp(),
        })
      })

      return periodRef.id
    },
  }
}

export type PaymentRepository = ReturnType<typeof createPaymentRepository>
