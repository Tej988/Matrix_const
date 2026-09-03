import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { BoqItem, Paise, Unit } from '@mc/types'
import { contractAmount } from '../business/boqCalculator'

function toBoqItem(id: string, d: Record<string, unknown>): BoqItem {
  return {
    id,
    projectId: d['projectId'] as string,
    code: (d['code'] as string) ?? '',
    name: (d['name'] as string) ?? '',
    unit: (d['unit'] as Unit) ?? 'NOS',
    ratePaise: (d['ratePaise'] as Paise) ?? (0 as Paise),
    completedQty: (d['completedQty'] as number) ?? 0,
    billedQty: (d['billedQty'] as number) ?? 0,
    sortOrder: (d['sortOrder'] as number) ?? 0,
    status: (d['status'] as BoqItem['status']) ?? 'ACTIVE',
    // NOT defaulted to 0. An absent contract quantity means the item is priced
    // by rate alone; a 0 here would become a section 4 ceiling of zero and
    // reject every measurement ever entered against it.
    ...(typeof d['contractQty'] === 'number' ? { contractQty: d['contractQty'] } : {}),
    ...(typeof d['contractAmountPaise'] === 'number'
      ? { contractAmountPaise: d['contractAmountPaise'] as Paise }
      : {}),
    ...(d['description'] ? { description: d['description'] as string } : {}),
    ...(d['hsnSac'] ? { hsnSac: d['hsnSac'] as string } : {}),
  }
}

export interface NewBoqItem {
  code: string
  name: string
  description?: string
  unit: Unit
  /** Omitted on a rate-only item, which is how this business normally quotes. */
  contractQty?: number
  ratePaise: Paise
}

export function createBoqRepository(db: Firestore) {
  return {
    async listForProject(projectId: string): Promise<BoqItem[]> {
      const snap = await getDocs(
        query(
          collection(db, 'boqItems'),
          where('projectId', '==', projectId),
          orderBy('sortOrder'),
        ),
      )
      return snap.docs.map((d) => toBoqItem(d.id, d.data()))
    },

    /**
     * contractAmountPaise is computed here and stored, rather than derived on
     * read. Storing it means a later rate change cannot silently restate the
     * agreed contract - and it lets Security Rules validate the arithmetic
     * without needing to multiply.
     *
     * Both quantity fields are written only when there IS a quantity. The two
     * travel together and are absent together; Firestore rejects an explicit
     * undefined, and a stored 0 would read as a contract for no work.
     */
    async create(
      projectId: string,
      input: NewBoqItem,
      sortOrder: number,
      actorUid: string,
    ): Promise<string> {
      const ref = doc(collection(db, 'boqItems'))
      await setDoc(ref, {
        projectId,
        code: input.code,
        name: input.name,
        unit: input.unit,
        ratePaise: input.ratePaise,
        ...(input.contractQty !== undefined
          ? {
              contractQty: input.contractQty,
              contractAmountPaise: contractAmount(input.contractQty, input.ratePaise),
            }
          : {}),
        completedQty: 0,
        billedQty: 0,
        sortOrder,
        status: 'ACTIVE',
        ...(input.description ? { description: input.description } : {}),
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
      return ref.id
    },

    /**
     * Editing rate, name, unit or quantity, recording the change.
     *
     * Rate history matters: an approved measurement snapshotted the old rate
     * and an issued bill is frozen, so a rate change applies to future work
     * only and must never appear to rewrite what was already agreed.
     *
     * A patch that says nothing about `contractQty` LEAVES IT ALONE, whichever
     * state it is in. The edit form no longer offers the field, and a form that
     * has stopped asking a question must not be read as answering it "none" -
     * that would quietly strip the section 4 ceiling off a genuinely
     * fixed-quantity item.
     */
    async update(
      item: BoqItem,
      patch: Partial<NewBoqItem>,
      actor: { uid: string; displayName: string },
    ): Promise<void> {
      const contractQty = patch.contractQty ?? item.contractQty
      const ratePaise = patch.ratePaise ?? item.ratePaise
      const rateChanged = patch.ratePaise !== undefined && patch.ratePaise !== item.ratePaise

      const batch = writeBatch(db)

      batch.update(doc(db, 'boqItems', item.id), {
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ratePaise,
        // The amount is quantity x rate, so it is rewritten only where a
        // quantity exists. On a rate-only item neither field is touched and
        // neither is created.
        ...(contractQty !== undefined
          ? { contractQty, contractAmountPaise: contractAmount(contractQty, ratePaise) }
          : {}),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })

      if (rateChanged) {
        // Section 19 lists "wage rate changed" as auditable; a BOQ rate change
        // moves money the same way and deserves the same record.
        batch.set(doc(collection(db, 'auditLogs')), {
          userId: actor.uid,
          userName: actor.displayName,
          action: 'BOQ_RATE_CHANGED',
          entityType: 'boqItem',
          entityId: item.id,
          projectId: item.projectId,
          // `null` rather than an omitted key: the audit entry is a record of
          // what the field WAS, and "there was no contract quantity" is itself
          // the fact worth keeping. Firestore rejects an explicit undefined.
          before: { ratePaise: item.ratePaise, contractQty: item.contractQty ?? null },
          after: { ratePaise, contractQty: contractQty ?? null },
          at: serverTimestamp(),
        })
      }

      await batch.commit()
    },

    async setStatus(itemId: string, status: BoqItem['status'], actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'boqItems', itemId), {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },
  }
}

export type BoqRepository = ReturnType<typeof createBoqRepository>
