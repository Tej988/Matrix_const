import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Permission } from '@mc/shared'
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
import { ClientsPage } from '../features/clients/ClientsPage'
import { AttendancePage } from '../features/attendance/AttendancePage'
import { LabourPage } from '../features/labour/LabourPage'
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

  switch (state.status) {
    case 'loading':
      return <FullScreenMessage>Loading…</FullScreenMessage>
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
            <Route
              path="projects/:projectId"
              element={
                <RequirePermission permission="project:read">
                  <ProjectDetailPage />
                </RequirePermission>
              }
            />
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

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center text-slate-500 dark:text-slate-400">
      {children}
    </div>
  )
}
