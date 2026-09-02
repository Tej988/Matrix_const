import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClientRepository } from '@mc/shared/repositories/projects'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { QueryError } from '../../components/QueryError'

export function ClientsPage() {
  const user = useCurrentUser()
  const { can } = useAuth()
  const repo = useMemo(() => createClientRepository(db), [])
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')

  const clients = useQuery({ queryKey: ['clients'], queryFn: () => repo.list() })

  const create = useMutation({
    mutationFn: () =>
      repo.create(
        {
          name: name.trim(),
          contactPerson: contactPerson.trim(),
          status: 'ACTIVE',
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
        },
        user.uid,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      setName('')
      setContactPerson('')
      setPhone('')
      setCity('')
      setAdding(false)
    },
  })

  if (clients.isPending) return <p className="p-4 text-slate-500">Loading clients…</p>
  if (clients.isError) {
    return <QueryError error={clients.error} onRetry={() => void clients.refetch()} what="clients" />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Clients</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {clients.data.length} {clients.data.length === 1 ? 'client' : 'clients'}
          </p>
        </div>
        {can('client:write') && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            {adding ? 'Cancel' : 'New client'}
          </button>
        )}
      </header>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
          className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stonede"
                className={inputClass}
              />
            </Field>
            <Field label="Contact person">
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="Rakesh Rao"
                className={inputClass}
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                className={inputClass}
              />
            </Field>
            <Field label="City (optional)">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </Field>
          </div>

          {create.isError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {(create.error as Error).message}
            </p>
          )}

          <button
            type="submit"
            disabled={name.trim() === '' || create.isPending}
            className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {create.isPending ? 'Adding…' : 'Add client'}
          </button>
        </form>
      )}

      {clients.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">No clients yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {clients.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900 dark:text-slate-100">{c.name}</p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                  {[c.contactPerson, c.phone, c.city].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              {c.status === 'INACTIVE' && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 dark:bg-slate-800">
                  inactive
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
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
