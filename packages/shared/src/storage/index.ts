/**
 * The storage boundary - ADR-009.
 *
 * Business code hands over a file and gets back a `StoredFileRef`. It never
 * learns which backend swallowed it: `provider` and `externalId` are the only
 * two things that cross, and they go straight into the `documents/{id}`
 * metadata record without anyone interpreting them.
 *
 * Why an interface when exactly one implementation exists: Drive is a forced
 * choice, not a chosen one. A Spark project cannot provision a Cloud Storage
 * bucket at all (verified - 404), so `FirebaseStorageAdapter` is unbuildable
 * today and becomes trivially buildable the day Blaze is enabled. That swap has
 * to be one line, not a hunt for every component where a Drive file ID leaked.
 *
 * Nothing here touches Firestore, React, or Firebase auth. The adapter takes an
 * access-token supplier instead, so the layer stays testable without a browser.
 */

/** DATABASE.md `documents/{documentId}`.kind. */
export const DOCUMENT_KINDS = [
  'QUOTATION',
  'MEASUREMENT_SHEET',
  'BILL_PDF',
  'PAYMENT_PROOF',
  'EXPENSE_RECEIPT',
  'BANK_STATEMENT',
  'OTHER',
] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const STORAGE_PROVIDERS = ['GOOGLE_DRIVE', 'FIREBASE_STORAGE'] as const
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number]

/**
 * A file that exists somewhere. `externalId` is a Drive file ID today and a
 * Storage object path tomorrow - opaque either way, and only the adapter that
 * produced it may interpret it.
 */
export interface StoredFileRef {
  provider: StorageProvider
  externalId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface UploadInput {
  file: File
  kind: DocumentKind
  projectId: string
}

export interface StorageAdapter {
  upload(input: UploadInput): Promise<StoredFileRef>
  getViewUrl(ref: StoredFileRef): Promise<string>
  /**
   * Destroys the stored file. Financial attachments must NOT go through here -
   * ADR-007 forbids deleting financial history, so those get a metadata
   * tombstone (`documents.status = 'DELETED'`) with the bytes left alone. This
   * method cannot tell the two cases apart; the caller can, and must.
   */
  delete(ref: StoredFileRef): Promise<void>
}

/**
 * Why an enum rather than a message: the caller decides differently for each.
 * `UNAUTHORISED` is worth one silent retry, `QUOTA_EXCEEDED` needs a human with
 * a Google account, `NETWORK` is worth a button. A string blob forces the UI to
 * grep for substrings, which is how "check your connection" ends up shown for a
 * full Drive.
 */
export const STORAGE_FAILURES = [
  'NOT_CONFIGURED',
  'UNAUTHORISED',
  'QUOTA_EXCEEDED',
  'TOO_LARGE',
  'NETWORK',
  'NOT_FOUND',
  'UNKNOWN',
] as const
export type StorageFailure = (typeof STORAGE_FAILURES)[number]

export class StorageError extends Error {
  constructor(
    readonly failure: StorageFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'StorageError'
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError
}

/**
 * Supplies a Drive OAuth access token, asking the user for the scope if it has
 * never been granted. `forceRefresh` is set after a 401: the cached token is
 * known-dead and returning it again would just burn the one retry.
 *
 * A function rather than a token so the adapter never imports Firebase auth,
 * and so a test can hand it a constant.
 */
export type AccessTokenSupplier = (forceRefresh: boolean) => Promise<string | null>
