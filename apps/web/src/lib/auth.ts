import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import { auth, googleProvider, DRIVE_SCOPE } from './firebase'

/**
 * Sign-in, and the Drive access token that rides along with it.
 *
 * One Google consent covers both identity and file access (ADR-009), so the
 * owner taps once rather than authenticating twice.
 */

/**
 * Held in memory only - never localStorage, never a cookie. An XSS that reaches
 * a stored Drive token is a far worse day than one that does not
 * (SECURITY.md section 7). The cost is that it is lost on reload and
 * re-acquired on next sign-in, which is the right trade.
 */
let driveAccessToken: string | null = null

export function getDriveAccessToken(): string | null {
  return driveAccessToken
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

/**
 * Asks for Drive access, separately from sign-in and only when a file is
 * actually being attached (incremental authorization - see firebase.ts).
 *
 * Callers must treat failure as non-fatal: the record still saves, the
 * attachment does not. A file upload must never be able to fail a payment.
 */
export async function requestDriveAccess(): Promise<string | null> {
  const provider = new GoogleAuthProvider()
  provider.addScope(DRIVE_SCOPE)
  provider.setCustomParameters({ prompt: 'consent' })

  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  driveAccessToken = credential?.accessToken ?? null
  return driveAccessToken
}

export async function signOut(): Promise<void> {
  driveAccessToken = null
  await fbSignOut(auth)
}

/** Maps Firebase's error codes to something a non-technical user can act on. */
export function describeAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
    case 'auth/network-request-failed':
      return 'No internet connection. Check your network and try again.'
    case 'auth/unauthorized-domain':
      return 'This web address is not authorised in the Google console yet.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this project yet.'
    default:
      return 'Could not sign in. Please try again.'
  }
}
