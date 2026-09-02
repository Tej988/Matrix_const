import { Money, Dates, permissionsFor } from '@mc/shared'
import { useCurrentUser } from '../auth/authContext'

/**
 * Placeholder. Real project cards and financial figures arrive in Phase 3,
 * reading from projects/{id}/summary/current rather than raw collections
 * (RISKS.md R-10).
 */
export function DashboardPage() {
  const user = useCurrentUser()
  const today = Dates.todayKey()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Namaste, {user.displayName.split(' ')[0]}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {Dates.formatDateKey(today, user.locale)} &middot; FY{' '}
          {Dates.financialYearOf(today)}
        </p>
      </header>

      <section className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-600">
        <p className="text-slate-600 dark:text-slate-300">
          Projects, billing and attendance arrive in the next phases.
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Signed in as <strong>{user.role.toLowerCase()}</strong> with{' '}
          {permissionsFor(user.role).length} permissions.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
          Foundations check
        </h2>
        <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
          <Row label="Money, exact in paise">
            {Money.formatPaise(Money.multiplyQty(2500, Money.fromRupees(120)))}
            <span className="ml-2 text-slate-400">= 2500 sq.ft × ₹120</span>
          </Row>
          <Row label="In words">
            {Money.formatPaiseInWords(Money.fromRupees(18_50_000))}
          </Row>
          <Row label="Date, anchored to IST">{today}</Row>
        </dl>
      </section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}
