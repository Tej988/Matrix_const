import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'

/**
 * Measurement rules. The assertion that matters most: a SUPERVISOR can enter
 * and submit but can never approve. Without that, the review step is decorative
 * and a supervisor could sign their own work straight into a bill.
 */

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ACCOUNTANT = 'uid-accountant'
const SUP_A = 'uid-sup-a'
const SUP_B = 'uid-sup-b'
const PROJ_A = 'proj-tata'
const PROJ_B = 'proj-other'

const profile = (role: string) => ({
  displayName: 'T',
  email: 't@x.com',
  role,
  status: 'ACTIVE',
  locale: 'en',
})

const sheet = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ_A,
  period: '2026-08',
  date: '2026-08-27',
  title: 'August measurement',
  status: 'DRAFT',
  totalAmountPaise: 30000000,
  enteredBy: SUP_A,
  enteredByName: 'Ramesh',
  ...over,
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-meas',
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', OWNER), profile('OWNER'))
    await setDoc(doc(db, 'users', ADMIN), profile('ADMIN'))
    await setDoc(doc(db, 'users', ACCOUNTANT), profile('ACCOUNTANT'))
    await setDoc(doc(db, 'users', SUP_A), profile('SUPERVISOR'))
    await setDoc(doc(db, 'users', SUP_B), profile('SUPERVISOR'))
    await setDoc(doc(db, 'projectMembers', `${PROJ_A}_${SUP_A}`), {
      projectId: PROJ_A,
      uid: SUP_A,
      addedBy: OWNER,
    })
    await setDoc(doc(db, 'measurements', 'm-draft'), sheet())
    await setDoc(doc(db, 'measurements', 'm-submitted'), sheet({ status: 'SUBMITTED' }))
    await setDoc(doc(db, 'measurements', 'm-approved'), sheet({ status: 'APPROVED' }))
    await setDoc(doc(db, 'measurements', 'm-other'), sheet({ projectId: PROJ_B }))
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('entry', () => {
  it('lets a supervisor create a draft on their own project', async () => {
    await assertSucceeds(setDoc(doc(as(SUP_A), 'measurements', 'm-new'), sheet()))
  })

  it('denies a supervisor on a project they are not assigned to', async () => {
    await assertFails(
      setDoc(doc(as(SUP_B), 'measurements', 'm-new2'), sheet({ enteredBy: SUP_B })),
    )
  })

  it('refuses a measurement created as already approved', async () => {
    // Otherwise the entire review workflow could be skipped at creation.
    await assertFails(
      setDoc(doc(as(SUP_A), 'measurements', 'm-cheat'), sheet({ status: 'APPROVED' })),
    )
    await assertFails(
      setDoc(doc(as(OWNER), 'measurements', 'm-cheat2'), sheet({ status: 'APPROVED' })),
    )
  })

  it('refuses a sheet attributed to someone else', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'measurements', 'm-x'), sheet({ enteredBy: OWNER })),
    )
  })

  it('denies an accountant entering measurements', async () => {
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'measurements', 'm-a'), sheet({ enteredBy: ACCOUNTANT })),
    )
  })
})

describe('approval - the separation of duty', () => {
  it('lets an owner approve a submitted sheet', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'measurements', 'm-submitted'), { status: 'APPROVED' }),
    )
  })

  it('lets an admin approve', async () => {
    await assertSucceeds(
      updateDoc(doc(as(ADMIN), 'measurements', 'm-submitted'), { status: 'APPROVED' }),
    )
  })

  it('DENIES a supervisor approving, even on their own project', async () => {
    await assertFails(
      updateDoc(doc(as(SUP_A), 'measurements', 'm-submitted'), { status: 'APPROVED' }),
    )
  })

  it('denies an accountant approving', async () => {
    await assertFails(
      updateDoc(doc(as(ACCOUNTANT), 'measurements', 'm-submitted'), { status: 'APPROVED' }),
    )
  })

  it('refuses to approve a sheet that was never submitted', async () => {
    await assertFails(
      updateDoc(doc(as(OWNER), 'measurements', 'm-draft'), { status: 'APPROVED' }),
    )
  })

  it('treats approval as final - it cannot be reopened', async () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED']) {
      await assertFails(
        updateDoc(doc(as(OWNER), 'measurements', 'm-approved'), { status }),
      )
    }
  })
})

describe('submission', () => {
  it('lets a supervisor submit their own draft', async () => {
    await assertSucceeds(
      updateDoc(doc(as(SUP_A), 'measurements', 'm-draft'), { status: 'SUBMITTED' }),
    )
  })

  it('denies a supervisor from another project', async () => {
    await assertFails(
      updateDoc(doc(as(SUP_B), 'measurements', 'm-draft'), { status: 'SUBMITTED' }),
    )
  })
})

describe('deletion', () => {
  it('allows discarding a draft', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'measurements', 'm-draft')))
  })

  it('REFUSES to delete an approved sheet - a bill may reference it', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'measurements', 'm-approved')))
  })

  it('denies a supervisor deleting anything', async () => {
    await assertFails(deleteDoc(doc(as(SUP_A), 'measurements', 'm-draft')))
  })
})

describe('visibility', () => {
  it('lets a supervisor read their own project sheets', async () => {
    await assertSucceeds(getDoc(doc(as(SUP_A), 'measurements', 'm-draft')))
  })

  it('denies a supervisor other projects', async () => {
    await assertFails(getDoc(doc(as(SUP_A), 'measurements', 'm-other')))
  })
})
