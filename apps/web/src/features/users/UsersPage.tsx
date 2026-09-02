import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ROLES, type Role, type UserStatus } from '@mc/types'
import { createUserRepository, type UserRecord } from '@mc/shared/repositories/users'
import { permissionsFor } from '@mc/shared'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'

/**
 * User management. OWNER only, in the UI and independently in Rules.
 *
 * Adding a user needs their Firebase UID rather than an email invitation,
 * because sending an invitation needs a server and there isn't one (ADR-002).
 * The flow instead is: the person signs in, sees the "Waiting for access"
 * screen, reads their account ID off it, and passes it to the owner. Fewer
 * moving parts than an invitation system, and nothing to spoof.
 */
export function UsersPage() {
  const currentUser = useCurrentUser()
  const repo = useMemo(() => createUserRepository(db), [])
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => repo.list(),
  })

  const permissions = useMutation({
    mutationFn: (args: {
      user: UserRecord
      role: Role
      status: UserStatus
    }) =>
      repo.setRoleAndStatus(
        args.user.uid,
        { role: args.role, status: args.status },
        { role: args.user.role, status: args.user.status },
        { uid: currentUser.uid, displayName: currentUser.displayName },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  if (usersQuery.isPending) {
    return <p className="p-4 text-slate-500">Loading users…</p>
  }

  if (usersQuery.isError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-950 dark:text-red-300">
        Could not load users. {(usersQuery.error as Error).message}
      </p>
    )
  }

  const users = usersQuery.data
  const owners = users.filter((u) => u.role === 'OWNER' && u.status === 'ACTIVE')

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Users</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {users.length} {users.length === 1 ? 'person' : 'people'} with access
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {showAdd ? 'Cancel' : 'Add person'}
        </button>
      </header>

      {showAdd && (
        <AddUserForm
          onDone={() => {
            setShowAdd(false)
            void queryClient.invalidateQueries({ queryKey: ['users'] })
          }}
          actorUid={currentUser.uid}
        />
      )}

      {permissions.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {(permissions.error as Error).message}
        </p>
      )}

      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {users.map((user) => {
          const isSelf = user.uid === currentUser.uid
          // Removing the last active owner would lock everyone out of user
          // management permanently, and no code could undo it without the
          // Firebase Console. Refuse it in the UI as well as in Rules.
          const isLastOwner =
            user.role === 'OWNER' && user.status === 'ACTIVE' && owners.length === 1

          return (
            <li key={user.uid} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                  {user.displayName}
                  {isSelf && <span className="ml-2 text-xs text-slate-400">you</span>}
                </p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {permissionsFor(user.role).length} permissions
                </p>
              </div>

              <select
                aria-label={`Role for ${user.displayName}`}
                value={user.role}
                disabled={isSelf || isLastOwner || permissions.isPending}
                onChange={(e) =>
                  permissions.mutate({
                    user,
                    role: e.target.value as Role,
                    status: user.status,
                  })
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={isSelf || isLastOwner || permissions.isPending}
                onClick={() =>
                  permissions.mutate({
                    user,
                    role: user.role,
                    status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                  })
                }
                className={[
                  'rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50',
                  user.status === 'ACTIVE'
                    ? 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                    : 'text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950',
                ].join(' ')}
              >
                {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <strong>When you disable someone, also remove them from the Drive folder.</strong>{' '}
        Drive permissions live outside this app and cannot be revoked from here, so a
        disabled user keeps access to shared files until you unshare the folder
        (RISKS.md R-07).
      </p>
    </div>
  )
}

function AddUserForm({ onDone, actorUid }: { onDone: () => void; actorUid: string }) {
  const repo = useMemo(() => createUserRepository(db), [])
  const [uid, setUid] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('SUPERVISOR')

  const create = useMutation({
    mutationFn: () =>
      repo.create(uid.trim(), { displayName: displayName.trim(), email: email.trim(), role }, actorUid),
    onSuccess: onDone,
  })

  const ready = uid.trim().length > 0 && displayName.trim().length > 0 && email.trim().length > 0

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Ask the person to sign in first. Their <strong>account ID</strong> is shown on the
        waiting-for-access screen &mdash; paste it below.
      </p>

      <Field label="Account ID (UID)">
        <input
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          placeholder="e.g. kJ8s0Xy2..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </Field>

      <Field label="Name">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
        />
      </Field>

      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
        />
      </Field>

      <Field label="Role">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()} &mdash; {permissionsFor(r).length} permissions
            </option>
          ))}
        </select>
      </Field>

      {create.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(create.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready || create.isPending}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {create.isPending ? 'Adding…' : 'Add person'}
      </button>
    </form>
  )
}

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
