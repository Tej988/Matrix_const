import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import { createBillRepository } from '@mc/shared/repositories/bills'
import { Dates, Money, clientPaymentKey, needsDisambiguation, billOutstanding } from '@mc/shared'
import {
  CLIENT_PAYMENT_METHODS,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type ClientPaymentMethod,
  type ExpenseCategory,
  type Paise,
  type PaymentMethod,
  type Project,
} from '@mc/types'
import { db } from '../../lib/firebase'
import { useAuth, useCurrentUser } from '../auth/authContext'
import { AmountWithWords } from '../../components/Money'
import { QueryError } from '../../components/QueryError'
import { useTranslation } from '../../i18n/useTranslation'

/** Money in and money out, on the project page. Sections 8, 9 and 16. */
export function FinanceSection({ project }: { project: Project }) {
  const user = useCurrentUser()
  const { can } = useAuth()
  const { t } = useTranslation()
  const repo = useMemo(() => createPaymentRepository(db), [])
  const billRepo = useMemo(() => createBillRepository(db), [])
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'none' | 'receipt' | 'expense'>('none')
  const [error, setError] = useState<string | null>(null)

  const payments = useQuery({
    queryKey: ['client-payments', project.id],
    queryFn: () => repo.listClientPayments(project.id),
  })
  const expenses = useQuery({
    queryKey: ['expenses', project.id],
    queryFn: () => repo.listExpenses(project.id),
  })
  const bills = useQuery({
    queryKey: ['bills', project.id],
    queryFn: () => billRepo.listForProject(project.id),
  })

  const refresh = () => {
    for (const key of ['client-payments', 'expenses', 'bills', 'project-summary']) {
      void queryClient.invalidateQueries({ queryKey: [key, project.id] })
    }
  }

  const receipt = useMutation({
    mutationFn: (input: {
      amountPaise: Paise
      date: string
      method: ClientPaymentMethod
      reference: string
      billId?: string
    }) =>
      repo.recordClientPayment(
        {
          projectId: project.id,
          clientId: project.clientId,
          amountPaise: input.amountPaise,
          date: Dates.dateKey(input.date),
          method: input.method,
          reference: input.reference,
          idempotencyKey: clientPaymentKey({
            projectId: project.id,
            amountPaise: input.amountPaise,
            date: Dates.dateKey(input.date),
            reference: input.reference,
          }),
          ...(input.billId ? { billId: input.billId } : {}),
        },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: () => {
      setMode('none')
      setError(null)
      refresh()
    },
    onError: (e) => setError((e as Error).message),
  })

  const expense = useMutation({
    mutationFn: (input: {
      category: ExpenseCategory
      amountPaise: Paise
      date: string
      description: string
      paymentMethod: PaymentMethod
    }) =>
      repo.recordExpense(
        { ...input, projectId: project.id, date: Dates.dateKey(input.date) },
        { uid: user.uid, displayName: user.displayName },
      ),
    onSuccess: () => {
      setMode('none')
      setError(null)
      refresh()
    },
    onError: (e) => setError((e as Error).message),
  })

  if (!can('clientPayment:read')) return null
  if (payments.isPending || expenses.isPending)
    return <p className="text-slate-500">{t('loading')}</p>
  if (payments.isError) {
    return (
      <QueryError error={payments.error} onRetry={() => void payments.refetch()} what="payments" />
    )
  }

  const unpaidBills = (bills.data ?? []).filter(
    (b) => b.status !== 'CANCELLED' && billOutstanding(b) > 0,
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('paymentsAndExpenses')}
        </h2>
        <div className="flex gap-2">
          {can('clientPayment:create') && (
            <button
              type="button"
              onClick={() => setMode(mode === 'receipt' ? 'none' : 'receipt')}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {mode === 'receipt' ? t('cancel') : t('moneyReceived')}
            </button>
          )}
          {can('expense:write') && (
            <button
              type="button"
              onClick={() => setMode(mode === 'expense' ? 'none' : 'expense')}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium dark:border-slate-600"
            >
              {mode === 'expense' ? t('cancel') : t('addExpense')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {mode === 'receipt' && (
        <ReceiptForm
          bills={unpaidBills.map((b) => ({
            id: b.id,
            label: `${b.billNumber} — ${Money.formatPaise(billOutstanding(b))} ${t('due')}`,
          }))}
          onSubmit={(v) => receipt.mutate(v)}
          pending={receipt.isPending}
        />
      )}

      {mode === 'expense' && (
        <ExpenseForm onSubmit={(v) => expense.mutate(v)} pending={expense.isPending} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('moneyReceived')} empty={t('noPaymentsYet')}>
          {(payments.data ?? []).map((p) => (
            <Row
              key={p.id}
              primary={Money.formatPaise(p.amountPaise)}
              secondary={`${Dates.formatDateKey(p.date)} · ${p.method.toLowerCase()}${p.bankReference ? ` · ${p.bankReference}` : ''}`}
              badge={p.status !== 'CONFIRMED' ? p.status.toLowerCase() : undefined}
            />
          ))}
        </Panel>

        <Panel title={t('expenses')} empty={t('noExpensesYet')}>
          {(expenses.data ?? []).map((e) => (
            <Row
              key={e.id}
              primary={Money.formatPaise(e.amountPaise)}
              secondary={`${Dates.formatDateKey(e.date)} · ${e.category.toLowerCase()} · ${e.description}`}
            />
          ))}
        </Panel>
      </div>
    </section>
  )
}

function Panel({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  const hasItems = items.filter(Boolean).length > 0
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <p className="border-b border-slate-200 p-3 text-xs font-medium tracking-wide text-slate-500 uppercase dark:border-slate-700">
        {title}
      </p>
      {hasItems ? (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">{children}</ul>
      ) : (
        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</p>
      )}
    </div>
  )
}

function Row({
  primary,
  secondary,
  badge,
}: {
  primary: string
  secondary: string
  badge?: string | undefined
}) {
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 tabular-nums dark:text-slate-100">{primary}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{secondary}</p>
      </div>
      {badge && (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {badge}
        </span>
      )}
    </li>
  )
}

function ReceiptForm({
  bills,
  onSubmit,
  pending,
}: {
  bills: { id: string; label: string }[]
  onSubmit: (v: {
    amountPaise: Paise
    date: string
    method: ClientPaymentMethod
    reference: string
    billId?: string
  }) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const [amountInput, setAmountInput] = useState('')
  const [date, setDate] = useState(Dates.todayKey() as string)
  const [method, setMethod] = useState<ClientPaymentMethod>('NEFT')
  const [reference, setReference] = useState('')
  const [billId, setBillId] = useState('')

  let amount: Paise | null = null
  try {
    amount = amountInput.trim() ? Money.parseRupees(amountInput) : null
  } catch {
    amount = null
  }

  const ambiguous = needsDisambiguation(reference)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (amount)
          onSubmit({ amountPaise: amount, date, method, reference, ...(billId ? { billId } : {}) })
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('amountReceived')}</span>
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            placeholder="2,00,000"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('date')}</span>
          <input
            type="date"
            value={date}
            max={Dates.todayKey()}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('method')}</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ClientPaymentMethod)}
            className={inputClass}
          >
            {CLIENT_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('reference')}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR number"
            className={inputClass}
          />
        </label>
      </div>

      {bills.length > 0 && (
        <label className="block">
          <span className={labelClass}>{`${t('againstBill')} (${t('optional')})`}</span>
          <select value={billId} onChange={(e) => setBillId(e.target.value)} className={inputClass}>
            <option value="">{t('notLinkedToBill')}</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {amount !== null && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          <AmountWithWords paise={amount} />
        </p>
      )}

      {ambiguous && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t('noReferenceWarning')}
        </p>
      )}

      <button
        type="submit"
        disabled={amount === null || amount <= 0 || pending}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? t('recording') : t('recordReceipt')}
      </button>
    </form>
  )
}

