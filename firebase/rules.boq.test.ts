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
 * BOQ rules. The load-bearing assertion here is that completedQty and billedQty
 * cannot be moved by editing the rate card - only the measurement-approval and
 * billing transactions may touch them. Without that, the section 4 overbilling
 * guard could be bypassed by editing a number in a form (R-13).
 */

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ACCOUNTANT = 'uid-accountant'
const SUP_A = 'uid-sup-a'
const SUP_B = 'uid-sup-b'

const PROJ_A = 'proj-tata'
const PROJ_B = 'proj-other'
const ITEM_A = 'boq-flooring'

const profile = (role: string) => ({
  displayName: 'T',
  email: 't@example.com',
  role,
  status: 'ACTIVE',
  locale: 'en',
})

const flooring = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ_A,
  code: 'FLO-01',
  name: 'Flooring',
  unit: 'SQFT',
  contractQty: 10000,
  ratePaise: 12000,
  contractAmountPaise: 120000000,
  completedQty: 0,
  billedQty: 0,
  sortOrder: 0,
  status: 'ACTIVE',
  ...over,
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-boq',
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
    await setDoc(doc(db, 'boqItems', ITEM_A), flooring({ completedQty: 2500, billedQty: 1000 }))
    await setDoc(doc(db, 'boqItems', 'boq-other'), flooring({ projectId: PROJ_B }))
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('reading the rate card', () => {
  it('lets a supervisor read items on their own project', async () => {
    await assertSucceeds(getDoc(doc(as(SUP_A), 'boqItems', ITEM_A)))
  })

  it('denies a supervisor items on other projects', async () => {
    await assertFails(getDoc(doc(as(SUP_A), 'boqItems', 'boq-other')))
    await assertFails(getDoc(doc(as(SUP_B), 'boqItems', ITEM_A)))
  })

  it('lets the office roles read any item', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT]) {
      await assertSucceeds(getDoc(doc(as(uid), 'boqItems', 'boq-other')))
    }
  })
})

describe('creating items', () => {
  it('lets an owner add a valid item', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'boqItems', 'b-new'), flooring()))
  })

  it('denies accountants and supervisors', async () => {
    for (const uid of [ACCOUNTANT, SUP_A]) {
      await assertFails(setDoc(doc(as(uid), 'boqItems', `b-${uid}`), flooring()))
    }
  })

  it('rejects a zero or negative contract quantity', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-z'), flooring({ contractQty: 0 })))
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-n'), flooring({ contractQty: -5 })))
  })

  it('rejects a rate that is not an integer count of paise', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-f'), flooring({ ratePaise: 120.5 })))
  })

  it('rejects an item created as already part-complete', async () => {
    // Progress must arrive through measurement approval, not at creation.
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-c'), flooring({ completedQty: 500 })))
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-b'), flooring({ billedQty: 500 })))
  })

  it('rejects an item with no name', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'boqItems', 'b-e'), flooring({ name: '' })))
  })
})

describe('editing items - the R-13 guard', () => {
  it('allows a rate or quantity correction', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'boqItems', ITEM_A), {
        ratePaise: 13000,
        contractAmountPaise: 130000000,
        contractQty: 10000,
      }),
    )
  })

  it('REFUSES to move completedQty through a rate-card edit', async () => {
    // Otherwise the section 4 overbilling rule could be bypassed by editing a
    // form field rather than approving a measurement.
    await assertFails(updateDoc(doc(as(OWNER), 'boqItems', ITEM_A), { completedQty: 9999 }))
  })

  it('REFUSES to move billedQty through a rate-card edit', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'boqItems', ITEM_A), { billedQty: 9999 }))
  })

  it('refuses to move an item to a different project', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'boqItems', ITEM_A), { projectId: PROJ_B }))
  })

  it('denies a supervisor editing the rate card of their own project', async () => {
    await assertFails(updateDoc(doc(as(SUP_A), 'boqItems', ITEM_A), { ratePaise: 1 }))
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'boqItems', ITEM_A)))
  })
})
