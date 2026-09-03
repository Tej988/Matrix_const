import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Permission } from '@mc/shared'
import { useTranslation } from '../i18n/useTranslation'
import { AuthProvider } from '../features/auth/AuthProvider'
import { useAuth } from '../features/auth/authContext'
import { SignInScreen } from '../features/auth/SignInScreen'
import { AwaitingAccessScreen } from '../features/auth/AwaitingAccessScreen'
import { AppShell } from './AppShell'
import { ErrorBoundary } from './ErrorBoundary'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { UsersPage } from '../features/users/UsersPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { ProjectDetailPage } from '../features/projects/ProjectDetailPage'
import { ProjectOverviewTab } from '../features/projects/ProjectOverviewTab'
import {
  ProjectBillsTab,
  ProjectMeasurementsTab,
  ProjectMoneyTab,
  ProjectRateCardTab,
} from '../features/projects/ProjectTabs'
import { ClientsPage } from '../features/clients/ClientsPage'
import { AttendancePage } from '../features/attendance/AttendancePage'
import { LabourPage } from '../features/labour/LabourPage'
import { LabourDetailPage } from '../features/labour/LabourDetailPage'
import { WagesPage } from '../features/wages/WagesPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { SettingsPage } from '../features/settings/SettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Firestore reads are the scarce resource on Spark (RISKS.md R-10).
      // A minute of staleness is invisible to users and cuts reads sharply.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <AuthGate />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

/**
 * Routing does not begin until authentication resolves to one of its four
 * terminal states. Keeping the gate above the router means no protected screen
 * can ever mount for half a frame before being redirected away.
 */
function AuthGate() {
  const { state } = useAuth()
  const { t } = useTranslation()

  switch (state.status) {
    case 'loading':
      return <FullScreenMessage>{t('loading')}</FullScreenMessage>
    case 'signed-out':
      return <SignInScreen />
    case 'unprovisioned':
      return <AwaitingAccessScreen firebaseUser={state.firebaseUser} />
    case 'disabled':
      return <AwaitingAccessScreen firebaseUser={state.firebaseUser} disabled />
    case 'ready':
      return (
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route
              path="projects"
              element={
                <RequirePermission permission="project:read">
                  <ProjectsPage />
                </RequirePermission>
              }
            />
            {/*
                One project, five tabs, one URL each. Nested rather than five
                top-level routes: every one of these is meaningless without a
                project, and the nav was deliberately cut back to six daily
                items (AppShell).

                The permission gates are repeated on the child routes even
                though the tab bar already hides them - the tab bar stops an
                honest mistake, the route gate stops a typed or bookmarked URL.
                Both are convenience; Firestore Rules are the boundary (R-03).
            */}
            <Route
              path="projects/:projectId"
              element={
                <RequirePermission permission="project:read">
                  <ProjectDetailPage />
                </RequirePermission>
              }
            >
              {/* Overview is the default, and `replace` keeps it out of the
                  history so Back from a project returns to the project list
                  rather than bouncing through the redirect. */}
              <Route index element={<ProjectOverviewRedirect />} />
              <Route path="overview" element={<ProjectOverviewTab />} />
              <Route
                path="bills"
                element={
                  <ProjectTabGate permission="bill:read">
                    <ProjectBillsTab />
                  </ProjectTabGate>
                }
              />
              <Route
                path="money"
                element={
                  <ProjectTabGate permission="clientPayment:read">
                    <ProjectMoneyTab />
                  </ProjectTabGate>
                }
              />
              <Route
                path="rate-card"
                element={
                  <ProjectTabGate permission="boq:read">
                    <ProjectRateCardTab />
                  </ProjectTabGate>
                }
              />
              <Route
                path="measurements"
                element={
                  <ProjectTabGate permission="measurement:read">
                    <ProjectMeasurementsTab />
                  </ProjectTabGate>
                }
              />
              {/* An unknown tab is a stale link, not a dead end. */}
              <Route path="*" element={<ProjectOverviewRedirect />} />
            </Route>
            <Route
              path="attendance"
              element={
                <RequirePermission permission="attendance:write">
                  <AttendancePage />
                </RequirePermission>
              }
            />
            <Route
              path="labour"
              element={
                <RequirePermission permission="labour:read">
                  <LabourPage />
                </RequirePermission>
              }
            />
            {/* One person, all of it: their month, their wages, their
                payments. Gated on `labour:read` and not on money - the page
                itself hides every figure from a role without
                `financials:view`, so a supervisor still gets the roster and
                the register. */}
            <Route
              path="labour/:labourId"
              element={
                <RequirePermission permission="labour:read">
                  <LabourDetailPage />
                </RequirePermission>
              }
            />
            {/* Off the nav, still routable: the payroll table is how a whole
                site gets paid out at month end, and the person page links to
                it. */}
            <Route
              path="wages"
              element={
                <RequirePermission permission="wage:read">
                  <WagesPage />
                </RequirePermission>
              }
            />

            <Route
              path="reports"
              element={
                <RequirePermission permission="report:read">
                  <ReportsPage />
                </RequirePermission>
              }
            />
            <Route
              path="clients"
              element={
                <RequirePermission permission="client:read">
                  <ClientsPage />
                </RequirePermission>
              }
            />
            <Route
              path="users"
              element={
                <RequirePermission permission="user:manage">
                  <UsersPage />
                </RequirePermission>
              }
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )
  }
}

/**
 * A permission gate for a route. Note this is convenience, not security -
 * Firestore Rules are the boundary (RISKS.md R-03). Hiding a screen stops an
 * honest mistake; it does not stop anyone determined.
 */
function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: React.ReactNode
}) {
  const { can } = useAuth()
  if (!can(permission)) return <Navigate to="/" replace />
  return children
}

/**
 * The same gate for a project tab, but it falls back to the project's own
 * Overview instead of the dashboard - a supervisor who follows a link to
 * `/projects/x/bills` should land on the project they were sent to, not be
 * thrown out of it.
 *
 * The redirect target is absolute on purpose. A relative `to="overview"`
 * rendered inside the `bills` route resolves against that route's own path and
 * would produce `/projects/x/bills/overview`.
 */
function ProjectTabGate({
  permission,
  children,
}: {
  permission: Permission
  children: React.ReactNode
}) {
  const { can } = useAuth()
  if (!can(permission)) return <ProjectOverviewRedirect />
  return children
}

function ProjectOverviewRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projects/${projectId}/overview`} replace />
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center text-slate-500 dark:text-slate-400">
      {children}
    </div>
  )
}
