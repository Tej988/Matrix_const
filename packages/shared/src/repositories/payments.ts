import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
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

    async listLabourPayments(projectId: string): Promise<LabourPayment[]> {
      const snap = await getDocs(
        query(
          collection(db, 'labourPayments'),
          where('projectId', '==', projectId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabourPayment, 'id'>) }))
    },

    async paymentsForLabour(labourId: string): Promise<LabourPayment[]> {
      const snap = await getDocs(
        query(
          collection(db, 'labourPayments'),
          where('labourId', '==', labourId),
          orderBy('date', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabourPayment, 'id'>) }))
    },

    /** Records a wage payment. Section 15 - never initiates a PhonePe transfer. */
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
      },
      actor: { uid: string; displayName: string },
    ): Promise<string> {
      await assertNotDuplicate(db, 'labourPayments', input.idempotencyKey)

      const paymentRef = doc(collection(db, 'labourPayments'))
      const summaryRef = doc(db, 'projects', input.projectId, 'summary', 'current')

      await runTransaction(db, async (tx) => {
        const summarySnap = await tx.get(summaryRef)

        tx.set(paymentRef, {
          labourId: input.labourId,
          labourName: input.labourName,
          projectId: input.projectId,
          amountPaise: input.amountPaise,
          date: input.date,
          method: input.method,
          status: 'CONFIRMED',
          idempotencyKey: input.idempotencyKey,
          ...(input.wagePeriodId ? { wagePeriodId: input.wagePeriodId } : {}),
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

        tx.set(doc(collection(db, 'transactions')), {
          projectId: input.projectId,
          type: 'LABOUR_PAYMENT',
          direction: 'OUT',
          amountPaise: input.amountPaise,
          date: input.date,
          refType: 'labourPayment',
          refId: paymentRef.id,
          description: `Wage paid to ${input.labourName} via ${input.method}`,
          status: 'ACTIVE',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        })

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
          after: { labourName: input.labourName, amountPaise: input.amountPaise },
          at: serverTimestamp(),
        })
      })

      return paymentRef.id
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
