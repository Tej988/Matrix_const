import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { Paise, Project, ProjectSummary } from '@mc/types'
import { SUMMARY_SCHEMA_VERSION } from '@mc/types'
import { computeProjectSummary, detectDrift, type SummaryDrift } from '../business/projectSummary'

/**
 * Summary reconciliation. RISKS.md R-04.
 *
 * Project summaries are maintained by client-side transactions because there
 * are no Cloud Functions on Spark (ADR-002). A transaction that fails after a
 * partial UI update, a record predating a formula change, or a manual edit in
 * the Firebase Console all leave the summary disagreeing with the underlying
 * documents.
 *
 * This re-derives every figure from source records. It is the AUTHORITATIVE
 * definition; the incremental updates are an optimisation over it.
 *
 * Deliberately NOT automatic. It reads every financial document for a project,
 * which is exactly the unbounded read pattern R-10 warns about - so it runs
 * when the owner presses a button, shows a diff, and asks before writing.
 */

export function createReconcileRepository(db: Firestore) {
  async function amounts(
    collectionName: string,
    projectId: string,
    field: string,
    filter?: { field: string; value: string },
  ): Promise<Paise[]> {
    const constraints = [where('projectId', '==', projectId)]
    if (filter) constraints.push(where(filter.field, '==', filter.value))
    const snap = await getDocs(query(collection(db, collectionName), ...constraints))
    return snap.docs.map((d) => (d.data()[field] as Paise) ?? (0 as Paise))
  }

  return {
    /**
     * Re-derives a project's summary and reports what disagrees.
     *
     * Reads but does not write - so an owner can look before committing.
     */
    async preview(
      project: Pick<Project, 'id' | 'contractValuePaise'>,
      computedBy: string,
      at: Date,
    ) {
      const [bills, receipts, measurements, wages, labourPaid, allExpenses] = await Promise.all([
        (async () => {
          const snap = await getDocs(
            query(collection(db, 'bills'), where('projectId', '==', project.id)),
          )
          // Cancelled bills are excluded - they were reversed, not issued.
          return snap.docs
            .filter((d) => d.data()['status'] !== 'CANCELLED')
            .map((d) => (d.data()['netAmountPaise'] as Paise) ?? (0 as Paise))
        })(),
        amounts('clientPayments', project.id, 'amountPaise', {
          field: 'status',
          value: 'CONFIRMED',
        }),
        (async () => {
          const snap = await getDocs(
            query(collection(db, 'measurements'), where('projectId', '==', project.id)),
          )
          return snap.docs
            .filter((d) => d.data()['status'] === 'APPROVED')
            .map((d) => (d.data()['totalAmountPaise'] as Paise) ?? (0 as Paise))
        })(),
        (async () => {
          const snap = await getDocs(
            query(collection(db, 'wagePeriods'), where('projectId', '==', project.id)),
          )
          return snap.docs
            .filter((d) => d.data()['status'] === 'LOCKED')
            .map((d) => (d.data()['earnedAmountPaise'] as Paise) ?? (0 as Paise))
        })(),
        amounts('labourPayments', project.id, 'amountPaise', {
          field: 'status',
          value: 'CONFIRMED',
        }),
        (async () => {
          const snap = await getDocs(
            query(collection(db, 'expenses'), where('projectId', '==', project.id)),
          )
          // LABOUR-category expenses are excluded: labourPaid already covers
          // wages, and counting both would double every worker's cost.
          return snap.docs
            .filter((d) => d.data()['category'] !== 'LABOUR' && d.data()['status'] !== 'REVERSED')
            .map((d) => (d.data()['amountPaise'] as Paise) ?? (0 as Paise))
        })(),
      ])

      const derived = computeProjectSummary(
        project.id,
        {
          contractValuePaise: project.contractValuePaise,
          billNetAmounts: bills,
          confirmedReceipts: receipts,
          approvedMeasurementAmounts: measurements,
          lockedWageEarnings: wages,
          confirmedLabourPayments: labourPaid,
          nonLabourExpenses: allExpenses,
        },
        computedBy,
        at,
      )

      const storedSnap = await getDoc(doc(db, 'projects', project.id, 'summary', 'current'))
      const stored = storedSnap.exists()
        ? ({ ...storedSnap.data(), projectId: project.id } as unknown as ProjectSummary)
        : null

      const drift: SummaryDrift[] = detectDrift(stored, derived)

      return {
        derived,
        stored,
        drift,
        documentsRead:
          bills.length +
          receipts.length +
          measurements.length +
          wages.length +
          labourPaid.length +
          allExpenses.length,
      }
    },

    /** Writes the derived summary and records what changed. */
    async apply(
      derived: ProjectSummary,
      drift: readonly SummaryDrift[],
      actor: { uid: string; displayName: string },
    ): Promise<void> {
      await setDoc(
        doc(db, 'projects', derived.projectId, 'summary', 'current'),
        {
          ...derived,
          computedAt: serverTimestamp(),
          computedBy: actor.uid,
          schemaVersion: SUMMARY_SCHEMA_VERSION,
        },
        { merge: true },
      )

      await setDoc(doc(collection(db, 'auditLogs')), {
        userId: actor.uid,
        userName: actor.displayName,
        action: 'SUMMARY_RECONCILED',
        entityType: 'projectSummary',
        entityId: derived.projectId,
        projectId: derived.projectId,
        before: Object.fromEntries(drift.map((d) => [d.field, d.stored])),
        after: Object.fromEntries(drift.map((d) => [d.field, d.derived])),
        reason: `${drift.length} field(s) corrected`,
        at: serverTimestamp(),
      })
    },
  }
}

export type ReconcileRepository = ReturnType<typeof createReconcileRepository>
