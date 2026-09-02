import { useCallback, useEffect, useState } from 'react'
import type { Locale } from '@mc/types'
import { TRANSLATIONS, type StringKey } from './strings'

const STORAGE_KEY = 'mc.locale'

/**
 * Locale selection.
 *
 * Persisted to localStorage so the choice survives a signed-out reload, and
 * mirrored to users/{uid}.locale when the user is known - localStorage alone
 * would mean your father re-picking Hindi on every new device.
 *
 * A module-level subscriber set keeps every component in sync without a
 * context provider, since locale changes are rare and global.
 */
const subscribers = new Set<(l: Locale) => void>()

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'hi' || stored === 'en') return stored
  } catch {
    // Private browsing, or storage disabled. English is a fine fallback.
  }
  return 'en'
}

let currentLocale: Locale = readStoredLocale()

export function setLocale(locale: Locale): void {
  currentLocale = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Not fatal - the choice simply will not persist.
  }
  document.documentElement.lang = locale
  for (const notify of subscribers) notify(locale)
}

export function getLocale(): Locale {
  return currentLocale
}

export function useTranslation() {
  const [locale, setLocaleState] = useState<Locale>(currentLocale)

  useEffect(() => {
    subscribers.add(setLocaleState)
    return () => {
      subscribers.delete(setLocaleState)
    }
  }, [])

  const t = useCallback(
    (key: StringKey): string => TRANSLATIONS[locale][key],
    [locale],
  )

  return { t, locale, setLocale }
}
