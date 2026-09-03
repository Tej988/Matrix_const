import type { Locale } from '@mc/types'
import { getLocale, translate } from '../i18n/useTranslation'

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

/**
 * The locale is a parameter rather than a hook, because this is called from
 * plain functions as well as components. It defaults to the current selection
 * so a caller that already re-renders on a locale change need not thread it.
 */
export function describeFirestoreError(
  error: unknown,
  locale: Locale = getLocale(),
): DescribedError {
  const code = codeOf(error)
  const raw = messageOf(error)
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)

  if (code === 'failed-precondition' && /requires an index/i.test(raw)) {
    return {
      title: t('errSettingUpTitle'),
      message: t('errSettingUpBody'),
      transient: true,
    }
  }

  switch (code) {
    case 'unavailable':
      return {
        title: t('errOfflineTitle'),
        message: t('errOfflineBody'),
        transient: true,
      }
    case 'permission-denied':
      return {
        title: t('errNotAllowedTitle'),
        message: t('errNotAllowedBody'),
        transient: false,
      }
    case 'unauthenticated':
      return {
        title: t('errSignedOutTitle'),
        message: t('errSignedOutBody'),
        transient: false,
      }
    case 'resource-exhausted':
      return {
        title: t('errQuotaTitle'),
        message: t('errQuotaBody'),
        transient: false,
      }
    case 'deadline-exceeded':
      return {
        title: t('errSlowTitle'),
        message: t('errSlowBody'),
        transient: true,
      }
    default:
      return {
        title: t('errUnknownTitle'),
        message: raw || t('errUnknownBody'),
        transient: false,
      }
  }
}
