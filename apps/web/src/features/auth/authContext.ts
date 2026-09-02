import { createContext, use } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import type { UserRecord } from '@mc/shared/repositories/users'
import type { Permission } from '@mc/shared'

/**
 * Context and hooks live apart from the provider component.
 *
 * Not stylistic: Vite's Fast Refresh requires a module to export *only*
 * components, or only non-components. Mixing them makes every edit to this file
 * invalidate the module instead of hot-patching it, which tears down React state
 * mid-session and can leave a half-applied page.
 */

/**
 * Authentication has five distinct outcomes, and conflating them is what makes
 * a "why can't I log in" support call:
 *
 *   signed-out    - no Google session
 *   unprovisioned - valid Google account, but no users/{uid} document
 *   disabled      - provisioned, then turned off
 *   ready         - provisioned and active
 *
 * `unprovisioned` is not an error. It is the expected state for anyone the
 * owner has not yet added (SECURITY.md section 1).
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unprovisioned'; firebaseUser: FirebaseUser }
  | { status: 'disabled'; firebaseUser: FirebaseUser; profile: UserRecord }
  | { status: 'ready'; firebaseUser: FirebaseUser; profile: UserRecord }

export interface AuthContextValue {
  state: AuthState
  /** False unless status is 'ready' - a loading or disabled user can do nothing. */
  can: (permission: Permission) => boolean
  canInProject: (permission: Permission, isMember: boolean) => boolean
  reloadProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For screens that only ever render when status is 'ready'. */
export function useCurrentUser(): UserRecord {
  const { state } = useAuth()
  if (state.status !== 'ready') {
    throw new Error('useCurrentUser called outside an authenticated route')
  }
  return state.profile
}
