# Testing Strategy

Spec §57 step 11, and §42.

The point is not coverage percentage. It is that **a wrong number never reaches a bill**, and
that Security Rules — the only enforcement boundary in this system (R-03) — actually deny
what we believe they deny.

---

## 1. Shape

```
        ╱ Manual — device testing, offline, install   (Phases 7, 15)
      ╱   E2E — Playwright, 6 critical journeys        (Phase 15, optional)
    ╱     Rules — emulator, every role × collection    (every phase) ◄── highest value
  ╱       Integration — repositories vs emulator       (per feature)
╱         Unit — business/ pure functions              (thousands, milliseconds)
```

The pyramid is deliberately fat in the middle. Rules tests earn that place because, with no
server, a Rules bug _is_ the vulnerability — and unlike most security tests, they are fast
and deterministic.

The unit base is broad because `packages/shared/src/business` is pure by construction
(`ARCHITECTURE.md` §4). No emulator, no mocks, no clock. The whole financial core tests in
under a second, which is what makes anyone actually run it.

---

## 2. Tooling

| Layer             | Tool                                                          |
| ----------------- | ------------------------------------------------------------- |
| Unit, integration | Vitest                                                        |
| Components        | Testing Library + `jsdom`                                     |
| Rules             | `@firebase/rules-unit-testing` against the Firestore emulator |
| E2E               | Playwright (Phase 15, optional)                               |
| Coverage          | `v8`                                                          |

Gates: **100% branch coverage on `packages/shared/src/business`** — non-negotiable, it is
the money — 80% on repositories, none enforced on UI. A coverage number on presentation code
measures effort, not safety.

---

## 3. The twelve critical tests — §42

Written as named suites so the mapping stays visible. All pure unit tests except where
noted.

**1 · Quantity × rate.** `2500 × ₹120 = ₹3,00,000` exactly, in paise. Fractional quantities
(`1250.75 sq.ft`) round half-away-from-zero **once**, at the line. Property test: summing
line amounts as integers never drifts from the same lines computed independently — the
guarantee ADR-004 exists to provide.

**2 · Previous + current quantity.** `previousQty + currentQty ≤ contractQty` passes at the
boundary and fails one unit past it.

**3 · Contract quantity cannot be exceeded.** Rejected with `EXCEEDS_CONTRACT_QTY` and the
overage, unless `allowChangeOrder` is set with an approver (§4). _Also an integration test:_
approval re-checks against the **live** `completedQty`, not the draft's snapshot — two
concurrent measurements that individually fit but jointly overflow must see the second
rejected (R-13).

**4 · Billed vs received.** Bill ₹10,00,000, receive ₹7,00,000 → `totalBilled` and
`totalReceived` remain independent, and `receivable = ₹3,00,000` (§8's worked example).

**5 · Client outstanding.** All three R-01 quantities asserted separately from one fixture:
`receivable`, `unbilledBalance`, `contractRemaining`. A test asserts they are _not_ equal on
the Tata fixture, which is precisely the confusion that produced R-01.

**6 · Attendance totals.** Present / absent / half-day / leave / holiday counts over a
period, including the month boundary in IST, not UTC (R-12).

**7 · Half-day wage.** §14 verbatim: 23 present + 2 half-day = 24 payable × ₹700 = ₹16,800.
Re-run with `halfDayFactor: 0.75` to prove configurability (A4) rather than a hardcoded 0.5.

**8 · Earned vs paid vs payable.** Earned ₹20,000, paid ₹12,000 → payable ₹8,000. Overpayment
yields a negative payable and a warning, not a clamp to zero — hiding it would hide a real
error.

**9 · Duplicate attendance prevention.** _Integration._ Marking the same project + labour +
date twice writes one document (ADR-006). Offline replay after reconnect is idempotent.

**10 · Duplicate payment prevention.** _Integration._ The same `idempotencyKey` submitted
twice creates one payment and increments `totalReceived` once. Simulated double-tap and
retry-after-timeout.

**11 · Permission checks.** _Rules._ See §4 below.

**12 · Financial audit logs.** _Integration._ Every mutating operation appends exactly one
`auditLogs` entry **inside** its transaction. A rolled-back transaction leaves none — the
failure mode `API_AND_SERVICES.md` §6 warns about.

Plus a thirteenth that earns its place:

**13 · Summary reconciliation.** Property test over a randomised history of bills, payments,
wage locks, expenses, cancellations, and reversals: the transactionally-incremented summary
equals `computeProjectSummary()` recomputed from source. This is how R-04 drift gets caught
in CI instead of in your father's dashboard.

---

## 4. Rules tests

For every collection, for every role, for every operation — and the _denials_ matter more
than the permissions:

```ts
describe('clientPayments', () => {
  it('SUPERVISOR cannot read', () => assertFails(sup.get(paymentRef)))
  it('ACCOUNTANT can create', () => assertSucceeds(acc.set(paymentRef, valid)))
  it('rejects negative amount', () =>
    assertFails(acc.set(paymentRef, { ...valid, amountPaise: -1 })))
  it('rejects float paise', () => assertFails(acc.set(paymentRef, { ...valid, amountPaise: 10.5 })))
  it('rejects amount change', () => assertFails(acc.update(paymentRef, { amountPaise: 999 })))
  it('OWNER cannot delete', () => assertFails(owner.delete(paymentRef)))
  it('disabled user cannot read', () => assertFails(disabled.get(paymentRef)))
})
```

Two suites that guard the whole model:

- **Self-promotion.** Every role attempts `users/{self}.role = 'OWNER'` and every attempt
  fails. This single line in the ruleset is what stands between a signed-in user and total
  access (`SECURITY.md` §3).
- **Universal delete denial.** All five roles × all financial collections × `delete` — all
  fail (ADR-007).

Rules tests run in CI on every PR. A failing rules test blocks the merge.

---

## 5. Component and offline tests

Components are tested for behaviour, not markup: loading, empty, error, and success states
render (§59); financial actions require a confirm dialog before mutating (§28); forms surface
field-level validation; money renders in Indian grouping in both locales.

Offline (§13) needs its own set, since it is a core promise:

- Attendance marks with the network disabled, and syncs on reconnect.
- The pending-sync count is accurate and clears only on server acknowledgement.
- A financial write offline fails with `OFFLINE`, shows the honest message, and **does not**
  appear to succeed (R-02).
- The labour roster is cached and the attendance screen works from a cold offline start.

---

## 6. What is not automated

Stated so its absence is a decision, not an oversight:

- Real-device testing on the actual Android phones in use — manual, Phases 7 and 15.
- Google Drive upload against the live API — mocked in CI; verified by hand per phase.
- PWA install and the Chrome install prompt — manual.
- Voice recognition accuracy — a measurement spike, not a pass/fail test (R-09).
- Bill PDF visual fidelity — reviewed by eye against a real bill.

---

## 7. Per-phase gate — §43, §58

No phase closes until: lint clean, typecheck clean, all unit tests pass, all rules tests
pass, the build succeeds, and the phase's own critical tests from §42 exist and pass.

§43 is unambiguous — _do not move to the next major phase if the current phase is broken_ —
and the practical reading is that a red test at the end of Phase 5 is a Phase 5 problem, not
a Phase 6 inheritance.
