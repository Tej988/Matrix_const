import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { createSettingsRepository } from '@mc/shared/repositories/settings'
import type { BusinessProfile } from '@mc/types'
import { DEFAULT_BUSINESS } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

/**
 * The business's own letterhead — the name, address and GSTIN printed on every
 * bill and quotation a client receives.
 *
 * This was hardcoded as "Matrix Construction" and went out on real documents
 * under someone else's name. It is data now, owner-editable, and the printers
 * read it from here rather than from a literal.
 */

/** One key, so the three screens that print share a single read. */
export const BUSINESS_QUERY_KEY = ['business-profile'] as const

export function useBusinessProfile(): UseQueryResult<BusinessProfile> {
  const repo = useMemo(() => createSettingsRepository(db), [])
  return useQuery({
    queryKey: BUSINESS_QUERY_KEY,
    queryFn: () => repo.getBusiness(),
    // The letterhead changes about once a year. Re-reading it on every tab
    // focus would be a Firestore read per print button for nothing.
    staleTime: 5 * 60 * 1000,
  })
}

export function hasBusinessName(profile: BusinessProfile | undefined): boolean {
  return (profile?.name ?? '').trim() !== ''
}

export const BUSINESS_NOT_SET_WARNING =
  'Your business name is not set, so documents will print with a placeholder. Set it under Settings → Business details.'

/**
 * What the printers are handed.
 *
 * An unset profile prints a loud placeholder rather than an empty letterhead:
 * a blank heading looks like a rendering fault and gets sent to a client
 * anyway, whereas this cannot be mistaken for a finished document.
 */
export function letterheadFor(profile: BusinessProfile | undefined): BusinessProfile {
  if (profile && hasBusinessName(profile)) return profile
  return { ...(profile ?? DEFAULT_BUSINESS), name: '[BUSINESS NAME NOT SET — see Settings]' }
}

export function BusinessProfileForm() {
  const { can } = useAuth()
  const { t } = useTranslation()
  const profile = useBusinessProfile()

  // OWNER only. Firestore Rules enforce the same thing independently (R-03);
  // this just keeps a form nobody can submit off the page.
  if (!can('settings:write')) return null
  if (profile.isPending) return <p className="text-slate-500">{t('loading')}</p>
  if (profile.isError) {
    return (
      <QueryError
        error={profile.error}
        onRetry={() => void profile.refetch()}
        what="the business details"
      />
    )
  }

  // The stored profile seeds the fields once, through useState initialisers -
  // no effect syncing state to a query, and a background refetch cannot wipe
  // out what someone is halfway through typing.
  return <ProfileFields initial={profile.data} />
}

function ProfileFields({ initial }: { initial: BusinessProfile }) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const repo = useMemo(() => createSettingsRepository(db), [])
  const queryClient = useQueryClient()

  const [name, setName] = useState(initial.name)
  const [tagline, setTagline] = useState(initial.tagline ?? '')
  const [address, setAddress] = useState(initial.addressLines.join('\n'))
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.email ?? '')
  const [gstin, setGstin] = useState(initial.gstin ?? '')
  const [signatory, setSignatory] = useState(initial.signatory ?? '')
  const [billPrefix, setBillPrefix] = useState(initial.billPrefix)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      const trimmed = name.trim()
      if (trimmed === '') throw new Error('Enter the business name.')

      // Conditional spread, not `field || undefined`: exactOptionalPropertyTypes
      // rejects an explicit undefined where the property is merely optional.
      const next: BusinessProfile = {
        name: trimmed,
        addressLines: address
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
        billPrefix: billPrefix.trim().toUpperCase() || DEFAULT_BUSINESS.billPrefix,
        ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}),
        ...(signatory.trim() ? { signatory: signatory.trim() } : {}),
      }
      return repo.saveBusiness(next, user.uid)
    },
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: BUSINESS_QUERY_KEY })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSaved(false)
        save.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <Field label="Business name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lakhan Sharma R"
          className={inputClass}
        />
      </Field>

      <Field label="Tagline">
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Dealers in Italian granite, marble, vitrified tiles"
          className={inputClass}
        />
      </Field>

      <Field label="Address — one line per row">
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          placeholder={'Village & Post Luhari\nDist. Dholpur (Raj.) PIN - 328001'}
          className={inputClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('phone')}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="9314110681, 9588275341"
            className={inputClass}
          />
        </Field>
        <Field label="Email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            placeholder="name@example.com"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="GSTIN">
          <input
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="08BWLPS1360M1ZY"
            className={inputClass}
          />
        </Field>
        <Field label="Authorized signatory">
          <input
            value={signatory}
            onChange={(e) => setSignatory(e.target.value)}
            placeholder="Lakhan Sharma"
            className={inputClass}
          />
        </Field>
        <Field label="Bill number prefix">
          <input
            value={billPrefix}
            onChange={(e) => setBillPrefix(e.target.value.toUpperCase())}
            placeholder={DEFAULT_BUSINESS.billPrefix}
            className={inputClass}
          />
        </Field>
      </div>

      {save.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(save.error as Error).message}
        </p>
      )}

      {saved && !save.isPending && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">
          Saved. New bills and quotations will use these details.
        </p>
      )}

      <button
        type="submit"
        disabled={save.isPending || name.trim() === ''}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {save.isPending ? t('saving') : t('save')}
      </button>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  )
}
