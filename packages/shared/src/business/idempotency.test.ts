import { describe, it, expect } from 'vitest'
import { fromRupees } from '../money/index'
import { dateKey } from '../datetime/index'
import { clientPaymentKey, labourPaymentKey, needsDisambiguation } from './idempotency'

/** Spec section 42, critical test 10 - duplicate payment prevention. */

const base = {
  projectId: 'p1',
  amountPaise: fromRupees(2_00_000),
  date: dateKey('2026-08-27'),
  reference: 'UTR123456789',
}

describe('client payment keys', () => {
  it('is stable - the same payment always produces the same key', () => {
    // This is the whole point: a retry must collide, not create a new payment.
    expect(clientPaymentKey(base)).toBe(clientPaymentKey({ ...base }))
  })

  it('normalises reference spacing and case', () => {
    // A UTR typed by hand and one pasted from a statement are the same receipt.
    expect(clientPaymentKey({ ...base, reference: ' utr 123456789 ' })).toBe(clientPaymentKey(base))
  })

  it('differs when the amount differs', () => {
    expect(clientPaymentKey({ ...base, amountPaise: fromRupees(2_00_001) })).not.toBe(
      clientPaymentKey(base),
    )
  })

  it('differs when the date differs', () => {
    expect(clientPaymentKey({ ...base, date: dateKey('2026-08-28') })).not.toBe(
      clientPaymentKey(base),
    )
  })

  it('differs when the project differs', () => {
    expect(clientPaymentKey({ ...base, projectId: 'p2' })).not.toBe(clientPaymentKey(base))
  })

  it('differs when the reference differs', () => {
    expect(clientPaymentKey({ ...base, reference: 'UTR987654321' })).not.toBe(
      clientPaymentKey(base),
    )
  })

  it('is not random - the failure mode this exists to prevent', () => {
    const keys = new Set(Array.from({ length: 50 }, () => clientPaymentKey(base)))
    expect(keys.size).toBe(1)
  })

  it('is prefixed so payment kinds cannot collide with each other', () => {
    expect(clientPaymentKey(base).startsWith('cp_')).toBe(true)
  })
})

describe('labour payment keys', () => {
  const lp = {
    labourId: 'l1',
    projectId: 'p1',
    amountPaise: fromRupees(8_000),
    date: dateKey('2026-08-27'),
    reference: 'PP-9988',
  }

  it('is stable', () => {
    expect(labourPaymentKey(lp)).toBe(labourPaymentKey({ ...lp }))
  })

  it('differs per labourer', () => {
    expect(labourPaymentKey({ ...lp, labourId: 'l2' })).not.toBe(labourPaymentKey(lp))
  })

  it('cannot collide with a client payment key', () => {
    expect(labourPaymentKey(lp).startsWith('lp_')).toBe(true)
  })

  it('produces distinct keys across many realistic payments', () => {
    const keys = new Set<string>()
    for (let labour = 0; labour < 40; labour++) {
      for (let day = 1; day <= 28; day++) {
        keys.add(
          labourPaymentKey({
            ...lp,
            labourId: `l${labour}`,
            date: dateKey(`2026-08-${String(day).padStart(2, '0')}`),
          }),
        )
      }
    }
    expect(keys.size).toBe(40 * 28)
  })
})

describe('ambiguous cash payments', () => {
  it('flags a payment with no reference as needing a human decision', () => {
    // Two cash payments to the same person on the same day for the same amount
    // might be one recorded twice, or two real payments. We cannot tell.
    expect(needsDisambiguation('')).toBe(true)
    expect(needsDisambiguation('   ')).toBe(true)
  })

  it('does not flag a payment that carries a reference', () => {
    expect(needsDisambiguation('UTR123')).toBe(false)
  })
})
