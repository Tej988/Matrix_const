import type { DateKey } from '@mc/types'
import { todayKey } from '../datetime/index'
import {
  StorageError,
  type AccessTokenSupplier,
  type DocumentKind,
  type StorageAdapter,
  type StorageFailure,
  type StoredFileRef,
  type UploadInput,
} from './index'

/**
 * Google Drive, via the REST API v3 - ADR-009.
 *
 * We talk to the wire directly rather than loading `gapi`: the whole surface we
 * need is three HTTP calls, and the client library is ~100 KB plus a second
 * async loader race at first paint.
 *
 * Everything the adapter decides - the file name, the metadata, the multipart
 * frame, what an error means - is a pure function below and unit-tested. The
 * impure part is the `fetch` call, which is a shell around them.
 */

export const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files'
export const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'

/**
 * Drive's multipart endpoint stops at 5 MiB; past that it wants a resumable
 * session. A modern phone camera clears 5 MiB regularly, so this is a real
 * limit and not a theoretical one - we reject before spending the upload rather
 * than after, and say so. Resumable upload is the fix when it starts hurting.
 */
export const MAX_MULTIPART_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// Pure: naming, metadata, framing, error classification
// ---------------------------------------------------------------------------

/**
 * Every file in the business lands in ONE shared folder (R-06), so three
 * supervisors uploading `IMG_0001.jpg` on the same morning is the normal case,
 * not the edge case. Prefixing with kind and date makes the folder readable to
 * a human who has only Drive in front of them - which is exactly the situation
 * if the Firestore metadata is ever lost.
 */
export function driveFileName(input: {
  kind: DocumentKind
  fileName: string
  on: DateKey | string
}): string {
  return `${input.kind}_${input.on}_${sanitiseFileName(input.fileName)}`
}

/** Drive tolerates most names; a slash or a newline still makes one unusable. */
export function sanitiseFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned === '' ? 'attachment' : cleaned
}

export interface DriveFileMetadata {
  name: string
  mimeType: string
  parents?: string[]
  /**
   * Drive is outside Firestore's world and outside its Rules. Stamping the
   * project and kind onto the file itself means an orphaned upload can still be
   * traced back to what it was evidence for.
   */
  appProperties: Record<string, string>
}

export function driveFileMetadata(input: {
  fileName: string
  mimeType: string
  kind: DocumentKind
  projectId: string
  folderId?: string | undefined
  on: DateKey | string
}): DriveFileMetadata {
  return {
    name: driveFileName({ kind: input.kind, fileName: input.fileName, on: input.on }),
    mimeType: input.mimeType,
    ...(input.folderId ? { parents: [input.folderId] } : {}),
    appProperties: {
      app: 'matrix-const',
      kind: input.kind,
      projectId: input.projectId,
      uploadedOn: String(input.on),
    },
  }
}

export function multipartContentType(boundary: string): string {
  return `multipart/related; boundary=${boundary}`
}

/**
 * The `multipart/related` frame Drive expects: a JSON metadata part, then the
 * bytes, then a closing delimiter. Returned as parts rather than a string so
 * the binary half never passes through a JS string, where a lone surrogate
 * would corrupt it.
 */
