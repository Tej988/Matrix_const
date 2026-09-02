import { useEffect, useState } from 'react'
import type { Role } from '@mc/types'

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

function stepsFor(role: Role, name: string): Step[] {
  const first = name.split(' ')[0] || 'there'

  if (role === 'SUPERVISOR') {
    return [
      {
        title: `Namaste, ${first}`,
        body: 'This app replaces the attendance register and the measurement diary. Two screens cover almost everything you do.',
      },
      {
        title: '📅 Attendance',
        body: 'Pick the project and the date, then tap P, ½, A or L against each name.',
        detail:
          'It works with no internet. Marks are saved on your phone and sync by themselves when signal comes back — nothing is ever lost.',
      },
      {
        title: '🏗️ Measurements',
        body: 'Record work done against the rate card — item, location, quantity. The app shows the amount as you type.',
        detail:
          'If a quantity would go past the agreed contract, it tells you immediately and says how much is left. You submit; the owner approves.',
      },
      {
        title: 'What you will not see',
        body: 'Bills, payments and wages are hidden for your role. That is deliberate, not a fault.',
      },
    ]
  }

  const owner: Step[] = [
    {
      title: `Namaste, ${first}`,
      body: 'This is your construction business in one place — projects, work done, bills, money in, labour and wages.',
    },
    {
      title: 'How work becomes money',
      body: 'Client → Project → Rate card → Measurement → Approval → Bill → Payment.',
      detail:
        'Each step feeds the next. Nothing can be billed until it has been measured and approved, and every figure on the dashboard is computed from those records — never typed in by hand.',
    },
    {
      title: '🏗️ Projects',
      body: 'Open a project to see everything about it: contract value, what is billed, what is received, and what is still owed.',
      detail:
        '"Outstanding" is shown as three separate numbers, because it means three different things — money invoiced and unpaid, work still to bill, and the total left to collect.',
    },
    {
      title: '📋 Rate card and measurements',
      body: 'Set your agreed items and rates once. Site staff record work against them each month.',
      detail:
        'The app will not let anyone measure past the contract quantity without an explicit change order.',
    },
    {
      title: '💰 Bills and payments',
      body: 'Generate a bill from approved measurements, print it or save it as PDF, then record payments as they arrive.',
      detail:
        'Bills are never deleted. A mistake is cancelled and reissued, so the trail always stays intact.',
    },
    {
      title: '👷 Labour and wages',
      body: 'Wages are calculated from attendance — days present, half days, and the rate on the day.',
      detail:
        'Earned, paid and payable are tracked separately, so an advance shows up as an advance.',
    },
    {
      title: '📄 Reports',
      body: 'Every report downloads as PDF or a spreadsheet.',
      detail:
        'These are also your backup. There is no automatic off-site backup on the free plan, so download them from time to time.',
    },
  ]

  if (role === 'OWNER' || role === 'ADMIN') return owner
  // Accountant and viewer: same story, without the setup steps.
  return owner.filter((s) => !s.title.includes('Rate card'))
}

export function Tour({ role, name }: { role: Role; name: string }) {
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

  const steps = stepsFor(role, name)
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
            Skip
          </button>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setStep((s) => s + 1))}
              className="rounded-xl bg-slate-900 px-6 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {last ? 'Start using it' : 'Next'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-slate-400">
          {step + 1} of {steps.length} · you can reopen this from Settings
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
