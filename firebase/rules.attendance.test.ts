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
 * Attendance and labour rules.
 *
 * The critical assertion: the document ID must equal
 * projectId_labourId_dateKey. That is what makes duplicate attendance
 * physically impossible rather than merely validated (ADR-006), and it must be
 * enforced server-side or a client could sidestep it by choosing its own ID.
 */

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ACCOUNTANT = 'uid-accountant'
const SUP_A = 'uid-sup-a'
const SUP_B = 'uid-sup-b'
const PROJ_A = 'proj-tata'
const PROJ_B = 'proj-other'
const LAB = 'lab-ramesh'
const DAY = '2026-08-27'

const profile = (role: string) => ({
  displayName: 'T',
  email: 't@x.com',
  role,
  status: 'ACTIVE',
  locale: 'en',
})

const record = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ_A,
  labourId: LAB,
  labourName: 'Ramesh',
  dateKey: DAY,
  status: 'PRESENT',
  dailyRatePaise: 70000,
  payableUnits: 1,
  markedBy: SUP_A,
  syncSource: 'ONLINE',
  ...over,
})

const goodId = `${PROJ_A}_${LAB}_${DAY}`

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-att',
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
    await setDoc(doc(db, 'labour', LAB), {
      name: 'Ramesh',
      role: 'MASON',
      defaultDailyWagePaise: 70000,
      status: 'ACTIVE',
    })
    await setDoc(doc(db, 'attendance', `${PROJ_A}_${LAB}_2026-08-20`), record({ dateKey: '2026-08-20' }))
    await setDoc(
      doc(db, 'attendance', `${PROJ_A}_${LAB}_2026-08-19`),
      record({ dateKey: '2026-08-19', wagePeriodId: 'wp-1' }),
    )
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('marking attendance', () => {
  it('lets a supervisor mark on their own project', async () => {
    await assertSucceeds(setDoc(doc(as(SUP_A), 'attendance', goodId), record()))
  })

  it('denies a supervisor on a project they are not on', async () => {
    await assertFails(
      setDoc(doc(as(SUP_B), 'attendance', goodId), record({ markedBy: SUP_B })),
    )
  })

  it('lets owner and admin mark anywhere', async () => {
    await assertSucceeds(
      setDoc(doc(as(OWNER), 'attendance', `${PROJ_B}_${LAB}_${DAY}`), record({
        projectId: PROJ_B,
        markedBy: OWNER,
      })),
    )
  })

  it('denies an accountant marking attendance', async () => {
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'attendance', goodId), record({ markedBy: ACCOUNTANT })),
    )
  })
})

/** ADR-006. Without this, duplicate prevention is a client-side suggestion. */
describe('the deterministic ID is enforced', () => {
  it('REFUSES an ID that does not match the record', async () => {
    await assertFails(setDoc(doc(as(SUP_A), 'attendance', 'anything-i-like'), record()))
  })

  it('refuses an ID with the wrong date', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'attendance', `${PROJ_A}_${LAB}_2026-01-01`), record()),
    )
  })

  it('refuses an ID with the wrong labourer', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'attendance', `${PROJ_A}_someone-else_${DAY}`), record()),
    )
  })

  it('means a repeat write is the SAME document, not a duplicate', async () => {
    // This is the offline-replay case: marking twice must be idempotent.
    await assertSucceeds(setDoc(doc(as(SUP_A), 'attendance', goodId), record()))
    await assertSucceeds(
      setDoc(doc(as(SUP_A), 'attendance', goodId), record({ status: 'HALF_DAY' })),
    )
  })
})

describe('validation', () => {
  it('rejects an unknown status', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'attendance', goodId), record({ status: 'MAYBE' })),
    )
  })

  it('rejects a float rate', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'attendance', goodId), record({ dailyRatePaise: 700.5 })),
    )
  })

  it('rejects a record attributed to someone else', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'attendance', goodId), record({ markedBy: OWNER })),
    )
  })
})

describe('editing', () => {
  const existing = `${PROJ_A}_${LAB}_2026-08-20`

  it('lets a supervisor correct a mistake on their project', async () => {
    await assertSucceeds(
      updateDoc(doc(as(SUP_A), 'attendance', existing), { status: 'HALF_DAY' }),
    )
  })

  it('refuses to move a record to another labourer or day', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'attendance', existing), { labourId: 'other' }))
    await assertFails(
      updateDoc(doc(as(OWNER), 'attendance', existing), { dateKey: '2026-08-21' }),
    )
    await assertFails(
      updateDoc(doc(as(OWNER), 'attendance', existing), { projectId: PROJ_B }),
    )
  })
})

describe('records inside a locked wage period are frozen', () => {
  const locked = `${PROJ_A}_${LAB}_2026-08-19`

  it('refuses to edit a record that has been paid against', async () => {
    // Changing it would silently restate a settled payment.
    await assertFails(updateDoc(doc(as(OWNER), 'attendance', locked), { status: 'ABSENT' }))
  })

  it('refuses to delete it, even as owner', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'attendance', locked)))
  })

  it('still allows deleting an unlocked record', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'attendance', `${PROJ_A}_${LAB}_2026-08-20`)))
  })
})

describe('labour roster', () => {
  it('lets any active user read the roster', async () => {
    await assertSucceeds(getDoc(doc(as(SUP_B), 'labour', LAB)))
  })

  it('denies a supervisor creating or editing labourers', async () => {
    await assertFails(
      setDoc(doc(as(SUP_A), 'labour', 'l-new'), {
        name: 'X',
        role: 'HELPER',
        defaultDailyWagePaise: 50000,
        status: 'ACTIVE',
      }),
    )
  })

  it('rejects a float wage', async () => {
    await assertFails(
      setDoc(doc(as(OWNER), 'labour', 'l-f'), {
        name: 'X',
        role: 'HELPER',
        defaultDailyWagePaise: 500.5,
        status: 'ACTIVE',
      }),
    )
  })

  it('never allows deleting a labourer', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'labour', LAB)))
  })
})

describe('assignments', () => {
  it('requires the composite ID', async () => {
    await assertFails(
      setDoc(doc(as(OWNER), 'labourAssignments', 'wrong'), {
        labourId: LAB,
        projectId: PROJ_A,
        dailyRatePaise: 70000,
        status: 'ACTIVE',
      }),
    )
  })

  it('accepts the correct ID', async () => {
    await assertSucceeds(
      setDoc(doc(as(OWNER), 'labourAssignments', `${PROJ_A}_${LAB}`), {
        labourId: LAB,
        projectId: PROJ_A,
        dailyRatePaise: 70000,
        status: 'ACTIVE',
      }),
    )
  })
})
