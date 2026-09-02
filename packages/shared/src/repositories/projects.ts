import {
  collection,
  doc,
  documentId,
  getDoc,
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
import type {
  Client,
  Paise,
  Project,
  ProjectMember,
  ProjectStatus,
  ProjectSummary,
  Role,
} from '@mc/types'
import { NO_TAX, SUMMARY_SCHEMA_VERSION } from '@mc/types'
import { emptySummary } from '../business/projectSummary'
import { EPOCH } from '../datetime/index'

/**
 * Firestore has no `undefined`; an absent optional must be omitted entirely.
 *
 * The return type strips `undefined` from each value rather than using
 * `Partial<T>`, which would keep it. Under `exactOptionalPropertyTypes` those
 * are different things: `field?: T` and `field?: T | undefined` do not unify,
 * and only the former can be spread into an entity type.
 */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> }

function defined<T extends Record<string, unknown>>(obj: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Defined<T>
}

function toClient(id: string, d: Record<string, unknown>): Client {
  return {
    id,
    name: (d['name'] as string) ?? '',
    contactPerson: (d['contactPerson'] as string) ?? '',
    status: (d['status'] as Client['status']) ?? 'ACTIVE',
    ...defined({
      phone: d['phone'] as string,
      email: d['email'] as string,
      billingAddress: d['billingAddress'] as string,
      city: d['city'] as string,
      state: d['state'] as string,
      gstin: d['gstin'] as string,
      notes: d['notes'] as string,
    }),
  }
}

function toProject(id: string, d: Record<string, unknown>): Project {
  return {
    id,
    name: (d['name'] as string) ?? '',
    code: (d['code'] as string) ?? '',
    clientId: (d['clientId'] as string) ?? '',
    clientName: (d['clientName'] as string) ?? '',
    startDate: d['startDate'] as Project['startDate'],
    status: (d['status'] as ProjectStatus) ?? 'PLANNING',
    taxProfile: (d['taxProfile'] as Project['taxProfile']) ?? NO_TAX,
    ...defined({
      /*
       * Deliberately NOT defaulted to zero. A project with no agreed total
       * (R-01) must arrive with the field absent, so every reader has to
       * decide what to show; a zero would silently become "₹0 contract" and
       * then "everything is still to bill".
       */
      contractValuePaise:
        typeof d['contractValuePaise'] === 'number'
          ? (d['contractValuePaise'] as Paise)
          : undefined,
      siteAddress: d['siteAddress'] as string,
      city: d['city'] as string,
      state: d['state'] as string,
      expectedEndDate: d['expectedEndDate'] as Project['expectedEndDate'],
    }),
  }
}

