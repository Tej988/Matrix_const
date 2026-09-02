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
    contractQty: (d['contractQty'] as number) ?? 0,
    ratePaise: (d['ratePaise'] as Paise) ?? (0 as Paise),
    contractAmountPaise: (d['contractAmountPaise'] as Paise) ?? (0 as Paise),
    completedQty: (d['completedQty'] as number) ?? 0,
    billedQty: (d['billedQty'] as number) ?? 0,
    sortOrder: (d['sortOrder'] as number) ?? 0,
    status: (d['status'] as BoqItem['status']) ?? 'ACTIVE',
    ...(d['description'] ? { description: d['description'] as string } : {}),
    ...(d['hsnSac'] ? { hsnSac: d['hsnSac'] as string } : {}),
  }
}

export interface NewBoqItem {
  code: string
  name: string
  description?: string
  unit: Unit
  contractQty: number
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
        contractQty: input.contractQty,
        ratePaise: input.ratePaise,
        contractAmountPaise: contractAmount(input.contractQty, input.ratePaise),
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
     * Editing quantity or rate recomputes the contract amount and records the
     * change. Rate history matters: an approved measurement snapshotted the old
     * rate, and this must not appear to rewrite it.
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
        contractQty,
        ratePaise,
        contractAmountPaise: contractAmount(contractQty, ratePaise),
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
          before: { ratePaise: item.ratePaise, contractQty: item.contractQty },
          after: { ratePaise, contractQty },
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
