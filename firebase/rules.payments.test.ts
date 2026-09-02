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
 * Rules for every money-moving collection.
 *
 * Common thread: amounts and project are immutable after creation, deletion is
 * denied everywhere, the ledger is append-only, and supervisors see none of it
 * (with one deliberate exception - they may record a site expense).
 */

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

const clientPayment = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ,
  clientId: 'client-stonede',
  amountPaise: 20000000,
  date: '2026-08-27',
  method: 'NEFT',
  source: 'MANUAL',
  status: 'CONFIRMED',
  idempotencyKey: 'cp_abc123',
  createdBy: ACCOUNTANT,
  ...over,
})

const labourPayment = (over: Record<string, unknown> = {}) => ({
  labourId: 'lab-ramesh',
  labourName: 'Ramesh',
  projectId: PROJ,
  amountPaise: 800000,
  date: '2026-08-27',
  method: 'PHONEPE',
  status: 'CONFIRMED',
  idempotencyKey: 'lp_xyz789',
  createdBy: ACCOUNTANT,
  ...over,
})

const expense = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ,
  category: 'TRANSPORT',
  amountPaise: 450000,
  date: '2026-08-27',
  description: 'Tempo hire',
  paymentMethod: 'CASH',
  status: 'RECORDED',
  createdBy: SUP,
  ...over,
})

const ledgerEntry = (over: Record<string, unknown> = {}) => ({
  projectId: PROJ,
  type: 'CLIENT_PAYMENT',
  direction: 'IN',
  amountPaise: 20000000,
  date: '2026-08-27',
  refType: 'clientPayment',
  refId: 'cp-1',
  description: 'Received',
  status: 'ACTIVE',
  createdBy: ACCOUNTANT,
  ...over,
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-pay',
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
    await setDoc(doc(db, 'clientPayments', 'cp-1'), clientPayment())
    await setDoc(doc(db, 'labourPayments', 'lp-1'), labourPayment())
    await setDoc(doc(db, 'expenses', 'e-1'), expense())
    await setDoc(doc(db, 'transactions', 't-1'), ledgerEntry())
    await setDoc(doc(db, 'wagePeriods', 'wp-locked'), {
      projectId: PROJ,
      labourId: 'lab-ramesh',
      labourName: 'Ramesh',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      earnedAmountPaise: 1680000,
      payableDays: 24,
      status: 'LOCKED',
    })
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('supervisors see no money', () => {
  it.each([
    ['clientPayments', 'cp-1'],
    ['labourPayments', 'lp-1'],
    ['expenses', 'e-1'],
    ['transactions', 't-1'],
    ['wagePeriods', 'wp-locked'],
  ])('denies reading %s', async (col, id) => {
    await assertFails(getDoc(doc(as(SUP), col, id)))
  })
})

describe('client payments', () => {
  it('lets an accountant record one', async () => {
    await assertSucceeds(
      setDoc(doc(as(ACCOUNTANT), 'clientPayments', 'cp-2'), clientPayment({ idempotencyKey: 'k2' })),
    )
  })

  it('requires an idempotency key - critical test 10', async () => {
    // Without it a retry becomes a second payment.
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'clientPayments', 'cp-3'), clientPayment({ idempotencyKey: '' })),
    )
  })

  it('rejects a zero, negative or float amount', async () => {
    for (const amountPaise of [0, -100, 100.5]) {
      await assertFails(
        setDoc(doc(as(ACCOUNTANT), 'clientPayments', `cp-${amountPaise}`), clientPayment({ amountPaise })),
      )
    }
  })

  it('refuses to change the amount after the fact', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'clientPayments', 'cp-1'), { amountPaise: 1 }))
  })

  it('refuses to change the idempotency key', async () => {
    await assertFails(
      updateDoc(doc(as(OWNER), 'clientPayments', 'cp-1'), { idempotencyKey: 'different' }),
    )
  })

  it('allows a status change, so a payment can be reversed', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'clientPayments', 'cp-1'), { status: 'REVERSED' }),
    )
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'clientPayments', 'cp-1')))
  })

  it('denies a viewer and a supervisor creating one', async () => {
    for (const uid of [VIEWER, SUP]) {
      await assertFails(
        setDoc(doc(as(uid), 'clientPayments', `cp-${uid}`), clientPayment({ createdBy: uid })),
      )
    }
  })
})

describe('labour payments', () => {
  it('lets an accountant record one', async () => {
    await assertSucceeds(
      setDoc(doc(as(ACCOUNTANT), 'labourPayments', 'lp-2'), labourPayment({ idempotencyKey: 'k3' })),
    )
  })

  it('refuses to reassign a payment to a different labourer', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'labourPayments', 'lp-1'), { labourId: 'other' }))
  })

  it('refuses to change the amount', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'labourPayments', 'lp-1'), { amountPaise: 1 }))
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'labourPayments', 'lp-1')))
  })
})

describe('expenses - the one money write a supervisor may make', () => {
  it('lets a supervisor record a site expense on their own project', async () => {
    await assertSucceeds(setDoc(doc(as(SUP), 'expenses', 'e-2'), expense()))
  })

  it('still denies them READING the expense ledger', async () => {
    // Record a tempo hire, yes. See the project's finances, no.
    await assertFails(getDoc(doc(as(SUP), 'expenses', 'e-1')))
  })

  it('rejects an expense with no description', async () => {
    await assertFails(setDoc(doc(as(SUP), 'expenses', 'e-3'), expense({ description: '' })))
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'expenses', 'e-1')))
  })
})

describe('the ledger is append-only - section 18', () => {
  it('lets the money roles append', async () => {
    await assertSucceeds(setDoc(doc(as(ACCOUNTANT), 'transactions', 't-2'), ledgerEntry()))
  })

  it('refuses any edit, even by the owner', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'transactions', 't-1'), { amountPaise: 1 }))
    await assertFails(updateDoc(doc(as(OWNER), 'transactions', 't-1'), { status: 'REVERSED' }))
  })

  it('refuses deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'transactions', 't-1')))
  })

  it('refuses an entry attributed to someone else', async () => {
    await assertFails(
      setDoc(doc(as(ACCOUNTANT), 'transactions', 't-3'), ledgerEntry({ createdBy: OWNER })),
    )
  })
})

describe('wage periods', () => {
  it('refuses to edit a locked period', async () => {
    // It has been paid against; changing it would restate a settled payment.
    await assertFails(
      updateDoc(doc(as(OWNER), 'wagePeriods', 'wp-locked'), { earnedAmountPaise: 1 }),
    )
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'wagePeriods', 'wp-locked')))
  })

  it('denies a supervisor creating one', async () => {
    await assertFails(
      setDoc(doc(as(SUP), 'wagePeriods', 'wp-2'), {
        projectId: PROJ,
        earnedAmountPaise: 100,
        status: 'DRAFT',
      }),
    )
  })
})
