import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { env, isDevelopment, useEmulators } from './env'

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}

export const app: FirebaseApp = initializeApp(firebaseConfig)

export const auth: Auth = getAuth(app)

/**
 * Offline persistence is not an optimisation here - it is what makes attendance
 * work at a site with no signal (spec section 13). Multi-tab manager so two open
 * tabs do not fight over the IndexedDB lease.
 *
 * Note the limit this does NOT lift: `runTransaction` still requires a live
 * connection. Financial writes fail offline by design rather than appearing to
 * succeed. See RISKS.md R-02.
 */
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

/**
 * Sign-in asks for identity ONLY.
 *
 * The Drive scope is requested later, the first time someone actually attaches
 * a file (Phase 6+). This is incremental authorization - Google's own
 * recommended pattern - and it earns three things:
 *
 *   1. First login is a plain "choose your account", with no permissions list
 *      to alarm a non-technical owner.
 *   2. Sign-in cannot break because of a file-storage scope, which is what
 *      happened on 2026-08-27: requesting drive.file before it was registered
 *      under Data Access failed the whole flow with a generic Google error.
 *   3. Roles that never upload anything are never asked for Drive access.
 *
 * See ADR-009 and SECURITY.md section 7. The narrow `drive.file` scope itself
 * is unchanged - only when we ask for it has moved.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

/**
 * A development build must never reach production Firestore. Cheap insurance
 * against the afternoon someone seeds test data into the real books.
 */
if (useEmulators) {
  if (!isDevelopment) {
    throw new Error('Refusing to connect to emulators outside a development build.')
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  console.warn('[firebase] Connected to local emulators - no production data is in use.')
}
