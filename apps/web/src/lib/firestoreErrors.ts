/**
 * Turns Firestore errors into something a non-technical user can act on.
 *
 * Two of these matter enough to name specially:
 *
 *   failed-precondition + "requires an index" - a composite index is still
 *     building after a deploy. Entirely transient, resolves itself in a minute
 *     or two, and showing the raw message (which includes a console URL) makes
 *     a normal deployment step look like a crash.
 *
 *   unavailable - offline. Reads are served from cache, but a transaction
 *     cannot run at all (R-02), so the honest message is "you are offline",
 *     not "something went wrong".
 */

export interface DescribedError {
  title: string
  message: string
  /** Worth retrying on its own - the UI polls instead of demanding a reload. */
  transient: boolean
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

export function describeFirestoreError(error: unknown): DescribedError {
  const code = codeOf(error)
  const raw = messageOf(error)

  if (code === 'failed-precondition' && /requires an index/i.test(raw)) {
    return {
      title: 'Setting up',
      message:
        'The database is finishing a one-time setup step for this screen. It usually takes a minute or two — this will clear on its own.',
      transient: true,
    }
  }

  switch (code) {
    case 'unavailable':
      return {
        title: 'You are offline',
        message: 'Showing what was saved on this device. New entries need a connection.',
        transient: true,
      }
    case 'permission-denied':
      return {
        title: 'Not allowed',
        message: 'Your role does not have access to this. Ask the owner if you need it.',
        transient: false,
      }
    case 'unauthenticated':
      return {
        title: 'Signed out',
        message: 'Your session ended. Sign in again to continue.',
        transient: false,
      }
    case 'resource-exhausted':
      return {
        title: 'Daily limit reached',
        message:
          'The free database quota for today is used up. It resets at midnight Pacific time.',
        transient: false,
      }
    case 'deadline-exceeded':
      return {
        title: 'Took too long',
        message: 'The connection is slow. Try again in a moment.',
        transient: true,
      }
    default:
      return { title: 'Something went wrong', message: raw || 'Unknown error', transient: false }
  }
}