export function multipartBody(
  boundary: string,
  metadata: DriveFileMetadata,
  mimeType: string,
  content: BlobPart,
): BlobPart[] {
  return [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--\r\n`,
  ]
}

/**
 * Drive's own viewer, derived rather than fetched. `webViewLink` costs a round
 * trip and returns precisely this string.
 */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

/**
 * Drive overloads 403 badly: an expired token, a missing scope and a Drive with
 * no space left all arrive as 403, and only the reason string in the body tells
 * them apart. Getting this wrong means retrying forever against a full account,
 * or telling someone to free up space when they only needed to re-consent.
 */
export function classifyDriveError(status: number, body: string): StorageFailure {
  if (status === 401) return 'UNAUTHORISED'
  if (status === 413) return 'TOO_LARGE'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'NETWORK'
  if (status >= 500) return 'NETWORK'
  if (status === 403) {
    if (/storageQuotaExceeded|quotaExceeded/i.test(body)) return 'QUOTA_EXCEEDED'
    // Transient throttling, not a permission problem - worth another go later.
    if (/rateLimitExceeded/i.test(body)) return 'NETWORK'
    return 'UNAUTHORISED'
  }
  return 'UNKNOWN'
}

/** Plain English, because this is what the user reads when an upload fails. */
export function describeStorageFailure(failure: StorageFailure): string {
  switch (failure) {
    case 'NOT_CONFIGURED':
      return 'No Google Drive folder is set up yet. Ask the owner to add it in Settings.'
    case 'UNAUTHORISED':
      return 'Google Drive access was not granted. The payment is saved either way.'
    case 'QUOTA_EXCEEDED':
      return 'This Google account is out of Drive space. Free some up and attach it again.'
    case 'TOO_LARGE':
      return 'That file is too large to attach. Anything under 5 MB works.'
    case 'NETWORK':
      return 'Could not reach Google Drive. Check your connection and try again.'
    case 'NOT_FOUND':
      return 'That file is no longer in Google Drive.'
    case 'UNKNOWN':
      return 'Could not attach the file.'
  }
}

export function exceedsMultipartLimit(sizeBytes: number): boolean {
  return sizeBytes > MAX_MULTIPART_BYTES
}

/**
 * The boundary only has to not appear in the payload, so `randomUUID` is
 * overkill - but it is also absent on an insecure origin, which is exactly how
 * someone tests on their phone against a dev machine's LAN address. Falling
 * back keeps attachments working there instead of failing every upload for a
 * reason nobody would guess.
 */
function randomBoundary(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `mc-${uuid}`
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface GoogleDriveAdapterConfig {
  /** `VITE_DRIVE_FOLDER_ID`. Absent means uploads are refused - see below. */
  folderId: string | undefined
  getAccessToken: AccessTokenSupplier
  /** Injected for tests; defaults to the global. */
  fetchImpl?: typeof fetch
}

export function createGoogleDriveAdapter(config: GoogleDriveAdapterConfig): StorageAdapter {
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis)

  /**
   * One request, and at most one repeat of it.
   *
   * The Drive access token lives about an hour and Firebase will not refresh
   * it, so a token acquired at 9am is dead by 10:15 while the Firebase session
   * is perfectly healthy (ADR-009, "two token lifetimes"). The user should not
   * have to notice that. One retry with a forced-fresh token covers it; a
   * second failure is a real problem and gets reported rather than looped over.
   */
  async function authorisedFetch(
    url: string,
    init: (token: string) => RequestInit,
  ): Promise<Response> {
    let token = await requireToken(false)
    let response = await send(url, init(token))

    if (
      !response.ok &&
      classifyDriveError(response.status, await peekBody(response)) === 'UNAUTHORISED'
    ) {
      token = await requireToken(true)
      response = await send(url, init(token))
    }

    return response
  }

  async function requireToken(forceRefresh: boolean): Promise<string> {
    const token = await config.getAccessToken(forceRefresh)
    if (!token) {
      throw new StorageError('UNAUTHORISED', describeStorageFailure('UNAUTHORISED'))
    }
    return token
  }

  /**
   * A dropped connection rejects the fetch promise rather than returning a
   * status, and on a construction site that is the ordinary case, not the
   * exception. Translated here so callers only ever handle StorageError.
   */
  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init)
    } catch (cause) {
      throw new StorageError('NETWORK', describeStorageFailure('NETWORK'), { cause })
    }
  }

  async function fail(response: Response): Promise<never> {
    const failure = classifyDriveError(response.status, await peekBody(response))
    throw new StorageError(failure, describeStorageFailure(failure))
  }

  return {
    async upload(input: UploadInput): Promise<StoredFileRef> {
      /*
       * No folder means Drive would drop the file at the root of whoever is
       * signed in - scattered across personal Drives, invisible to the owner,
       * and worse than not uploading at all. Refuse loudly instead.
       */
      if (!config.folderId) {
        throw new StorageError('NOT_CONFIGURED', describeStorageFailure('NOT_CONFIGURED'))
      }

      if (exceedsMultipartLimit(input.file.size)) {
        throw new StorageError('TOO_LARGE', describeStorageFailure('TOO_LARGE'))
      }

      const mimeType = input.file.type || 'application/octet-stream'
      const metadata = driveFileMetadata({
        fileName: input.file.name,
        mimeType,
        kind: input.kind,
        projectId: input.projectId,
        folderId: config.folderId,
        on: todayKey(),
      })

      const boundary = randomBoundary()
      // A Blob, not a stream: the retry above has to be able to send the body
      // a second time, and a stream can only be read once.
      const body = new Blob(multipartBody(boundary, metadata, mimeType, input.file))

      const response = await authorisedFetch(
        `${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType,size`,
        (token) => ({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': multipartContentType(boundary),
          },
          body,
        }),
      )

      if (!response.ok) await fail(response)

      const created = (await response.json()) as { id?: string; size?: string }
      if (!created.id) {
        throw new StorageError('UNKNOWN', describeStorageFailure('UNKNOWN'))
      }

      return {
        provider: 'GOOGLE_DRIVE',
        externalId: created.id,
        fileName: metadata.name,
        mimeType,
        // Drive returns size as a string; trust our own count over parsing it.
        sizeBytes: input.file.size,
      }
    },

    // `async` so a bad ref rejects rather than throwing synchronously - a
    // caller awaiting the contract should not also need a try/catch around it.
    async getViewUrl(ref: StoredFileRef): Promise<string> {
      assertDrive(ref)
      return driveViewUrl(ref.externalId)
    },

    async delete(ref: StoredFileRef): Promise<void> {
      assertDrive(ref)
      const response = await authorisedFetch(
        `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(ref.externalId)}`,
        (token) => ({ method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
      )
      // Already gone is the outcome we wanted, so it is not an error.
      if (!response.ok && response.status !== 404) await fail(response)
    },
  }
}

function assertDrive(ref: StoredFileRef): void {
  if (ref.provider !== 'GOOGLE_DRIVE') {
    throw new StorageError('UNKNOWN', `Not a Google Drive file: ${ref.provider}`)
  }
}

/** Reading a body must never be the thing that throws while handling an error. */
async function peekBody(response: Response): Promise<string> {
  try {
    return await response.clone().text()
  } catch {
    return ''
  }
}
