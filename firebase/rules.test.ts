import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'

/**
 * Security Rules tests.
 *
 * There is no server in this architecture (ADR-002), so these rules are the
 * ENTIRE enforcement boundary. That makes this file the highest-value test
 * suite in the repository, and it is why the denial assertions matter more
 * than the permission ones: proving ADMIN can write is half the job, proving
 * SUPERVISOR cannot is the half that catches real bugs.
 *
 * Requires the Firestore emulator. Run via `npm run test:rules`.
 */

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const SUPERVISOR = 'uid-supervisor'
const DISABLED = 'uid-disabled'
const STRANGER = 'uid-stranger'

function profile(role: string, status = 'ACTIVE') {
  return { displayName: 'Test User', email: 't@example.com', role, status, locale: 'en' }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-rules',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // Seed the user directory with rules bypassed - this is the Firebase Console
  // standing in, which is exactly how the first OWNER is created in reality
  // (SECURITY.md section 4).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', OWNER), profile('OWNER'))
    await setDoc(doc(db, 'users', ADMIN), profile('ADMIN'))
    await setDoc(doc(db, 'users', SUPERVISOR), profile('SUPERVISOR'))
    await setDoc(doc(db, 'users', DISABLED), profile('ADMIN', 'DISABLED'))
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

describe('default deny', () => {
  it('blocks an unauthenticated read', async () => {
    await assertFails(getDoc(doc(anon(), 'users', OWNER)))
  })

  it('blocks a signed-in account that has no user document', async () => {
    // The stranger case: a valid Google sign-in that nobody has provisioned.
    // It must be able to read nothing (SECURITY.md section 1).
    await assertFails(getDoc(doc(as(STRANGER), 'settings', 'app')))
  })

  it('blocks collections that no phase has opened yet', async () => {
    // Update this list as phases land. It exists to prove the catch-all deny
    // still holds for anything not explicitly opened - so a collection is never
    // reachable by accident before its rules and tests are written.
    await assertFails(setDoc(doc(as(OWNER), 'notifications', 'n1'), { title: 'x' }))
    await assertFails(getDoc(doc(as(OWNER), 'somethingUnplanned', 'x1')))
  })
})

describe('self-promotion - the guard the whole model rests on', () => {
  it('denies a supervisor promoting themselves to OWNER', async () => {
    await assertFails(updateDoc(doc(as(SUPERVISOR), 'users', SUPERVISOR), { role: 'OWNER' }))
  })

  it('denies an admin promoting themselves to OWNER', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), 'users', ADMIN), { role: 'OWNER' }))
  })

  it('denies a user re-enabling their own disabled account', async () => {
    await assertFails(updateDoc(doc(as(DISABLED), 'users', DISABLED), { status: 'ACTIVE' }))
  })

  it('denies smuggling a role change inside a profile edit', async () => {
    await assertFails(
      updateDoc(doc(as(SUPERVISOR), 'users', SUPERVISOR), {
        displayName: 'Renamed',
        role: 'ACCOUNTANT',
      }),
    )
  })

  it('allows an ordinary profile edit', async () => {
    await assertSucceeds(
      updateDoc(doc(as(SUPERVISOR), 'users', SUPERVISOR), {
        displayName: 'Ramesh Kumar',
        locale: 'hi',
      }),
    )
  })

  it('denies editing fields outside the self-editable set', async () => {
    await assertFails(updateDoc(doc(as(SUPERVISOR), 'users', SUPERVISOR), { email: 'x@y.com' }))
  })
})

describe('user administration', () => {
  it('lets an owner create a user', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'users', 'uid-new'), profile('SUPERVISOR')))
  })

  it('denies an admin creating a user', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'users', 'uid-new'), profile('SUPERVISOR')))
  })

  it('denies a disabled user acting at all, whatever their role says', async () => {
    await assertFails(setDoc(doc(as(DISABLED), 'users', 'uid-new'), profile('VIEWER')))
  })

  it('rejects an invalid role value', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'users', 'uid-new'), profile('SUPERADMIN')))
  })

  it('lets an owner change another user role', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), 'users', SUPERVISOR), { role: 'ACCOUNTANT' }))
  })

  it('lets an owner disable someone else', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), 'users', ADMIN), { status: 'DISABLED' }))
  })
})

