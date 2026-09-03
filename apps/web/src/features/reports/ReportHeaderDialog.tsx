import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Dates } from '@mc/shared'
import type { BusinessProfile, DateKey } from '@mc/types'
import { useTranslation } from '../../i18n/useTranslation'
import { headerFrom, type ReportHeader } from './reportPdf'

/**
 * The letterhead, confirmed before the document is generated.
 *
 * Everything here is seeded from the saved business profile and edited for
 * THIS document only. Nothing is written back to Settings: correcting a phone
 * number on one report to a site number must not silently change the number on
 * every bill the business issues afterwards. The Settings link is the one way
 * to make a change stick, and it is spelled out rather than implied.
 *
 * This also replaces the old blind print. The letterhead used to be read at
 * print time and whatever came back went onto the paper; now the operator sees
 * it, which is a stronger guarantee than a fresh read they never look at.
 */

interface Props {
  /** Seeded values - the saved profile plus this document's title and date. */
  initial: ReportHeader
  /** The stored profile, for "reset" and for the empty-profile warning. */
  saved: BusinessProfile | undefined
  /** What the primary button does: generate, or just apply to the preview. */
  submitLabel: string
  onCancel: () => void
  onSubmit: (header: ReportHeader) => void
}

export function ReportHeaderDialog({ initial, saved, submitLabel, onCancel, onSubmit }: Props) {
  const { t } = useTranslation()

  // useState initialisers, not an effect syncing props to state: a background
  // profile refetch must not wipe out what someone is halfway through typing.
  const [businessName, setBusinessName] = useState(initial.businessName)
  const [tagline, setTagline] = useState(initial.tagline ?? '')
  const [address, setAddress] = useState(initial.addressLines.join('\n'))
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.email ?? '')
  const [gstin, setGstin] = useState(initial.gstin ?? '')
  const [signatory, setSignatory] = useState(initial.signatory ?? '')
  const [title, setTitle] = useState(initial.title)
  const [subtitle, setSubtitle] = useState(initial.subtitle ?? '')
  const [ref, setRef] = useState(initial.ref ?? '')
  const [date, setDate] = useState<string>(initial.date)
  const [dateError, setDateError] = useState(false)

  // The stored profile has never been filled in. Say so here rather than
  // printing an empty band across the top of a document a client will see.
  const profileEmpty = (saved?.name ?? '').trim() === ''

  function resetToSaved() {
    if (!saved) return
    setBusinessName(saved.name)
    setTagline(saved.tagline ?? '')
    setAddress(saved.addressLines.join('\n'))
    setPhone(saved.phone ?? '')
    setEmail(saved.email ?? '')
    setGstin(saved.gstin ?? '')
    setSignatory(saved.signatory ?? '')
  }

  function submit() {
    let dateKey: DateKey
    try {
      dateKey = Dates.dateKey(date)
    } catch {
      setDateError(true)
      return
    }

    // headerFrom() owns the conditional spreads that exactOptionalPropertyTypes
    // requires, so the shape is built in exactly one place.
    const profile: BusinessProfile = {
      name: businessName.trim(),
      addressLines: address
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
      billPrefix: saved?.billPrefix ?? '',
      ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}),
      ...(signatory.trim() ? { signatory: signatory.trim() } : {}),
    }

    onSubmit(
      headerFrom(profile, {
        title: title.trim() || initial.title,
        date: dateKey,
        ...(subtitle.trim() ? { subtitle: subtitle.trim() } : {}),
        ...(ref.trim() ? { ref: ref.trim() } : {}),
      }),
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-header-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800"
      >
        <h2
          id="report-header-title"
          className="text-xl font-semibold text-slate-900 dark:text-slate-100"
        >
          {t('reportHeader')}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('documentHeaderHint')}{' '}
          <Link to="/settings" className="font-medium underline">
            {t('editSavedDetailsInSettings')}
          </Link>
          {t('fullStop')}
        </p>

        {profileEmpty && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            {t('letterheadNotSetUp')}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <Field label={t('businessName')}>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Lakhan Sharma R"
              autoFocus
              className={inputClass}
            />
          </Field>

          <Field label={t('tagline')}>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Dealers in Italian granite, marble, vitrified tiles"
              className={inputClass}
            />
          </Field>

          <Field label={t('address')}>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('phone')}>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                className={inputClass}
              />
            </Field>
            <Field label={t('email')}>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('gstin')}>
              <input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="08BWLPS1360M1ZY"
                className={inputClass}
              />
            </Field>
            <Field label={t('signatory')}>
              <input
                value={signatory}
                onChange={(e) => setSignatory(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <hr className="border-slate-200 dark:border-slate-700" />

          <Field label={t('title')}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label={t('subtitle')}>
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('ref')} (${t('optional')})`}>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="LS/2026/014"
                className={inputClass}
              />
            </Field>
            <Field label={t('date')}>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  setDateError(false)
                }}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {dateError && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
            {t('enterValidDate')}
          </p>
        )}

        {saved && !profileEmpty && (
          <button
            type="button"
            onClick={resetToSaved}
            className="mt-4 text-sm font-medium text-slate-500 underline dark:text-slate-400"
          >
            {t('resetToSavedDetails')}
          </button>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={businessName.trim() === ''}
            className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
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
