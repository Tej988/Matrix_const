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
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type {
  Attendance,
  AttendanceStatus,
  DateKey,
  Labour,
  LabourAssignment,
  LabourRole,
  Paise,
  WageRules,
} from '@mc/types'
import { attendanceId, DEFAULT_WAGE_RULES } from '@mc/types'
import { payableUnitsFor } from '../business/wageCalculator'
import { now } from '../datetime/index'

function toLabour(id: string, d: Record<string, unknown>): Labour {
  return {
    id,
    name: (d['name'] as string) ?? '',
    role: (d['role'] as LabourRole) ?? 'OTHER',
    defaultDailyWagePaise: (d['defaultDailyWagePaise'] as Paise) ?? (0 as Paise),
    status: (d['status'] as Labour['status']) ?? 'ACTIVE',
    ...(d['phone'] ? { phone: d['phone'] as string } : {}),
    ...(d['skillLevel'] ? { skillLevel: d['skillLevel'] as string } : {}),
    ...(d['joiningDate'] ? { joiningDate: d['joiningDate'] as DateKey } : {}),
    ...(d['notes'] ? { notes: d['notes'] as string } : {}),
  }
}

function toAttendance(id: string, d: Record<string, unknown>): Attendance {
  return {
    id,
    projectId: d['projectId'] as string,
    labourId: d['labourId'] as string,
    labourName: (d['labourName'] as string) ?? '',
    dateKey: d['dateKey'] as DateKey,
    status: (d['status'] as AttendanceStatus) ?? 'PRESENT',
    dailyRatePaise: (d['dailyRatePaise'] as Paise) ?? (0 as Paise),
    payableUnits: (d['payableUnits'] as number) ?? 0,
    markedBy: (d['markedBy'] as string) ?? '',
    syncSource: (d['syncSource'] as Attendance['syncSource']) ?? 'ONLINE',
    ...(d['hours'] !== undefined ? { hours: d['hours'] as number } : {}),
    ...(d['editReason'] ? { editReason: d['editReason'] as string } : {}),
    ...(d['wagePeriodId'] ? { wagePeriodId: d['wagePeriodId'] as string } : {}),
  }
}

