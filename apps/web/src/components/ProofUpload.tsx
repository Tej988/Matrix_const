import { useEffect, useId, useMemo, useState, type ChangeEvent } from 'react'
import { createGoogleDriveAdapter, isStorageError, type DocumentKind } from '@mc/shared'
import type { Locale } from '@mc/types'
import { createPaymentRepository } from '@mc/shared/repositories/payments'
import { db } from '../lib/firebase'
import { env } from '../lib/env'
import { describeAuthError, getDriveAccessToken, requestDriveAccess } from '../lib/auth'
import { describeFirestoreError } from '../lib/firestoreErrors'
import { useCurrentUser } from '../features/auth/authContext'
import { useTranslation } from '../i18n/useTranslation'

/**
 * A photo or PDF of a payment, filed in Google Drive - ADR-009.
 *
 * THE RULE THIS COMPONENT EXISTS TO OBEY: a failed upload must never stop the
 * money being recorded. Nothing here can block, cancel, or roll back the write
 * it sits next to. It uploads on its own, reports what happened, and the form
 * around it submits regardless. The worst case is a payment with no photo,
 * which is exactly how the system worked before this component existed.
 *
 * The Drive scope is requested HERE, on first use, rather than at sign-in -
 * incremental authorization, see firebase.ts. Anyone who never attaches
 * anything is never asked for access to their Drive.
 */

export interface ProofResult {
  /** The `documents/{id}` record, once the file is really in Drive. */
  documentId: string | null
  /** A file was chosen and did not survive. The caller warns; it does not stop. */
  failed: boolean
}

type Phase =
  | { phase: 'empty' }
  | { phase: 'uploading'; fileName: string }
  | { phase: 'stored'; fileName: string; viewUrl: string }
  | { phase: 'failed'; fileName: string; message: string }

export function ProofUpload({
  projectId,
  kind = 'PAYMENT_PROOF',
  linkedRefType,
  linkedRefId,
  onChange,
  disabled = false,
}: {
  projectId: string
  kind?: DocumentKind
  linkedRefType: string
  /** Known only when attaching to something that already exists (the retry path). */
  linkedRefId?: string
  onChange: (result: ProofResult) => void
  disabled?: boolean
}) {
  const { t, locale } = useTranslation()
  const actor = useCurrentUser()
  const repo = useMemo(() => createPaymentRepository(db), [])
  // Two of these can be on screen at once - the pay form and the retry banner -
  // so the label cannot point at a hardcoded id.
  const inputId = useId()

  const [state, setState] = useState<Phase>({ phase: 'empty' })
  const [preview, setPreview] = useState<string | null>(null)
  const [chosen, setChosen] = useState<File | null>(null)

  /* An object URL is a live handle on the file. Left unrevoked, a supervisor
     photographing twenty receipts in one session leaks twenty of them. */
  useEffect(() => {
    if (preview === null) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const adapter = useMemo(
    () =>
      createGoogleDriveAdapter({
        folderId: env.VITE_DRIVE_FOLDER_ID,
        /*
         * The token supplier, not a token: the adapter must never know Firebase
         * exists. `forceRefresh` arrives after a 401, meaning the cached token
         * is already dead and handing it back would waste the single retry.
         */
        getAccessToken: async (forceRefresh: boolean) => {
          const cached = getDriveAccessToken()
          if (cached !== null && !forceRefresh) return cached
          return requestDriveAccess()
        },
      }),
    [],
  )

  async function upload(file: File) {
    setState({ phase: 'uploading', fileName: file.name })
    onChange({ documentId: null, failed: false })

    try {
      const ref = await adapter.upload({ file, kind, projectId })
      const documentId = await repo.recordDocument(
        {
          ref,
          kind,
          projectId,
          linkedRefType,
          ...(linkedRefId ? { linkedRefId } : {}),
        },
        { uid: actor.uid, displayName: actor.displayName },
      )
      setState({ phase: 'stored', fileName: ref.fileName, viewUrl: await adapter.getViewUrl(ref) })
      onChange({ documentId, failed: false })
    } catch (error) {
      // Reported, never rethrown. A throw here would reach the form's submit
      // handler and take the payment down with it.
      setState({ phase: 'failed', fileName: file.name, message: describeProofError(error, locale) })
      onChange({ documentId: null, failed: true })
    }
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clearing lets the same file be picked again after a failure - otherwise
    // the change event never fires and "try again" appears to do nothing.
    event.target.value = ''
    if (!file) return

    setChosen(file)
    setPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    void upload(file)
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className={labelClass}>
        {t('paymentProof')} <span className="font-normal text-slate-400">({t('optional')})</span>
      </label>

      <div className="flex items-start gap-3">
        <Thumbnail preview={preview} chosen={chosen} />

        <div className="min-w-0 flex-1 space-y-1">
          <input
            id={inputId}
            type="file"
            accept="image/*,application/pdf"
            /* On a phone this offers the rear camera directly, which is the
               whole point - the proof is a photo of a receipt or a UPI screen,
               taken on the spot (ADR-001: no native camera pipeline). */
            capture="environment"
            onChange={onFileChosen}
            disabled={disabled || state.phase === 'uploading'}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50 dark:text-slate-300 dark:file:bg-slate-100 dark:file:text-slate-900"
          />

          {state.phase === 'uploading' && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {t('saving')} {state.fileName}
            </p>
          )}

          {state.phase === 'stored' && (
            <p className="truncate text-xs text-green-700 dark:text-green-400">
              {t('done')} &mdash;{' '}
              <a
                href={state.viewUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {state.fileName}
              </a>
            </p>
          )}

          {state.phase === 'failed' && (
            <div className="space-y-1">
              <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (chosen) void upload(chosen)
                }}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium dark:border-slate-600"
              >
                {t('tryAgain')}
              </button>
            </div>
          )}

          {state.phase === 'empty' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('proofHint')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** A PDF has nothing to show, so it gets a label rather than a broken image. */
function Thumbnail({ preview, chosen }: { preview: string | null; chosen: File | null }) {
  if (preview !== null) {
    return (
      <img
        src={preview}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
      />
    )
  }

  if (chosen) {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
        PDF
      </span>
    )
  }

  return null
}

/**
 * Three different subsystems can fail here and each has its own vocabulary:
 * Drive (StorageError), the Google consent popup (auth/*), and the metadata
 * write (Firestore). Showing "could not sign in" for a full Drive sends someone
 * down the wrong path entirely.
 */
function describeProofError(error: unknown, locale: Locale): string {
  if (isStorageError(error)) return error.message

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''

  if (code.startsWith('auth/')) return describeAuthError(error)
  return describeFirestoreError(error, locale).message
}

const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
