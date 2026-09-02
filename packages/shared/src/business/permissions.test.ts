import { describe, it, expect } from 'vitest'
import { ROLES, type Role } from '@mc/types'
import { can, canInProject, canSeeMoney, permissionsFor, PERMISSIONS } from './permissions'

/**
 * Spec section 42, critical test 11. The denial cases matter more than the
 * permission ones: proving OWNER can act is easy, proving SUPERVISOR cannot is
 * what catches a real bug.
 */

describe('owner', () => {
  it('holds every permission', () => {
    for (const p of PERMISSIONS) {
      expect(can('OWNER', p)).toBe(true)
    }
  })
})

describe('supervisor - the most restricted writing role', () => {
  it('can mark attendance and enter measurements, which is the job', () => {
    expect(can('SUPERVISOR', 'attendance:write')).toBe(true)
    expect(can('SUPERVISOR', 'measurement:create')).toBe(true)
  })

  it('cannot approve measurements - separation of duty', () => {
    // Without this, a supervisor could approve their own work into a bill.
    expect(can('SUPERVISOR', 'measurement:approve')).toBe(false)
  })

  it('sees no money at all', () => {
    expect(canSeeMoney('SUPERVISOR')).toBe(false)
    expect(can('SUPERVISOR', 'bill:read')).toBe(false)
    expect(can('SUPERVISOR', 'clientPayment:read')).toBe(false)
    expect(can('SUPERVISOR', 'labourPayment:read')).toBe(false)
    expect(can('SUPERVISOR', 'wage:read')).toBe(false)
    expect(can('SUPERVISOR', 'expense:read')).toBe(false)
  })

  it('cannot manage users or settings', () => {
    expect(can('SUPERVISOR', 'user:manage')).toBe(false)
    expect(can('SUPERVISOR', 'settings:write')).toBe(false)
  })

  it('is confined to projects it is assigned to', () => {
    expect(canInProject('SUPERVISOR', 'attendance:write', true)).toBe(true)
    expect(canInProject('SUPERVISOR', 'attendance:write', false)).toBe(false)
    expect(canInProject('SUPERVISOR', 'measurement:create', false)).toBe(false)
  })

  it('is not granted a permission by membership alone', () => {
    // Membership widens scope; it never adds a permission the role lacks.
    expect(canInProject('SUPERVISOR', 'measurement:approve', true)).toBe(false)
    expect(canInProject('SUPERVISOR', 'bill:create', true)).toBe(false)
  })
})

describe('accountant', () => {
  it('runs the money side', () => {
    expect(can('ACCOUNTANT', 'bill:create')).toBe(true)
    expect(can('ACCOUNTANT', 'clientPayment:confirm')).toBe(true)
    expect(can('ACCOUNTANT', 'labourPayment:write')).toBe(true)
    expect(can('ACCOUNTANT', 'wage:lock')).toBe(true)
    expect(canSeeMoney('ACCOUNTANT')).toBe(true)
  })

  it('cannot alter the work records that money is computed from', () => {
    expect(can('ACCOUNTANT', 'measurement:approve')).toBe(false)
    expect(can('ACCOUNTANT', 'measurement:create')).toBe(false)
    expect(can('ACCOUNTANT', 'attendance:write')).toBe(false)
    expect(can('ACCOUNTANT', 'boq:write')).toBe(false)
  })

  it('cannot cancel a bill or manage users', () => {
    expect(can('ACCOUNTANT', 'bill:cancel')).toBe(false)
    expect(can('ACCOUNTANT', 'user:manage')).toBe(false)
  })
})

describe('admin', () => {
  it('has operational control including measurement approval', () => {
    expect(can('ADMIN', 'measurement:approve')).toBe(true)
    expect(can('ADMIN', 'project:write')).toBe(true)
    expect(can('ADMIN', 'bill:cancel')).toBe(true)
  })

  it('cannot manage users, change settings, or reconcile', () => {
    expect(can('ADMIN', 'user:manage')).toBe(false)
    expect(can('ADMIN', 'settings:write')).toBe(false)
    expect(can('ADMIN', 'reconciliation:run')).toBe(false)
  })
})

describe('viewer', () => {
  it('reads everything and writes nothing', () => {
    const writes = PERMISSIONS.filter(
      (p) =>
        p.endsWith(':write') ||
        p.endsWith(':create') ||
        p.endsWith(':approve') ||
        p.endsWith(':confirm') ||
        p.endsWith(':cancel') ||
        p.endsWith(':lock') ||
        p.endsWith(':manage') ||
        p.endsWith(':members') ||
        p.endsWith(':run'),
    )
    for (const p of writes) {
      expect(can('VIEWER', p)).toBe(false)
    }
    expect(can('VIEWER', 'bill:read')).toBe(true)
    expect(can('VIEWER', 'report:read')).toBe(true)
  })
})

describe('invariants across every role', () => {
  it('grants user management and reconciliation to OWNER alone', () => {
    for (const role of ROLES) {
      const expected = role === 'OWNER'
      expect(can(role, 'user:manage')).toBe(expected)
      expect(can(role, 'settings:write')).toBe(expected)
      expect(can(role, 'reconciliation:run')).toBe(expected)
    }
  })

  it('never grants a write without the matching read', () => {
    const pairs: [string, string][] = [
      ['client:write', 'client:read'],
      ['project:write', 'project:read'],
      ['boq:write', 'boq:read'],
      ['labour:write', 'labour:read'],
      ['attendance:write', 'attendance:read'],
      ['expense:write', 'expense:read'],
      ['labourPayment:write', 'labourPayment:read'],
    ]
    for (const role of ROLES) {
      for (const [write, read] of pairs) {
        if (can(role, write as never)) {
          // The one deliberate exception: a supervisor may record an expense
          // but may not read the project's expense ledger.
          if (role === 'SUPERVISOR' && write === 'expense:write') continue
          expect(can(role, read as never), `${role} has ${write} but not ${read}`).toBe(true)
        }
      }
    }
  })

  it('gives no role more permissions than OWNER', () => {
    const ownerCount = permissionsFor('OWNER').length
    for (const role of ROLES) {
      expect(permissionsFor(role).length).toBeLessThanOrEqual(ownerCount)
    }
    expect(ownerCount).toBe(PERMISSIONS.length)
  })

  it('orders roles by breadth: OWNER > ADMIN > ACCOUNTANT, and VIEWER writes nothing', () => {
    const size = (r: Role) => permissionsFor(r).length
    expect(size('OWNER')).toBeGreaterThan(size('ADMIN'))
    expect(size('ADMIN')).toBeGreaterThan(size('ACCOUNTANT'))
    expect(size('ACCOUNTANT')).toBeGreaterThan(size('VIEWER'))
  })

  it('exposes money only to the roles that need it', () => {
    expect(ROLES.filter(canSeeMoney).sort()).toEqual(
      ['ACCOUNTANT', 'ADMIN', 'OWNER', 'VIEWER'],
    )
  })
})
