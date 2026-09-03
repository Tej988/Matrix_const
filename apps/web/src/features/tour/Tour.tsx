import { useEffect, useState } from 'react'
import type { Role } from '@mc/types'
import { useTranslation, type Translate } from '../../i18n/useTranslation'

/**
 * First-run tour.
 *
 * Deliberately no dependency and no element-spotlighting library: a spotlight
 * that anchors to DOM nodes breaks every time a layout changes, and this needs
 * to survive the app growing. A centred card explaining the flow is more
 * robust and easier to translate.
 *
 * Role-aware, because what the app IS differs by who you are: a supervisor's
 * whole job is two screens, while an owner sees the money chain.
 */

const SEEN_KEY = 'mc.tour.seen.v1'

interface Step {
  title: string
  body: string
  detail?: string
}

function stepsFor(t: Translate, role: Role, name: string): Step[] {
  const first = name.split(' ')[0] || t('tourGreetingName')
  const rateCardTitle = `📋 ${t('tourRateCardTitle')}`

  if (role === 'SUPERVISOR') {
    return [
      {
        title: `${t('greeting')}, ${first}`,
        body: t('tourSupIntroBody'),
      },
      {
        title: `📅 ${t('attendanceTitle')}`,
        body: t('tourSupAttendanceBody'),
        detail: t('tourSupAttendanceDetail'),
      },
      {
        title: `🏗️ ${t('tabMeasurements')}`,
        body: t('tourSupMeasureBody'),
        detail: t('tourSupMeasureDetail'),
      },
      {
        title: t('tourSupHiddenTitle'),
        body: t('tourSupHiddenBody'),
      },
    ]
  }

  const owner: Step[] = [
    {
      title: `${t('greeting')}, ${first}`,
      body: t('tourOwnerIntroBody'),
    },
    {
      title: t('tourFlowTitle'),
      body: t('tourFlowBody'),
      detail: t('tourFlowDetail'),
    },
    {
      title: `🏗️ ${t('projectsTitle')}`,
      body: t('tourProjectsBody'),
      detail: t('tourProjectsDetail'),
    },
    {
      title: rateCardTitle,
      body: t('tourRateCardBody'),
      detail: t('tourRateCardDetail'),
    },
    {
      title: `💰 ${t('tourBillsTitle')}`,
      body: t('tourBillsBody'),
      detail: t('tourBillsDetail'),
    },
    {
      title: `👷 ${t('tourLabourTitle')}`,
      body: t('tourLabourBody'),
      detail: t('tourLabourDetail'),
    },
    {
      title: `📄 ${t('reportsTitle')}`,
      body: t('tourReportsBody'),
      detail: t('tourReportsDetail'),
    },
  ]

  if (role === 'OWNER' || role === 'ADMIN') return owner
  // Accountant and viewer: same story, without the setup steps.
  return owner.filter((s) => s.title !== rateCardTitle)
}

export function Tour({ role, name }: { role: Role; name: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true)
    } catch {
      // Private browsing. Skipping the tour is the right failure.
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Not fatal - it will simply show again next time.
    }
    setOpen(false)
  }

  if (!open) return null

  const steps = stepsFor(t, role, name)
  const current = steps[step]
  if (!current) return null

  const last = step === steps.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800">
        <div className="mb-4 flex gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i <= step ? 'bg-slate-900 dark:bg-slate-100' : 'bg-slate-200 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>

        <h2 id="tour-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {current.title}
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{current.body}</p>
        {current.detail && (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            {current.detail}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 dark:text-slate-400"
          >
            {t('skip')}
          </button>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
              >
                {t('back')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setStep((s) => s + 1))}
              className="rounded-xl bg-slate-900 px-6 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {last ? t('tourStart') : t('next')}
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-slate-400">
          {t('tourProgress', { step: step + 1, total: steps.length })}
        </p>
      </div>
    </div>
  )
}

/** Lets Settings offer "show the tour again". */
export function resetTour(): void {
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    // Nothing to do - the tour will show anyway if storage is unavailable.
  }
}
