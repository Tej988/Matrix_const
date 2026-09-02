import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { Role, User, UserStatus } from '@mc/types'

/**
 * The users collection. Repositories are the only place Firestore is touched -
 * the business layer takes plain data and returns plain data
 * (ARCHITECTURE.md section 4).
 *
 * The Firestore instance is injected rather than imported, so this package
 * stays free of app configuration and a test can hand it an emulator handle.
 */

export interface UserRecord extends User {
  createdAt?: Date
  updatedAt?: Date
}

/**
 * `exactOptionalPropertyTypes` is on, so an optional field must be absent
 * rather than present-and-undefined. Spreading conditionally keeps the object
 * shape honest instead of papering over it with `| undefined`.
 */
function optional<T>(key: string, value: unknown): Record<string, T> | Record<string, never> {
  return value === undefined || value === null ? {} : { [key]: value as T }
}

function toUser(uid: string, data: Record<string, unknown>): UserRecord {
  return {
    uid,
    displayName: (data['displayName'] as string) ?? '',
    email: (data['email'] as string) ?? '',
    role: data['role'] as Role,
    status: data['status'] as UserStatus,
    locale: (data['locale'] as 'en' | 'hi') ?? 'en',
    ...optional<string>('photoUrl', data['photoUrl']),
    ...optional<string>('phone', data['phone']),
    ...optional<string>('driveFolderId', data['driveFolderId']),
  }
}

export function createUserRepository(db: Firestore) {
  return {
    /**
     * The authorisation gate. A signed-in account with no document here has no
     * access to anything - that default-deny posture is what makes an
     * accidental Google sign-in by a stranger harmless (SECURITY.md section 1).
     *
     * Returns null when the account exists in Auth but has not been provisioned.
     */
    async getProfile(uid: string): Promise<UserRecord | null> {
      const snap = await getDoc(doc(db, 'users', uid))
      return snap.exists() ? toUser(uid, snap.data()) : null
    },

    async list(): Promise<UserRecord[]> {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('displayName')))
      return snap.docs.map((d) => toUser(d.id, d.data()))
    },

    /** OWNER only, enforced by Rules as well as by the caller. */
    async create(
      uid: string,
      input: Pick<User, 'displayName' | 'email' | 'role'> & Partial<User>,
      actorUid: string,
    ): Promise<void> {
      await setDoc(doc(db, 'users', uid), {
        displayName: input.displayName,
        email: input.email,
        role: input.role,
        status: 'ACTIVE' satisfies UserStatus,
        locale: input.locale ?? 'en',
        ...(input.phone ? { phone: input.phone } : {}),
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    /**
     * A role or status change, paired with its audit entry in one batch so the
     * record of who changed what cannot go missing (spec section 19).
     */
    async setRoleAndStatus(
      uid: string,
      next: { role: Role; status: UserStatus },
      previous: { role: Role; status: UserStatus },
      actor: { uid: string; displayName: string },
    ): Promise<void> {
      const batch = writeBatch(db)

      batch.update(doc(db, 'users', uid), {
        role: next.role,
        status: next.status,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })

      batch.set(doc(collection(db, 'auditLogs')), {
        userId: actor.uid,
        userName: actor.displayName,
        action: 'USER_PERMISSIONS_CHANGED',
        entityType: 'user',
        entityId: uid,
        before: previous,
        after: next,
        at: serverTimestamp(),
      })

      await batch.commit()
    },

    /** The self-editable subset. Role and status are deliberately absent. */
    async updateOwnProfile(
      uid: string,
      patch: Partial<Pick<User, 'displayName' | 'phone' | 'locale' | 'photoUrl'>>,
    ): Promise<void> {
      await updateDoc(doc(db, 'users', uid), {
        ...patch,
        updatedAt: serverTimestamp(),
      })
    },
  }
}

export type UserRepository = ReturnType<typeof createUserRepository>
