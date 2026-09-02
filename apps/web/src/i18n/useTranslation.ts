import { useCallback, useEffect, useState } from 'react'
import type { Locale } from '@mc/types'
import { TRANSLATIONS, type StringKey, type Strings } from './strings'

const STORAGE_KEY = 'mc.locale'

/**
 * Locale selection and lookup.
 *
 * Persisted to localStorage so the choice survives a signed-out reload. A
 * module-level subscriber set keeps every component in sync without a context
 * provider, since locale changes are rare and global.
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

export interface TranslateParams {
  /** Count. Selects the `_one` variant when exactly 1, and fills `{n}`. */
  n?: number
  [key: string]: string | number | undefined
}

/**
 * Looks up a key, picking a singular variant and substituting placeholders.
 *
 * Pluralisation is deliberately minimal: a `key_one` entry is used when
 * `n === 1`, otherwise `key`. English and Hindi both need exactly this
 * distinction and nothing more, so a full CLDR plural-rules engine would be
 * machinery for a problem we do not have.
 *
 * Numbers are formatted with Indian digit grouping, because a count rendered
 * beside Indian-grouped money should not switch conventions mid-sentence.
 */
export function translate(locale: Locale, key: StringKey, params?: TranslateParams): string {
  const table: Strings = TRANSLATIONS[locale]

  let resolved: string = table[key]
  if (params?.n === 1) {
    const singular = `${key}_one` as StringKey
    if (singular in table) resolved = table[singular]
  }

  if (!params) return resolved

  return resolved.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    return typeof value === 'number' ? value.toLocaleString('en-IN') : value
  })
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
    (key: StringKey, params?: TranslateParams): string => translate(locale, key, params),
    [locale],
  )

  return { t, locale, setLocale }
}
