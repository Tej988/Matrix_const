import type { DateKey, Paise } from '@mc/types'

/**
 * Idempotency keys for financial writes. Spec section 42, critical test 10.
 *
 * A double-tapped button, a retried request, or an offline replay must not
 * produce two payments. The key is derived from the payment's own identity, so
 * the same payment always produces the same key - and the transaction that
 * writes it refuses when the key already exists.
 *
 * Deliberately NOT random: a UUID would make every retry a new payment, which
 * is exactly the bug this prevents.
 */

/**
 * A small, stable, non-cryptographic hash. This guards against accidental
 * duplicates, not against an adversary - collisions merely need to be
 * improbable among a business's own payments, and Security Rules plus the
 * audit log cover deliberate abuse.
 */
function hash(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export interface ClientPaymentIdentity {
  projectId: string
  amountPaise: Paise
  date: DateKey
  /** Bank reference or transaction ID - whatever uniquely names this receipt. */
  reference: string
}

export function clientPaymentKey(p: ClientPaymentIdentity): string {
  // Reference is normalised because bank statements and humans disagree about
  // spacing and case for the same UTR.
  const reference = p.reference.trim().toUpperCase().replace(/\s+/g, '')
  return `cp_${hash([p.projectId, p.amountPaise, p.date, reference].join('|'))}`
}

export interface LabourPaymentIdentity {
  labourId: string
  projectId: string
  amountPaise: Paise
  date: DateKey
  reference: string
}

export function labourPaymentKey(p: LabourPaymentIdentity): string {
  const reference = p.reference.trim().toUpperCase().replace(/\s+/g, '')
  return `lp_${hash([p.labourId, p.projectId, p.amountPaise, p.date, reference].join('|'))}`
}

/**
 * Two cash payments to the same person, same day, same amount, with no
 * reference are genuinely ambiguous - they might be one payment recorded twice,
 * or two real payments. We cannot tell, so we ask rather than guess.
 */
export function needsDisambiguation(reference: string): boolean {
  return reference.trim() === ''
}
