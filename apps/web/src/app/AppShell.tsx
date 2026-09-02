import { NavLink, Outlet } from 'react-router-dom'
import type { Permission } from '@mc/shared'
import { useAuth } from '../features/auth/authContext'
import { signOut } from '../lib/auth'
import { useTranslation } from '../i18n/useTranslation'
import { Tour } from '../features/tour/Tour'
import type { StringKey } from '../i18n/strings'

/**
 * The shell. Navigation is derived from permissions, so a supervisor simply
 * does not see Bills or Payments rather than seeing them and being refused
 * (spec section 28 - important actions obvious, nothing else in the way).
 *
 * Only routes that exist are listed. The remaining modules appear in the phase
 * that builds them, because a nav full of dead links teaches users to distrust
 * the nav.
 */
interface NavItem {
  to: string
  labelKey: StringKey
  icon: string
  permission?: Permission
}

const NAV: NavItem[] = [
  { to: '/', labelKey: 'navDashboard', icon: '📊' },
  { to: '/attendance', labelKey: 'navAttendance', icon: '📅', permission: 'attendance:write' },
  { to: '/projects', labelKey: 'navProjects', icon: '🏗️', permission: 'project:read' },
  { to: '/labour', labelKey: 'navLabour', icon: '👷', permission: 'labour:read' },
  { to: '/wages', labelKey: 'navWages', icon: '💰', permission: 'wage:read' },
  { to: '/reports', labelKey: 'navReports', icon: '📄', permission: 'report:read' },
  { to: '/clients', labelKey: 'navClients', icon: '🤝', permission: 'client:read' },
  { to: '/users', labelKey: 'navUsers', icon: '👥', permission: 'user:manage' },
  { to: '/settings', labelKey: 'navSettings', icon: '⚙️' },
]

export function AppShell() {
  const { state, can } = useAuth()
  const { t, locale, setLocale } = useTranslation()
  const profile = state.status === 'ready' ? state.profile : null
  const visible = NAV.filter((item) => !item.permission || can(item.permission))

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {t('appName')}
            </p>
            {profile && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {profile.displayName} &middot; {profile.role.toLowerCase()}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Language toggle, always reachable - section 29. */}
            <button
              type="button"
              onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={locale === 'en' ? 'हिन्दी में बदलें' : 'Switch to English'}
            >
              {locale === 'en' ? 'हिन्दी' : 'EN'}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('signOut')}
            </button>
          </div>
        </div>

        {visible.length > 1 && (
          <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  ].join(' ')
                }
              >
                <span aria-hidden="true">{item.icon}</span>
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <Outlet />
      </main>

      {profile && <Tour role={profile.role} name={profile.displayName} />}
    </div>
  )
}
