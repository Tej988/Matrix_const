import { useState } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import { signOut } from '../../lib/auth'

/**
 * Shown when a Google account signs in successfully but has no users/{uid}
 * document. This is not an error - it is the correct state for anyone the owner
 * has not yet added, and the default-deny posture that makes a stranger's
 * accidental sign-in harmless (SECURITY.md section 1).
 *
 * The UID is displayed and made easy to send, because the whole provisioning
 * flow depends on getting it to the owner. There is no email invitation: that
 * needs a server, and there isn't one (ADR-002). Passing the ID by hand has
 * fewer moving parts and nothing to spoof - but it has to be one tap, not a
 * long-press-select-copy on a phone.
 */
export function AwaitingAccessScreen({
  firebaseUser,
  disabled = false,
}: {
  firebaseUser: FirebaseUser
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const message = `Please give me access to Matrix Construction.\n\nName: ${
    firebaseUser.displayName ?? ''
  }\nEmail: ${firebaseUser.email ?? ''}\nAccount ID: ${firebaseUser.uid}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked (insecure context, or permission denied). The ID is
      // on screen to select by hand, and the WhatsApp link still works.
      setCopied(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {disabled ? 'Your access has been turned off' : 'Waiting for access'}
        </h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          {disabled
            ? 'Your account exists but has been disabled. Ask the owner to re-enable it.'
            : 'You are signed in to Google, but this account has not been given access yet. Send the details below to the owner.'}
        </p>
      </div>

      <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500 dark:text-slate-400">Signed in as</dt>
          <dd className="text-right text-slate-900 dark:text-slate-100">{firebaseUser.email}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-slate-500 dark:text-slate-400">Your account ID</dt>
          <dd className="mt-1 font-mono text-xs break-all text-slate-900 select-all dark:text-slate-100">
            {firebaseUser.uid}
          </dd>
        </div>
      </dl>

      {!disabled && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-xl bg-slate-900 px-6 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {copied ? 'Copied ✓' : 'Copy my details'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-300 px-6 py-3 text-center font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
          >
            Send on WhatsApp
          </a>
        </div>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className="text-sm font-medium text-slate-500 dark:text-slate-400"
      >
        Sign out
      </button>
    </main>
  )
}
