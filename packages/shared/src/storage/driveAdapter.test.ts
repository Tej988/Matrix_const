import { describe, it, expect } from 'vitest'
import {
  classifyDriveError,
  createGoogleDriveAdapter,
  describeStorageFailure,
  driveFileMetadata,
  driveFileName,
  driveViewUrl,
  exceedsMultipartLimit,
  MAX_MULTIPART_BYTES,
  multipartBody,
  multipartContentType,
  sanitiseFileName,
} from './driveAdapter'
import { STORAGE_FAILURES, type StoredFileRef } from './index'

/**
 * The decisions, not the wire. Everything here is a pure function the adapter
 * calls before or after `fetch`; the HTTP round trip itself is Google's to
 * test, and mocking it would only assert that our mock matches our code.
 */

describe('file naming', () => {
  it('prefixes kind and date so one shared folder stays readable', () => {
    // R-06 puts every user's uploads in the same folder. Three phones all
    // producing IMG_0001.jpg is the normal case there.
    expect(
      driveFileName({ kind: 'PAYMENT_PROOF', fileName: 'IMG_0001.jpg', on: '2026-09-02' }),
    ).toBe('PAYMENT_PROOF_2026-09-02_IMG_0001.jpg')
  })

  it('strips separators and newlines that make a Drive name unusable', () => {
    expect(sanitiseFileName('receipts/aug\n2026.pdf')).toBe('receipts-aug-2026.pdf')
  })

  it('collapses runs of whitespace', () => {
    expect(sanitiseFileName('  cash   receipt .jpg  ')).toBe('cash receipt .jpg')
  })

  it('caps the length rather than letting Drive truncate arbitrarily', () => {
    expect(sanitiseFileName('a'.repeat(400))).toHaveLength(120)
  })

  it('falls back to a name when the file has none worth keeping', () => {
    expect(sanitiseFileName('   ')).toBe('attachment')
  })
})

describe('metadata construction', () => {
  const base = {
    fileName: 'proof.jpg',
    mimeType: 'image/jpeg',
    kind: 'PAYMENT_PROOF' as const,
    projectId: 'proj-1',
    on: '2026-09-02',
  }

  it('places the file in the configured folder', () => {
    expect(driveFileMetadata({ ...base, folderId: 'folder-9' }).parents).toEqual(['folder-9'])
  })

  it('omits parents entirely when no folder is configured', () => {
    // exactOptionalPropertyTypes: absent, not present-and-undefined. Drive
    // rejects `parents: null` and silently ignores `parents: []`.
    expect('parents' in driveFileMetadata(base)).toBe(false)
  })

  it('stamps project and kind onto the file itself', () => {
    // Drive lives outside Firestore and outside its Rules. If the metadata
    // record is ever lost, this is the only trail back to what the file was.
    expect(driveFileMetadata({ ...base, folderId: 'f' }).appProperties).toEqual({
      app: 'matrix-const',
      kind: 'PAYMENT_PROOF',
      projectId: 'proj-1',
      uploadedOn: '2026-09-02',
    })
  })

  it('carries the mime type through', () => {
    expect(driveFileMetadata(base).mimeType).toBe('image/jpeg')
  })
})

describe('multipart assembly', () => {
  const metadata = driveFileMetadata({
    fileName: 'proof.jpg',
    mimeType: 'image/jpeg',
    kind: 'PAYMENT_PROOF',
    projectId: 'proj-1',
    folderId: 'folder-9',
    on: '2026-09-02',
  })

  const parts = multipartBody('BOUNDARY', metadata, 'image/jpeg', 'BINARY')

  it('names the boundary in the content type', () => {
    expect(multipartContentType('BOUNDARY')).toBe('multipart/related; boundary=BOUNDARY')
  })

  it('sends the metadata as the first part, as JSON', () => {
    expect(parts[0]).toBe(
      `--BOUNDARY\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    )
  })

  it('declares the file part with the file mime type', () => {
    expect(parts[1]).toBe('--BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n')
  })

  it('passes the bytes through untouched', () => {
    // The payload is kept as its own part precisely so it never becomes a JS
    // string, where a lone surrogate would corrupt the upload.
    expect(parts[2]).toBe('BINARY')
  })

  it('closes with the terminating delimiter', () => {
    expect(parts[3]).toBe('\r\n--BOUNDARY--\r\n')
  })

  it('produces exactly four parts', () => {
    expect(parts).toHaveLength(4)
  })
})

describe('error classification', () => {
  it('treats 401 as a dead token, which is worth one retry', () => {
    expect(classifyDriveError(401, '')).toBe('UNAUTHORISED')
  })

  it('separates a full Drive from a bad token, both of which arrive as 403', () => {
    // Getting this backwards means telling someone to re-consent when they
    // needed disk space, or retrying forever against a full account.
    expect(
      classifyDriveError(403, '{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}'),
    ).toBe('QUOTA_EXCEEDED')
    expect(classifyDriveError(403, '{"error":{"errors":[{"reason":"authError"}]}}')).toBe(
      'UNAUTHORISED',
    )
  })

  it('reads a 403 rate limit as transient, not as a permission problem', () => {
    expect(classifyDriveError(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')).toBe(
      'NETWORK',
    )
  })

  it('maps 413 to too-large', () => {
    expect(classifyDriveError(413, '')).toBe('TOO_LARGE')
  })

  it('maps 404 to not-found', () => {
    expect(classifyDriveError(404, '')).toBe('NOT_FOUND')
  })

  it('treats throttling and server faults as transient', () => {
    expect(classifyDriveError(429, '')).toBe('NETWORK')
    expect(classifyDriveError(500, '')).toBe('NETWORK')
    expect(classifyDriveError(503, '')).toBe('NETWORK')
  })

  it('does not guess at anything else', () => {
    expect(classifyDriveError(400, '')).toBe('UNKNOWN')
  })

  it('has a plain-English message for every failure', () => {
    for (const failure of STORAGE_FAILURES) {
      expect(describeStorageFailure(failure).length).toBeGreaterThan(0)
    }
  })
})

describe('size limit', () => {
  it('rejects past the 5 MiB multipart ceiling', () => {
    // A phone camera clears this routinely, so it is a real limit.
    expect(exceedsMultipartLimit(MAX_MULTIPART_BYTES)).toBe(false)
    expect(exceedsMultipartLimit(MAX_MULTIPART_BYTES + 1)).toBe(true)
  })
})

describe('view url', () => {
  const ref: StoredFileRef = {
    provider: 'GOOGLE_DRIVE',
    externalId: 'file-123',
    fileName: 'PAYMENT_PROOF_2026-09-02_proof.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
  }

  it('is derived, not fetched', () => {
    expect(driveViewUrl('file-123')).toBe('https://drive.google.com/file/d/file-123/view')
  })

  it('resolves without touching the network', async () => {
    const adapter = createGoogleDriveAdapter({
      folderId: 'folder-9',
      getAccessToken: () => Promise.resolve('token'),
      fetchImpl: () => {
        throw new Error('getViewUrl must not make a request')
      },
    })
    await expect(adapter.getViewUrl(ref)).resolves.toBe(
      'https://drive.google.com/file/d/file-123/view',
    )
  })

  it('refuses a ref from another provider rather than building a wrong link', async () => {
    const adapter = createGoogleDriveAdapter({
      folderId: 'folder-9',
      getAccessToken: () => Promise.resolve('token'),
    })
    await expect(adapter.getViewUrl({ ...ref, provider: 'FIREBASE_STORAGE' })).rejects.toThrow(
      /Not a Google Drive file/,
    )
  })
})
