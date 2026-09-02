import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { createUserRepository } from '@mc/shared/repositories/users'
import { can, canInProject } from '@mc/shared'
import { auth, db } from '../../lib/firebase'
import { AuthContext, type AuthContextValue, type AuthState } from './authContext'

/**
 * Resolves the signed-in Google account into one of the five states in
 * authContext.ts, and exposes permission checks bound to the resulting role.
 *
 * This file exports a component and nothing else, so Fast Refresh can hot-patch
 * it without tearing down auth state. Hooks live in authContext.ts.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const users = useMemo(() => createUserRepository(db), [])

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setState({ status: 'signed-out' })
        return
      }

      try {
        const profile = await users.getProfile(firebaseUser.uid)
        if (!profile) {
          setState({ status: 'unprovisioned', firebaseUser })
        } else if (profile.status === 'DISABLED') {
          setState({ status: 'disabled', firebaseUser, profile })
        } else {
          setState({ status: 'ready', firebaseUser, profile })
        }
      } catch {
        // A Rules denial reaching here means the same thing as no document:
        // this account has no access. Failing closed is the only safe reading.
        setState({ status: 'unprovisioned', firebaseUser })
      }
    })
  }, [users])

  const value = useMemo<AuthContextValue>(() => {
    const role = state.status === 'ready' ? state.profile.role : null
    return {
      state,
      can: (permission) => (role ? can(role, permission) : false),
      canInProject: (permission, isMember) =>
        role ? canInProject(role, permission, isMember) : false,
      reloadProfile: async () => {
        if (state.status === 'loading' || state.status === 'signed-out') return
        const profile = await users.getProfile(state.firebaseUser.uid)
        if (!profile) {
          setState({ status: 'unprovisioned', firebaseUser: state.firebaseUser })
        } else {
          setState({
            status: profile.status === 'DISABLED' ? 'disabled' : 'ready',
            firebaseUser: state.firebaseUser,
            profile,
          })
        }
      },
    }
  }, [state, users])

  return <AuthContext value={value}>{children}</AuthContext>
}
