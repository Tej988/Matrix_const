/**
 * Core types. Zero dependencies - this package sits at the bottom of the
 * dependency graph so everything else can import it.
 */

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

/**
 * An integer count of paise. Never rupees, never a float.
 *
 * The brand is the point: it makes `amountPaise: 1850000` (rupees mistaken for
 * paise) a compile error rather than a bug someone finds in a bill three months
 * later. Construct one only via the money module. See DECISIONS.md ADR-004.
 */
export type Paise = number & { readonly __brand: 'Paise' }

/** A calendar day as `YYYY-MM-DD`, always resolved in Asia/Kolkata (R-12). */
export type DateKey = string & { readonly __brand: 'DateKey' }

/** A billing or wage month as `YYYY-MM`, always in Asia/Kolkata. */
export type Period = string & { readonly __brand: 'Period' }

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------

export const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'SUPERVISOR', 'VIEWER'] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const LOCALES = ['en', 'hi'] as const
export type Locale = (typeof LOCALES)[number]

export interface User {
  uid: string
  displayName: string
  email: string
  photoUrl?: string
  phone?: string
  role: Role
  status: UserStatus
  locale: Locale
  /** Drive folder this user may write into - ADR-009. */
  driveFolderId?: string
}

/** Who is performing an action. Passed explicitly rather than read from a global. */
export interface AuthContext {
  uid: string
  displayName: string
  role: Role
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Expected failures are returned, not thrown. Throwing is reserved for genuine
 * bugs, where an error boundary is the right destination. See
 * API_AND_SERVICES.md section 4.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export type AppError =
  | { kind: 'OFFLINE' }
  | { kind: 'PERMISSION_DENIED'; action: string }
  | { kind: 'VALIDATION'; field: string; message: string }
  | { kind: 'DUPLICATE'; idempotencyKey: string }
  | { kind: 'CONFLICT'; message: string }
  | { kind: 'QUOTA_EXCEEDED' }
  | { kind: 'STORAGE_UNAVAILABLE' }
  | { kind: 'UNKNOWN'; cause: unknown }

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

export interface AuditFields {
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
}

export * from './entities'