describe('owner lockout guard', () => {
  it('denies an owner demoting themselves', async () => {
    // Unrecoverable on a sole-owner account: no server exists to undo it.
    await assertFails(updateDoc(doc(as(OWNER), 'users', OWNER), { role: 'VIEWER' }))
  })

  it('denies an owner disabling themselves', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'users', OWNER), { status: 'DISABLED' }))
  })

  it('still lets an owner edit their own profile', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'users', OWNER), { displayName: 'Papa', locale: 'hi' }),
    )
  })

  it('lets a second owner demote the first', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'uid-owner-2'), profile('OWNER'))
    })
    await assertSucceeds(updateDoc(doc(as('uid-owner-2'), 'users', OWNER), { role: 'ADMIN' }))
  })
})

/**
 * setRoleAndStatus writes the user document and its audit entry in one batch.
 * Both must pass rules or the whole batch fails - which is the point: a
 * permission change cannot land without its audit record.
 */
describe('role change writes its audit entry atomically', () => {
  it('accepts the batch an owner actually sends', async () => {
    const db = as(OWNER)
    const batch = writeBatch(db)
    batch.update(doc(db, 'users', SUPERVISOR), { role: 'ACCOUNTANT', status: 'ACTIVE' })
    batch.set(doc(collection(db, 'auditLogs'), 'log-role-1'), {
      userId: OWNER,
      userName: 'Owner',
      action: 'USER_PERMISSIONS_CHANGED',
      entityType: 'user',
      entityId: SUPERVISOR,
      before: { role: 'SUPERVISOR', status: 'ACTIVE' },
      after: { role: 'ACCOUNTANT', status: 'ACTIVE' },
    })
    await assertSucceeds(batch.commit())
  })

  it('rejects the whole batch when the audit entry is forged', async () => {
    const db = as(OWNER)
    const batch = writeBatch(db)
    batch.update(doc(db, 'users', SUPERVISOR), { role: 'ACCOUNTANT', status: 'ACTIVE' })
    batch.set(doc(collection(db, 'auditLogs'), 'log-role-2'), {
      userId: ADMIN, // not the acting user
      action: 'USER_PERMISSIONS_CHANGED',
      entityType: 'user',
      entityId: SUPERVISOR,
    })
    await assertFails(batch.commit())
  })
})

describe('audit log is append-only - ADR-007', () => {
  const entry = (uid: string) => ({
    userId: uid,
    action: 'TEST',
    entityType: 'user',
    entityId: 'x',
  })

  it('allows an active user to append', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), 'auditLogs', 'log-1'), entry(ADMIN)))
  })

  it('denies appending an entry attributed to someone else', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'auditLogs', 'log-2'), entry(OWNER)))
  })

  it('denies rewriting history, even to the owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditLogs', 'log-3'), entry(ADMIN))
    })
    await assertFails(updateDoc(doc(as(OWNER), 'auditLogs', 'log-3'), { action: 'CHANGED' }))
    await assertFails(deleteDoc(doc(as(OWNER), 'auditLogs', 'log-3')))
  })

  it('denies a supervisor reading the audit log', async () => {
    await assertFails(getDoc(doc(as(SUPERVISOR), 'auditLogs', 'log-1')))
  })
})

describe('settings', () => {
  it('lets any active user read settings', async () => {
    await assertSucceeds(getDoc(doc(as(SUPERVISOR), 'settings', 'app')))
  })

  it('denies a non-owner writing settings', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'settings', 'app'), { businessName: 'X' }))
  })

  it('lets an owner write settings', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'settings', 'app'), { businessName: 'Matrix' }))
  })
})
