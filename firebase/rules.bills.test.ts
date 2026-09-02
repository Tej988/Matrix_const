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

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ACCOUNTANT = 'uid-accountant'
const SUP = 'uid-sup'
const VIEWER = 'uid-viewer'
const PROJ = 'proj-tata'

const profile = (role: string) => ({
  displayName: 'T',
  email: 't@x.com',
  role,
  status: 'ACTIVE',
  locale: 'en',
})

const bill = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ,
  projectName: 'Tata Project Limited - Agra',
  clientId: 'client-stonede',
  clientName: 'Stonede',
  billNumber: 'MC/26-27/0001',
  billDate: '2026-08-27',
  periodFrom: '2026-08-01',
  periodTo: '2026-08-31',
  measurementIds: ['m1'],
  subtotalPaise: 30000000,
  netAmountPaise: 30000000,
  amountReceivedPaise: 0,
  status: 'GENERATED',
  ...over,
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-bills',
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
    await setDoc(doc(db, 'users', SUP), profile('SUPERVISOR'))
    await setDoc(doc(db, 'users', VIEWER), profile('VIEWER'))
    await setDoc(doc(db, 'projectMembers', `${PROJ}_${SUP}`), {
      projectId: PROJ,
      uid: SUP,
      addedBy: OWNER,
    })
    await setDoc(doc(db, 'bills', 'bill-1'), bill())
    await setDoc(doc(db, 'bills', 'bill-1', 'items', 'i1'), {
      boqItemId: 'boq-flo',
      name: 'Flooring',
      unit: 'SQFT',
      ratePaise: 12000,
      quantity: 2500,
      amountPaise: 30000000,
    })
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('supervisors never see bills', () => {
  it('denies reading a bill even on their own project', async () => {
    await assertFails(getDoc(doc(as(SUP), 'bills', 'bill-1')))
  })

  it('denies reading bill line items', async () => {
    await assertFails(getDoc(doc(as(SUP), 'bills', 'bill-1', 'items', 'i1')))
  })

  it('lets the money roles read', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT, VIEWER]) {
      await assertSucceeds(getDoc(doc(as(uid), 'bills', 'bill-1')))
    }
  })
})

describe('generating', () => {
  it('lets an accountant generate a bill', async () => {
    await assertSucceeds(setDoc(doc(as(ACCOUNTANT), 'bills', 'b-new'), bill()))
  })

  it('refuses a bill created as already paid', async () => {
    // Payment status is derived from the ledger, never asserted at creation.
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'bills', 'b-x'), bill({ amountReceivedPaise: 30000000 })),
    )
    await assertFails(setDoc(doc(as(ACCOUNTANT), 'bills', 'b-y'), bill({ status: 'PAID' })))
  })

  it('refuses a float amount', async () => {
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'bills', 'b-f'), bill({ netAmountPaise: 300000.5 })),
    )
  })

  it('refuses a bill with no number', async () => {
    await assertFails(setDoc(doc(as(ACCOUNTANT), 'bills', 'b-n'), bill({ billNumber: '' })))
  })

  it('denies supervisors and viewers', async () => {
    for (const uid of [SUP, VIEWER]) {
      await assertFails(setDoc(doc(as(uid), 'bills', `b-${uid}`), bill()))
    }
  })
})

describe('immutability of issued amounts', () => {
  it('refuses to change the bill number', async () => {
    await assertFails(
      updateDoc(doc(as(OWNER), 'bills', 'bill-1'), { billNumber: 'MC/26-27/9999' }),
    )
  })

  it('refuses to change the net amount', async () => {
    // Correcting a bill means cancelling and reissuing, not editing.
    await assertFails(updateDoc(doc(as(OWNER), 'bills', 'bill-1'), { netAmountPaise: 1 }))
    await assertFails(updateDoc(doc(as(OWNER), 'bills', 'bill-1'), { subtotalPaise: 1 }))
  })

  it('refuses to move a bill to another project', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'bills', 'bill-1'), { projectId: 'other' }))
  })

  it('allows marking it sent', async () => {
    await assertSucceeds(updateDoc(doc(as(ACCOUNTANT), 'bills', 'bill-1'), { status: 'SENT' }))
  })
})

describe('cancellation', () => {
  it('lets an owner cancel', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'bills', 'bill-1'), {
        status: 'CANCELLED',
        cancellationReason: 'Wrong period',
      }),
    )
  })

  it('denies an accountant cancelling', async () => {
    await assertFails(
      updateDoc(doc(as(ACCOUNTANT), 'bills', 'bill-1'), { status: 'CANCELLED' }),
    )
  })

  it('never resurrects a cancelled bill', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'bills', 'bill-c'), bill({ status: 'CANCELLED' }))
    })
    await assertFails(updateDoc(doc(as(OWNER), 'bills', 'bill-c'), { status: 'GENERATED' }))
  })

  it('never allows deletion, by anyone', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT]) {
      await assertFails(deleteDoc(doc(as(uid), 'bills', 'bill-1')))
    }
  })
})

describe('bill line items are frozen', () => {
  it('refuses to edit a line after generation', async () => {
    await assertFails(
      updateDoc(doc(as(OWNER), 'bills', 'bill-1', 'items', 'i1'), { ratePaise: 99999 }),
    )
  })

  it('refuses to delete a line', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'bills', 'bill-1', 'items', 'i1')))
  })
})

describe('bill number counters', () => {
  it('lets the money roles increment', async () => {
    await assertSucceeds(
      setDoc(doc(as(ACCOUNTANT), 'counters', 'billNumber_26-27'), { current: 1 }),
    )
  })

  it('denies a supervisor touching the counter', async () => {
    await assertFails(
      setDoc(doc(as(SUP), 'counters', 'billNumber_26-27'), { current: 999 }),
    )
  })
})