export function createLabourRepository(db: Firestore) {
  return {
    async list(): Promise<Labour[]> {
      const snap = await getDocs(query(collection(db, 'labour'), orderBy('name')))
      return snap.docs.map((d) => toLabour(d.id, d.data()))
    },

    async get(id: string): Promise<Labour | null> {
      const snap = await getDoc(doc(db, 'labour', id))
      return snap.exists() ? toLabour(snap.id, snap.data()) : null
    },

    async create(input: Omit<Labour, 'id'>, actorUid: string): Promise<string> {
      const ref = doc(collection(db, 'labour'))
      await setDoc(ref, {
        name: input.name,
        role: input.role,
        defaultDailyWagePaise: input.defaultDailyWagePaise,
        status: input.status,
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.joiningDate ? { joiningDate: input.joiningDate } : {}),
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
      return ref.id
    },

    async update(id: string, patch: Partial<Omit<Labour, 'id'>>, actorUid: string) {
      await updateDoc(doc(db, 'labour', id), {
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    /**
     * "No longer working with us." The only kind of removal there is.
     *
     * Rules deny `delete` on labour outright and that is not an oversight:
     * attendance rows and wage payments point at this record, and a payment
     * whose payee has evaporated is not an auditable payment (ADR-007). So the
     * record stays and the status flips.
     *
     * Ending the open assignments is the other half of the job, not a bonus.
     * The roster the attendance screen marks against is built from ACTIVE
     * assignments, never from the labour list, so a status flip on its own
     * would leave someone who left the site still being ticked present every
     * morning. Past assignments are left alone - they are what last month's
     * register and wages hang off.
     */
    async deactivate(labourId: string, endDate: DateKey, actorUid: string): Promise<void> {
      // One equality filter, then filtered in memory: a second `where` would
      // want a composite index for what is a handful of rows per person.
      const snap = await getDocs(
        query(collection(db, 'labourAssignments'), where('labourId', '==', labourId)),
      )

      const batch = writeBatch(db)

      batch.update(doc(db, 'labour', labourId), {
        status: 'INACTIVE',
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })

      for (const assignment of snap.docs) {
        if (assignment.data()['status'] !== 'ACTIVE') continue
        batch.update(assignment.ref, {
          status: 'ENDED',
          endDate,
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        })
      }

      await batch.commit()
    },

    /**
     * Back on the books.
     *
     * Assignments are deliberately NOT restored. Which site and at what rate
     * are decisions to take again; replaying the old ones would put someone on
     * a project that finished while they were away, at a rate nobody agreed.
     */
    async reactivate(labourId: string, actorUid: string): Promise<void> {
      await updateDoc(doc(db, 'labour', labourId), {
        status: 'ACTIVE',
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    // ---- assignments (section 11) ----

    async assignmentsForProject(projectId: string): Promise<LabourAssignment[]> {
      const snap = await getDocs(
        query(
          collection(db, 'labourAssignments'),
          where('projectId', '==', projectId),
          where('status', '==', 'ACTIVE'),
        ),
      )
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<LabourAssignment, 'id'>),
      }))
    },

    /**
     * Every project one person has been on, ended assignments included.
     *
     * A single equality filter, so Firestore's automatic single-field index
     * serves it with no composite index to deploy. ENDED rows come back on
     * purpose: the person page is a history, and the site somebody left last
     * month is where last month's register and wages live.
     */
    async assignmentsForLabour(labourId: string): Promise<LabourAssignment[]> {
      const snap = await getDocs(
        query(collection(db, 'labourAssignments'), where('labourId', '==', labourId)),
      )
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<LabourAssignment, 'id'>),
      }))
    },

    async assign(
      input: {
        labour: Labour
        projectId: string
        startDate: DateKey
        dailyRatePaise: Paise
      },
      actorUid: string,
    ): Promise<void> {
      // Deterministic so re-assigning the same person to the same project
      // updates rather than duplicating the roster entry.
      await setDoc(doc(db, 'labourAssignments', `${input.projectId}_${input.labour.id}`), {
        labourId: input.labour.id,
        labourName: input.labour.name,
        projectId: input.projectId,
        startDate: input.startDate,
        dailyRatePaise: input.dailyRatePaise,
        status: 'ACTIVE',
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },

    async endAssignment(projectId: string, labourId: string, endDate: DateKey, actorUid: string) {
      await updateDoc(doc(db, 'labourAssignments', `${projectId}_${labourId}`), {
        status: 'ENDED',
        endDate,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    },
  }
}

export function createAttendanceRepository(db: Firestore) {
  return {
    async forProjectAndDate(projectId: string, dateKey: DateKey): Promise<Attendance[]> {
      const snap = await getDocs(
        query(
          collection(db, 'attendance'),
          where('projectId', '==', projectId),
          where('dateKey', '==', dateKey),
        ),
      )
      return snap.docs.map((d) => toAttendance(d.id, d.data()))
    },

    async forLabourInRange(labourId: string, from: DateKey, to: DateKey): Promise<Attendance[]> {
      const snap = await getDocs(
        query(
          collection(db, 'attendance'),
          where('labourId', '==', labourId),
          where('dateKey', '>=', from),
          where('dateKey', '<=', to),
        ),
      )
      return snap.docs.map((d) => toAttendance(d.id, d.data()))
    },

    async forProjectInRange(projectId: string, from: DateKey, to: DateKey): Promise<Attendance[]> {
      const snap = await getDocs(
        query(
          collection(db, 'attendance'),
          where('projectId', '==', projectId),
          where('dateKey', '>=', from),
          where('dateKey', '<=', to),
        ),
      )
      return snap.docs.map((d) => toAttendance(d.id, d.data()))
    },

    /**
     * Marks attendance. THE offline-critical write of the whole system.
     *
     * A plain `setDoc` on a deterministic ID (ADR-006), deliberately NOT a
     * transaction: transactions fail outright without a connection (R-02),
     * and section 13 says attendance must never be lost to a network failure.
     * Firestore queues this in IndexedDB and replays it on reconnect; because
     * the ID is derived from project + labourer + date, a replay overwrites
     * the same document instead of creating a duplicate.
     *
     * The rate is snapshotted here so a later raise cannot restate past work.
     *
     * Returns immediately without awaiting the server when offline - awaiting
     * would hang until reconnect, and the supervisor needs the tick now.
     */
    mark(
      input: {
        projectId: string
        labour: { id: string; name: string }
        dateKey: DateKey
        status: AttendanceStatus
        dailyRatePaise: Paise
        rules?: WageRules
      },
      actorUid: string,
    ): { id: string; committed: Promise<void> } {
      const id = attendanceId(input.projectId, input.labour.id, input.dateKey)
      const rules = input.rules ?? DEFAULT_WAGE_RULES

      const committed = setDoc(
        doc(db, 'attendance', id),
        {
          projectId: input.projectId,
          labourId: input.labour.id,
          labourName: input.labour.name,
          dateKey: input.dateKey,
          status: input.status,
          dailyRatePaise: input.dailyRatePaise,
          payableUnits: payableUnitsFor(input.status, rules),
          markedBy: actorUid,
          markedAt: serverTimestamp(),
          clientCreatedAt: now(),
          syncSource: 'ONLINE',
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )

      return { id, committed }
    },
  }
}

export type LabourRepository = ReturnType<typeof createLabourRepository>
export type AttendanceRepository = ReturnType<typeof createAttendanceRepository>
