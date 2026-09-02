import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from 'firebase/firestore'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'

/**
 * Rules for clients, projects, project membership and the summary document.
 *
 * The theme running through these: a SUPERVISOR sees only their own projects,
 * and never sees money anywhere.
 */

let testEnv: RulesTestEnvironment

const OWNER = 'uid-owner'
const ADMIN = 'uid-admin'
const ACCOUNTANT = 'uid-accountant'
const SUP_A = 'uid-sup-a' // member of project A only
const SUP_B = 'uid-sup-b' // member of nothing
const VIEWER = 'uid-viewer'

const PROJ_A = 'proj-tata'
const PROJ_B = 'proj-other'

const profile = (role: string) => ({
  displayName: 'T',
  email: 't@example.com',
  role,
  status: 'ACTIVE',
  locale: 'en',
})

const projectDoc = (clientId = 'client-stonede') => ({
  name: 'Tata Project Limited - Agra',
  code: 'TPL-AGR',
  clientId,
  clientName: 'Stonede',
  contractValuePaise: 185000000,
  startDate: '2026-04-01',
  status: 'ACTIVE',
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-matrix-projects',
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
    await setDoc(doc(db, 'users', VIEWER), profile('VIEWER'))

    await setDoc(doc(db, 'clients', 'client-stonede'), { name: 'Stonede', status: 'ACTIVE' })
    await setDoc(doc(db, 'projects', PROJ_A), projectDoc())
    await setDoc(doc(db, 'projects', PROJ_B), projectDoc())
    await setDoc(doc(db, 'projects', PROJ_A, 'summary', 'current'), {
      contractValuePaise: 185000000,
      totalBilledPaise: 100000000,
      receivablePaise: 0,
    })

    // SUP_A is assigned to project A only.
    await setDoc(doc(db, 'projectMembers', `${PROJ_A}_${SUP_A}`), {
      projectId: PROJ_A,
      uid: SUP_A,
      displayName: 'Ramesh',
      addedBy: OWNER,
    })
  })
})

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore()

describe('clients', () => {
  it('lets any active user read a client, including a supervisor', async () => {
    await assertSucceeds(getDoc(doc(as(SUP_B), 'clients', 'client-stonede')))
  })

  it('lets an owner and admin write clients', async () => {
    await assertSucceeds(
      setDoc(doc(as(OWNER), 'clients', 'c-new'), { name: 'New Client', status: 'ACTIVE' }),
    )
    await assertSucceeds(
      setDoc(doc(as(ADMIN), 'clients', 'c-new2'), { name: 'Another', status: 'ACTIVE' }),
    )
  })

  it('denies an accountant, supervisor and viewer writing clients', async () => {
    for (const uid of [ACCOUNTANT, SUP_A, VIEWER]) {
      await assertFails(
        setDoc(doc(as(uid), 'clients', `c-${uid}`), { name: 'X', status: 'ACTIVE' }),
      )
    }
  })

  it('rejects a client with no name or a bad status', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'clients', 'c-x'), { name: '', status: 'ACTIVE' }))
    await assertFails(setDoc(doc(as(OWNER), 'clients', 'c-y'), { name: 'X', status: 'DELETED' }))
  })

  it('never allows deletion - deactivate instead', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'clients', 'client-stonede')))
  })
})

describe('project visibility - the supervisor boundary', () => {
  it('lets a supervisor read a project they are assigned to', async () => {
    await assertSucceeds(getDoc(doc(as(SUP_A), 'projects', PROJ_A)))
  })

  it('denies a supervisor a project they are NOT assigned to', async () => {
    await assertFails(getDoc(doc(as(SUP_A), 'projects', PROJ_B)))
  })

  it('denies a supervisor with no assignments any project at all', async () => {
    await assertFails(getDoc(doc(as(SUP_B), 'projects', PROJ_A)))
    await assertFails(getDoc(doc(as(SUP_B), 'projects', PROJ_B)))
  })

  it('lets every non-supervisor role read any project', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT, VIEWER]) {
      await assertSucceeds(getDoc(doc(as(uid), 'projects', PROJ_B)))
    }
  })
})

