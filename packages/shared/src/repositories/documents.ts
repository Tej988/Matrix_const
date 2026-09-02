import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { driveViewUrl } from '../storage/driveAdapter'
import type { DocumentKind, StorageProvider } from '../storage/index'

/**
 * Reading back the files ADR-009 files away.
 *
 * `payments.ts` writes `documents` and says in as many words to move the
 * collection out the day a second caller appears. This is that day: the labour
 * detail page lists every payment made to one person and has to offer the proof
 * beside each one, which means turning a stored `documentId` into something a
 * browser can open. Only the reader lives here - moving the writer would mean
 * reopening the payment transaction for no gain.
 */
export interface DocumentRecord {
  id: string
  projectId: string
  kind: DocumentKind
  provider: StorageProvider
  externalId: string
  fileName: string
  mimeType: string
  /** DELETED is a tombstone: the metadata survives, the bytes may not. */
  status: 'AVAILABLE' | 'DELETED'
}

function toDocument(id: string, d: Record<string, unknown>): DocumentRecord {
  return {
    id,
    projectId: (d['projectId'] as string) ?? '',
    kind: (d['kind'] as DocumentKind) ?? 'OTHER',
    provider: (d['provider'] as StorageProvider) ?? 'GOOGLE_DRIVE',
    externalId: (d['externalId'] as string) ?? '',
    fileName: (d['fileName'] as string) ?? '',
    mimeType: (d['mimeType'] as string) ?? '',
    status: (d['status'] as DocumentRecord['status']) ?? 'AVAILABLE',
  }
}

export function createDocumentRepository(db: Firestore) {
  return {
    /**
     * Documents by id, skipping any that are not there.
     *
     * One `getDoc` each rather than an `in` query: the ids are already known,
     * proofs are a minority of payments, and `in` caps at thirty anyway. A
     * missing record is not an error - under ADR-009 a payment can outlive its
     * attachment, and that case has to render as "no proof", not as a failure.
     */
    async getMany(ids: readonly string[]): Promise<Map<string, DocumentRecord>> {
      const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'documents', id))))
      const found = new Map<string, DocumentRecord>()
      for (const snap of snaps) {
        if (snap.exists()) found.set(snap.id, toDocument(snap.id, snap.data()))
      }
      return found
    },
  }
}

/**
 * Where to send someone who wants to look at the file. Null when there is
 * nothing to open - a tombstoned record, or a provider with no shareable link.
 * Keeping the provider check here is what stops a Drive file ID leaking into a
 * component the day Firebase Storage becomes buildable.
 */
export function documentViewUrl(record: DocumentRecord): string | null {
  if (record.status === 'DELETED') return null
  return record.provider === 'GOOGLE_DRIVE' ? driveViewUrl(record.externalId) : null
}

export type DocumentRepository = ReturnType<typeof createDocumentRepository>
