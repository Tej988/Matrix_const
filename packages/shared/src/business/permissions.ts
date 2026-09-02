import type { Role } from '@mc/types'

/**
 * Role-based access control, as a pure lookup.
 *
 * This is the single definition of who may do what. The UI hides controls with
 * it, repositories guard writes with it, and Phase 12's AI tools will authorise
 * with it. Firestore Rules enforce the same matrix independently - they are the
 * real boundary (RISKS.md R-03), and this table is what keeps the client honest
 * enough that the boundary is rarely tested in anger.
 *
 * Mirrors SECURITY.md section 2. Change both together, or neither.
 */

export const PERMISSIONS = [
  'client:read',
  'client:write',
  'project:read',
  'project:write',
  'project:members',
  'boq:read',
  'boq:write',
  'measurement:read',
  'measurement:create',
  'measurement:approve',
  'bill:read',
  'bill:create',
  'bill:cancel',
  'clientPayment:read',
  'clientPayment:create',
  'clientPayment:confirm',
  'labour:read',
  'labour:write',
  'attendance:read',
  'attendance:write',
  'wage:read',
  'wage:lock',
  'labourPayment:read',
  'labourPayment:write',
  'expense:read',
  'expense:write',
  'report:read',
  'financials:view',
  'user:manage',
  'settings:read',
  'settings:write',
  'reconciliation:run',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Permissions that only apply to projects the user is assigned to. For a
 * SUPERVISOR these are additionally gated on projectMembers; for everyone else
 * the role grant is unconditional.
 */
const PROJECT_SCOPED: ReadonlySet<Permission> = new Set([
  'project:read',
  'boq:read',
  'measurement:read',
  'measurement:create',
  'attendance:read',
  'attendance:write',
  'expense:write',
  'report:read',
])

const SUPERVISOR_PERMISSIONS: readonly Permission[] = [
  // Deliberately narrow. A supervisor marks attendance and records work done.
  // They cannot approve their own measurements - that separation of duty is
  // what makes the approval workflow mean anything - and they see no money.
  'project:read',
  'client:read',
  'boq:read',
  'measurement:read',
  'measurement:create',
  'labour:read',
  'attendance:read',
  'attendance:write',
  'expense:write',
  'settings:read',
]

const ACCOUNTANT_PERMISSIONS: readonly Permission[] = [
  'client:read',
  'project:read',
  'boq:read',
  'measurement:read',
  'bill:read',
  'bill:create',
  'clientPayment:read',
  'clientPayment:create',
  'clientPayment:confirm',
  'labour:read',
  'attendance:read',
  'wage:read',
  'wage:lock',
  'labourPayment:read',
  'labourPayment:write',
  'expense:read',
  'expense:write',
  'report:read',
  'financials:view',
  'settings:read',
]

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...ACCOUNTANT_PERMISSIONS,
  'client:write',
  'project:write',
  'project:members',
  'boq:write',
  'measurement:create',
  'measurement:approve',
  'bill:cancel',
  'labour:write',
  'attendance:write',
]

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'client:read',
  'project:read',
  'boq:read',
  'measurement:read',
  'bill:read',
  'clientPayment:read',
  'labour:read',
  'attendance:read',
  'wage:read',
  'labourPayment:read',
  'expense:read',
  'report:read',
  'financials:view',
  'settings:read',
]

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  // The owner gets everything EXCEPT the ability to delete financial history,
  // which is not a permission anyone holds - it is absent from the enum
  // entirely, so it cannot be granted by accident (ADR-007).
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  ACCOUNTANT: new Set(ACCOUNTANT_PERMISSIONS),
  SUPERVISOR: new Set(SUPERVISOR_PERMISSIONS),
  VIEWER: new Set(VIEWER_PERMISSIONS),
}

/** Does this role hold this permission, ignoring project scope? */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

/**
 * Does this role hold this permission for a specific project?
 *
 * A supervisor is confined to projects they are assigned to; every other role
 * works across all projects. Pass `isMember` from a projectMembers lookup.
 */
export function canInProject(role: Role, permission: Permission, isMember: boolean): boolean {
  if (!can(role, permission)) return false
  if (role === 'SUPERVISOR' && PROJECT_SCOPED.has(permission)) return isMember
  return true
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort()
}

/** Whether any monetary figure should be rendered at all. */
export function canSeeMoney(role: Role): boolean {
  return can(role, 'financials:view')
}
