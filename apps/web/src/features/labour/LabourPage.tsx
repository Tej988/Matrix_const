import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLabourRepository } from '@mc/shared/repositories/labour'
import { createProjectRepository } from '@mc/shared/repositories/projects'
import { Money, Dates } from '@mc/shared'
import { LABOUR_ROLES, type Labour, type LabourRole, type Paise } from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { Amount } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

/**
 * The roster. Everyone currently working, and a way to reach one person's page.
 *
 * The list stays deliberately thin: a name, what they do, what they cost a day.
 * Everything else about somebody - their month, their wages, what they have
 * been paid, whether they are still with us - is one question about one person
 * and lives on `LabourDetailPage`.
 */
export function LabourPage() {
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createLabourRepository(db), [])
  const projectRepo = useMemo(() => createProjectRepository(db), [])
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [assigning, setAssigning] = useState<Labour | null>(null)
  const [showFormer, setShowFormer] = useState(false)

  const labour = useQuery({ queryKey: ['labour'], queryFn: () => repo.list() })
  const projects = useQuery({
    queryKey: ['projects', user.uid, user.role],
    queryFn: () => projectRepo.listForUser(user.uid, user.role),
  })

  if (labour.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>
  if (labour.isError) {
    return (
      <QueryError
        error={labour.error}
        onRetry={() => void labour.refetch()}
        what={t('labourTitle')}
      />
    )
  }

  const showMoney = can('financials:view')

  /*
   * Former workers are off the roster by default but never out of the system -
   * their attendance and wage history is why the record still exists at all
   * (ADR-007). The toggle is here so somebody who left can be found and, if it
   * comes to it, brought back.
   */
  const active = labour.data.filter((l) => l.status !== 'INACTIVE')
  const former = labour.data.filter((l) => l.status === 'INACTIVE')
  const visible = showFormer ? [...active, ...former] : active

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {t('labourTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('countPeople', { n: active.length })}
          </p>
        </div>
        {can('labour:write') && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {adding ? t('cancel') : t('addPerson')}
          </button>
        )}
      </header>

      {adding && (
        <AddLabourForm
          onDone={() => {
            setAdding(false)
            void queryClient.invalidateQueries({ queryKey: ['labour'] })
          }}
        />
      )}

      {assigning && projects.data && (
        <AssignForm
          labour={assigning}
          projects={projects.data.map((p) => ({ id: p.id, name: p.name }))}
          onDone={() => {
            setAssigning(null)
            void queryClient.invalidateQueries({ queryKey: ['roster'] })
          }}
        />
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">{t('noLabourYet')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {visible.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 p-4">
              {/* The whole name block is the link, and it is 44px tall: this is
                  tapped with a thumb, on site, one-handed. */}
              <Link
                to={`/labour/${l.id}`}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
              >
                <p className="truncate font-medium text-slate-900 dark:text-slate-100">{l.name}</p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                  {l.role.replace('_', ' ').toLowerCase()}
                  {l.phone && ` · ${l.phone}`}
                  {l.status === 'INACTIVE' && ` · ${t('inactive')}`}
                </p>
              </Link>
              {showMoney && (
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  <Amount paise={l.defaultDailyWagePaise} /> {t('perDay')}
                </span>
              )}
              {can('labour:write') && l.status !== 'INACTIVE' && (
                <button
                  type="button"
                  onClick={() => setAssigning(l)}
                  className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
                >
                  {t('assign')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {former.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFormer((v) => !v)}
          className="min-h-11 text-sm text-slate-500 underline underline-offset-2 dark:text-slate-400"
        >
          {showFormer ? t('hideFormerWorkers') : t('showFormerWorkers')} ({former.length})
        </button>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">{t('privacyNote')}</p>
    </div>
  )
}

function AddLabourForm({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const repo = useMemo(() => createLabourRepository(db), [])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<LabourRole>('HELPER')
  const [wageInput, setWageInput] = useState('')

  let wage: Paise | null = null
  try {
    wage = wageInput.trim() ? Money.parseRupees(wageInput) : null
  } catch {
    wage = null
  }

  const create = useMutation({
    mutationFn: () => {
      if (!wage) throw new Error(t('enterDailyWage'))
      return repo.create(
        {
          name: name.trim(),
          role,
          defaultDailyWagePaise: wage,
          status: 'ACTIVE',
          joiningDate: Dates.todayKey(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
        user.uid,
      )
    },
    onSuccess: onDone,
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700"
    >
      <label className="block">
        <span className={labelClass}>{t('name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ramesh"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{`${t('phone')} (${t('optional')})`}</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>{t('work')}</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as LabourRole)}
          className={inputClass}
        >
          {LABOUR_ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>{t('dailyWage')}</span>
        <input
          value={wageInput}
          onChange={(e) => setWageInput(e.target.value)}
          inputMode="decimal"
          placeholder="700"
          className={inputClass}
        />
        {wage !== null && (
          <span className="mt-1 block text-sm text-slate-500">
            <Amount paise={wage} /> {t('perDay')}
          </span>
        )}
      </label>
      {create.isError && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2 dark:text-red-400">
          {(create.error as Error).message}
        </p>
      )}
      <button
        type="submit"
        disabled={name.trim() === '' || wage === null || create.isPending}
        className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 sm:col-span-2 dark:bg-slate-100 dark:text-slate-900"
      >
        {create.isPending ? t('adding') : t('addPerson')}
      </button>
    </form>
  )
}

function AssignForm({
  labour,
  projects,
  onDone,
}: {
  labour: Labour
  projects: { id: string; name: string }[]
  onDone: () => void
}) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const repo = useMemo(() => createLabourRepository(db), [])
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [rateInput, setRateInput] = useState(String(labour.defaultDailyWagePaise / 100))

  let rate: Paise | null = null
  try {
    rate = rateInput.trim() ? Money.parseRupees(rateInput) : null
  } catch {
    rate = null
  }

  const assign = useMutation({
    mutationFn: () => {
      if (!rate || !projectId) throw new Error(t('chooseProjectAndRate'))
      return repo.assign(
        { labour, projectId, startDate: Dates.todayKey(), dailyRatePaise: rate },
        user.uid,
      )
    },
    onSuccess: onDone,
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        assign.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">
        {t('assign')} {labour.name}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('project')}</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputClass}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('rateOnProject')}</span>
          <input
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('rateVariesHint')}</p>
      <button
        type="submit"
        disabled={assign.isPending || !rate}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {assign.isPending ? t('assigning') : t('assignTo')}
      </button>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
