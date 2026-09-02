import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClientRepository, createProjectRepository } from '@mc/shared/repositories/projects'
import { Money, Dates } from '@mc/shared'
import { NO_TAX, PROJECT_STATUSES, type ProjectStatus } from '@mc/types'
import { db } from '../../lib/firebase'
import { useCurrentUser } from '../auth/authContext'
import { AmountWithWords } from '../../components/Money'
import { useTranslation } from '../../i18n/useTranslation'

export function NewProjectForm({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser()
  const { t } = useTranslation()
  const projects = useMemo(() => createProjectRepository(db), [])
  const clients = useMemo(() => createClientRepository(db), [])
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [clientId, setClientId] = useState('')
  const [contractInput, setContractInput] = useState('')
  const [startDate, setStartDate] = useState(Dates.todayKey() as string)
  const [status, setStatus] = useState<ProjectStatus>('ACTIVE')
  const [siteAddress, setSiteAddress] = useState('')

  const clientList = useQuery({ queryKey: ['clients'], queryFn: () => clients.list() })

  /**
   * Parse as the user types so the amount in words appears live. A misplaced
   * zero in a contract value is a costly mistake, and reading
   * "eighteen lakh fifty thousand" back is what catches it (spec section 28).
   */
  let contractPaise: ReturnType<typeof Money.parseRupees> | null = null
  let parseError: string | null = null
  if (contractInput.trim() !== '') {
    try {
      contractPaise = Money.parseRupees(contractInput)
    } catch {
      parseError = t('enterAmountLike')
    }
  }

  const selectedClient = clientList.data?.find((c) => c.id === clientId)

  const create = useMutation({
    mutationFn: async () => {
      if (!contractPaise || !selectedClient) throw new Error(t('formIncomplete'))
      return projects.create(
        {
          name: name.trim(),
          code: code.trim(),
          clientId: selectedClient.id,
          clientName: selectedClient.name,
          contractValuePaise: contractPaise,
          startDate: Dates.dateKey(startDate),
          status,
          taxProfile: NO_TAX,
          ...(siteAddress.trim() ? { siteAddress: siteAddress.trim() } : {}),
        },
        { uid: user.uid, displayName: user.displayName },
        Dates.now(),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      onDone()
    },
  })

  const ready = name.trim() !== '' && clientId !== '' && contractPaise !== null && contractPaise > 0

  if (clientList.isPending) return <p className="p-4 text-slate-500">{t('loading')}</p>

  if ((clientList.data?.length ?? 0) === 0) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t('addClientFirst')}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <Field label={t('projectName')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tata Project Limited - Agra"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('shortCode')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="TPL-AGR"
            className={inputClass}
          />
        </Field>

        <Field label={t('client')}>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={inputClass}
          >
            <option value="">{t('chooseClient')}</option>
            {clientList.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t('contractValue')}>
        <input
          value={contractInput}
          onChange={(e) => setContractInput(e.target.value)}
          inputMode="decimal"
          placeholder="18,50,000"
          className={inputClass}
        />
        {parseError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{parseError}</p>}
        {contractPaise !== null && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            <AmountWithWords paise={contractPaise} />
          </p>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('startDate')}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('status')}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className={inputClass}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={`${t('siteAddress')} (${t('optional')})`}>
        <input
          value={siteAddress}
          onChange={(e) => setSiteAddress(e.target.value)}
          className={inputClass}
        />
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
        {create.isPending ? t('creating') : t('createProject')}
      </button>
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