describe('project writes', () => {
  it('lets an owner create a valid project', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'projects', 'p-new'), projectDoc()))
  })

  it('rejects a contract value that is not an integer count of paise', async () => {
    // Rupees-as-float is the mistake ADR-004 exists to prevent.
    await assertFails(
      setDoc(doc(as(OWNER), 'projects', 'p-f'), {
        ...projectDoc(),
        contractValuePaise: 1850000.5,
      }),
    )
    await assertFails(
      setDoc(doc(as(OWNER), 'projects', 'p-neg'), {
        ...projectDoc(),
        contractValuePaise: -100,
      }),
    )
  })

  it('rejects an unknown status', async () => {
    await assertFails(
      setDoc(doc(as(OWNER), 'projects', 'p-s'), { ...projectDoc(), status: 'FINISHED' }),
    )
  })

  it('denies accountants, supervisors and viewers creating projects', async () => {
    for (const uid of [ACCOUNTANT, SUP_A, VIEWER]) {
      await assertFails(setDoc(doc(as(uid), 'projects', `p-${uid}`), projectDoc()))
    }
  })

  it('refuses to move a project to a different client', async () => {
    // Bills already reference the client; repointing would rewrite history.
    await assertFails(updateDoc(doc(as(OWNER), 'projects', PROJ_A), { clientId: 'client-other' }))
  })

  it('allows other project edits', async () => {
    await assertSucceeds(
      updateDoc(doc(as(OWNER), 'projects', PROJ_A), {
        status: 'ON_HOLD',
        contractValuePaise: 190000000,
      }),
    )
  })

  it('never allows deletion', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'projects', PROJ_A)))
  })
})

describe('the summary document - where all the money is', () => {
  const summaryRef = (uid: string) => doc(as(uid), 'projects', PROJ_A, 'summary', 'current')

  it('denies a supervisor even on their OWN project', async () => {
    // SUP_A can read the project, but not its financial position.
    await assertSucceeds(getDoc(doc(as(SUP_A), 'projects', PROJ_A)))
    await assertFails(getDoc(summaryRef(SUP_A)))
  })

  it('lets owner, admin, accountant and viewer read it', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT, VIEWER]) {
      await assertSucceeds(getDoc(summaryRef(uid)))
    }
  })

  it('lets the money roles write it', async () => {
    for (const uid of [OWNER, ADMIN, ACCOUNTANT]) {
      await assertSucceeds(setDoc(summaryRef(uid), { totalBilledPaise: 1 }))
    }
  })

  it('denies a viewer and a supervisor writing it', async () => {
    for (const uid of [VIEWER, SUP_A]) {
      await assertFails(setDoc(summaryRef(uid), { totalBilledPaise: 999 }))
    }
  })
})

describe('project membership', () => {
  it('lets an owner assign a supervisor', async () => {
    await assertSucceeds(
      setDoc(doc(as(OWNER), 'projectMembers', `${PROJ_B}_${SUP_B}`), {
        projectId: PROJ_B,
        uid: SUP_B,
        displayName: 'Suresh',
        addedBy: OWNER,
      }),
    )
  })

  it('rejects a membership whose ID does not match its fields', async () => {
    // A mismatched ID would make isMember() look up a document that is not
    // there - the membership would appear saved but grant nothing.
    await assertFails(
      setDoc(doc(as(OWNER), 'projectMembers', 'wrong-id'), {
        projectId: PROJ_B,
        uid: SUP_B,
        addedBy: OWNER,
      }),
    )
  })

  it('denies a supervisor assigning themselves to a project', async () => {
    await assertFails(
      setDoc(doc(as(SUP_B), 'projectMembers', `${PROJ_A}_${SUP_B}`), {
        projectId: PROJ_A,
        uid: SUP_B,
        addedBy: SUP_B,
      }),
    )
  })

  it('lets an owner remove someone - the one delete the system permits', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'projectMembers', `${PROJ_A}_${SUP_A}`)))
  })
})

describe('list queries respect the same boundaries', () => {
  it('lets an owner list all projects', async () => {
    await assertSucceeds(getDocs(collection(as(OWNER), 'projects')))
  })

  it('denies a supervisor listing all projects', async () => {
    // Rules cannot filter a collection read, so an unbounded list must fail
    // outright. Supervisors reach projects through projectMembers instead.
    await assertFails(getDocs(collection(as(SUP_A), 'projects')))
  })
})