export function createClientRepository(db: Firestore) {
  return {
    async list(): Promise<Client[]> {
      const snap = await getDocs(query(collection(db, 'clients'), orderBy('name')))
      return snap.docs.map((d) => toClient(d.id, d.data()))
    },

    async get(id: string): Promise<Client | null> {
      const snap = await getDoc(doc(db, 'clients', id))
      return snap.exists() ? toClient(snap.id, snap.data()) : null
    },

    async create(input: Omit<Client, 'id'>, actorUid: string): Promise<string> {
      const ref = doc(collection(db, 'clients'))
      await setDoc(ref, {
        ...defined({ ...input }),
        name: input.name,
        status: input.status,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
      return ref.id
    },

    async update(id: string, patch: Partial<Omit<Client, 'id'>>, actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'clients', id), {
        ...defined({ ...patch }),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },
  }
}

/** A stored amount that is legitimately absent. Anything non-numeric is null. */
function nullablePaise(v: unknown): Paise | null {
  return typeof v === 'number' ? (v as Paise) : null
}

export function createProjectRepository(db: Firestore) {
  return {
    /**
     * Projects visible to this user.
     *
     * A supervisor cannot list the projects collection at all - Security Rules
     * reject an unfiltered collection read, because rules filter documents but
     * cannot filter a query. So for supervisors we resolve membership first and
     * fetch only those projects by ID. Costs one extra query and keeps the
     * boundary honest.
     */
    async listForUser(uid: string, role: Role): Promise<Project[]> {
      if (role !== 'SUPERVISOR') {
        const snap = await getDocs(query(collection(db, 'projects'), orderBy('name')))
        return snap.docs.map((d) => toProject(d.id, d.data()))
      }

      const members = await getDocs(
        query(collection(db, 'projectMembers'), where('uid', '==', uid)),
      )
      const ids = members.docs.map((d) => d.data()['projectId'] as string)
      if (ids.length === 0) return []

      // `in` accepts at most 30 values per query, so chunk it.
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30))

      const results = await Promise.all(
        chunks.map((chunk) =>
          getDocs(query(collection(db, 'projects'), where(documentId(), 'in', chunk))),
        ),
      )
      return results
        .flatMap((snap) => snap.docs.map((d) => toProject(d.id, d.data())))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async get(id: string): Promise<Project | null> {
      const snap = await getDoc(doc(db, 'projects', id))
      return snap.exists() ? toProject(snap.id, snap.data()) : null
    },

    async getSummary(projectId: string): Promise<ProjectSummary | null> {
      const snap = await getDoc(doc(db, 'projects', projectId, 'summary', 'current'))
      if (!snap.exists()) return null
      const d = snap.data()
      return {
        ...(d as unknown as ProjectSummary),
        projectId,
        /*
         * The contract-derived trio is normalised at the boundary. A document
         * written before this field existed, or one a merge never touched,
         * comes back with it missing - and `undefined` reaching a formatter
         * renders "NaN", while `null` is a case every caller now handles
         * (R-01). This is the one place raw Firestore data becomes typed, so
         * it is the one place to make the guarantee.
         */
        contractValuePaise: nullablePaise(d['contractValuePaise']),
        unbilledBalancePaise: nullablePaise(d['unbilledBalancePaise']),
        contractRemainingPaise: nullablePaise(d['contractRemainingPaise']),
        computedAt: (d['computedAt'] as { toDate?: () => Date })?.toDate?.() ?? EPOCH,
      }
    },

    /**
     * Creates the project and its summary document in one batch. A project
     * without a summary would render as a broken card on every dashboard, so
     * the two are never allowed to exist separately.
     */
    async create(
      input: Omit<Project, 'id'>,
      actor: { uid: string; displayName: string },
      now: Date,
    ): Promise<string> {
      const ref = doc(collection(db, 'projects'))
      const batch = writeBatch(db)

      batch.set(ref, {
        ...defined({ ...input }),
        name: input.name,
        clientId: input.clientId,
        clientName: input.clientName,
        status: input.status,
        taxProfile: input.taxProfile,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })

      const summary = emptySummary(ref.id, input.contractValuePaise, actor.uid, now)
      batch.set(doc(db, 'projects', ref.id, 'summary', 'current'), {
        ...summary,
        computedAt: serverTimestamp(),
        schemaVersion: SUMMARY_SCHEMA_VERSION,
      })

      batch.set(doc(collection(db, 'auditLogs')), {
        userId: actor.uid,
        userName: actor.displayName,
        action: 'PROJECT_CREATED',
        entityType: 'project',
        entityId: ref.id,
        projectId: ref.id,
        // Firestore rejects undefined, and the audit trail should record
        // "no contract value" as a fact rather than as a missing field.
        after: { name: input.name, contractValuePaise: input.contractValuePaise ?? null },
        at: serverTimestamp(),
      })

      await batch.commit()
      return ref.id
    },

    async update(
      id: string,
      patch: Partial<Omit<Project, 'id' | 'clientId'>>,
      actorUid: string,
    ): Promise<void> {
      await updateDoc(doc(db, 'projects', id), {
        ...defined({ ...patch }),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    async listMembers(projectId: string): Promise<ProjectMember[]> {
      const snap = await getDocs(
        query(collection(db, 'projectMembers'), where('projectId', '==', projectId)),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProjectMember, 'id'>) }))
    },

    async addMember(
      projectId: string,
      member: { uid: string; displayName: string },
      actorUid: string,
    ): Promise<void> {
      // The ID must be projectId_uid - Security Rules enforce it, because
      // isMember() checks exactly this path.
      await setDoc(doc(db, 'projectMembers', `${projectId}_${member.uid}`), {
        projectId,
        uid: member.uid,
        displayName: member.displayName,
        addedBy: actorUid,
        addedAt: serverTimestamp(),
      })
    },

    async removeMember(projectId: string, uid: string): Promise<void> {
      const { deleteDoc } = await import('firebase/firestore')
      await deleteDoc(doc(db, 'projectMembers', `${projectId}_${uid}`))
    },
  }
}

export type ClientRepository = ReturnType<typeof createClientRepository>
export type ProjectRepository = ReturnType<typeof createProjectRepository>
