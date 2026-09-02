import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClientRepository } from '@mc/shared/repositories/projects'
import type { Client } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

export function ClientsPage() {
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createClientRepository(db), [])
  const queryClient = useQueryClient()

  /** null = closed, 'new' = adding, a Client = editing that one. */
  const [editing, setEditing] = useState<Client | 'new' | null>(null)

  const clients = useQuery({ queryKey: ['clients'], queryFn: () => repo.list() })

  if (clients.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (clients.isError) {
    return (
      <QueryError error={clients.error} onRetry={() => void clients.refetch()} what="clients" />
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {t('clientsTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('countClients', { n: clients.data.length })}
          </p>
        </div>
        {can('client:write') && (
          <button
            type="button"
            onClick={() => setEditing(editing === 'new' ? null : 'new')}
            className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            {editing === 'new' ? t('cancel') : t('newClient')}
          </button>
        )}
      </header>

      {editing !== null && (
        <ClientForm
          key={editing === 'new' ? 'new' : editing.id}
          client={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            void queryClient.invalidateQueries({ queryKey: ['clients'] })
            // Projects carry a denormalised clientName, so a rename here must
            // not leave stale names sitting on project cards.
            void queryClient.invalidateQueries({ queryKey: ['projects'] })
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {clients.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">{t('noClientsYet')}</p>
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
              <div className="flex shrink-0 items-center gap-2">
                {c.status === 'INACTIVE' && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 dark:bg-slate-800">
                    {t('inactive')}
                  </span>
                )}
                {can('client:write') && (
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600"
                  >
                    {t('edit')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One form for both creating and editing.
 *
 * Deliberately shared rather than two near-identical forms: they drift, and the
 * edit path is where a wrong field costs most - a client name flows onto every
 * bill raised against them.
 */
function ClientForm({
  client,
  onDone,
  onCancel,
}: {
  client: Client | null
  onDone: () => void
  onCancel: () => void
}) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const repo = useMemo(() => createClientRepository(db), [])

  const [name, setName] = useState(client?.name ?? '')
  const [contactPerson, setContactPerson] = useState(client?.contactPerson ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [city, setCity] = useState(client?.city ?? '')
  const [status, setStatus] = useState<Client['status']>(client?.status ?? 'ACTIVE')

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        status,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
      }
      if (client) {
        await repo.update(client.id, fields, user.uid)
      } else {
        await repo.create(fields, user.uid)
      }
    },
    onSuccess: onDone,
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('clientName')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stonede"
            className={inputClass}
          />
        </Field>
        <Field label={t('contactPerson')}>
          <input
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Rakesh Rao"
            className={inputClass}
          />
        </Field>
        <Field label={`${t('phone')} (${t('optional')})`}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            className={inputClass}
          />
        </Field>
        <Field label={`${t('city')} (${t('optional')})`}>
          <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {/* Offered only when editing. A client is never created inactive, and
          deactivating is the substitute for deletion - bills reference them. */}
      {client && (
        <Field label={t('status')}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Client['status'])}
            className={inputClass}
          >
            <option value="ACTIVE">{t('active')}</option>
            <option value="INACTIVE">{t('inactive')}</option>
          </select>
        </Field>
      )}

      {save.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {(save.error as Error).message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={name.trim() === '' || save.isPending}
          className="flex-1 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {save.isPending ? t('adding') : client ? t('save') : t('addClient')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-600"
        >
          {t('cancel')}
        </button>
      </div>
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