function ExpenseForm({
  onSubmit,
  pending,
}: {
  onSubmit: (v: {
    category: ExpenseCategory
    amountPaise: Paise
    date: string
    description: string
    paymentMethod: PaymentMethod
  }) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const [amountInput, setAmountInput] = useState('')
  const [date, setDate] = useState(Dates.todayKey() as string)
  const [category, setCategory] = useState<ExpenseCategory>('MATERIAL')
  const [description, setDescription] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')

  let amount: Paise | null = null
  try {
    amount = amountInput.trim() ? Money.parseRupees(amountInput) : null
  } catch {
    amount = null
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (amount) onSubmit({ category, amountPaise: amount, date, description, paymentMethod })
      }}
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('amount')}</span>
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('date')}</span>
          <input
            type="date"
            value={date}
            max={Dates.todayKey()}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t('category')}</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className={inputClass}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('paidBy')}</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className={inputClass}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>{t('whatWasItFor')}</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Cement, 20 bags"
          className={inputClass}
        />
      </label>

      {category === 'LABOUR' && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t('labourExpenseWarning')}
        </p>
      )}

      <button
        type="submit"
        disabled={amount === null || amount <= 0 || description.trim() === '' || pending}
        className="w-full rounded-xl bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? t('recording') : t('recordExpense')}
      </button>
    </form>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800'
const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
