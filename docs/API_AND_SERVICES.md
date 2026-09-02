# Services and Contracts

Spec §57 step 3, and §50. There is no HTTP API (ADR-002), so "the API" is the set of
TypeScript contracts between layers. These signatures are the interface the whole build
agrees on.

```
UI  →  business/ (pure)  →  repositories/ (Firestore)  →  Firestore
```

---

## 1. Money and dates

Two modules nothing else may bypass.

```ts
// packages/shared/src/money
type Paise = number & { readonly __brand: 'Paise' }

parseRupees(input: string): Paise          // "18,50,000.50" → 185000050
formatPaise(p: Paise, locale): string      // 185000050 → "₹18,50,000.50"
formatPaiseInWords(p: Paise, locale): string   // confirm dialogs, §28
multiplyQty(qty: number, rate: Paise): Paise   // round half away from zero, once
sumPaise(values: Paise[]): Paise               // integer addition — exact
percentOf(base: Paise, rate: number): Paise    // GST/TDS — ADR-003
```

The `Paise` brand makes `amountPaise = 1850000` (rupees mistaken for paise) a **compile
error**. That single line of type-level defence is worth more than any runtime check.

```ts
// packages/shared/src/datetime  — everything anchored to Asia/Kolkata (R-12)
todayKey(): DateKey                        // "2026-08-27" in IST, never device-local
toDateKey(d: Date): DateKey
periodOf(k: DateKey): Period               // "2026-08"
daysInPeriod(p: Period): DateKey[]
isFinancialYear(k: DateKey): string        // "25-26" for bill numbering (A7)
```

`new Date()` is banned outside this module by ESLint `no-restricted-globals`.

---

## 2. Business layer — pure, deterministic, no I/O

This is §51 made concrete. Every function here takes plain data and returns plain data. No
React, no Firebase, no clock, no randomness. Testable without an emulator, and callable
unchanged by the Phase 12 AI tools.

### BOQ and measurement

```ts
calculateBoqAmount(qty: number, rate: Paise): Paise

validateMeasurementItem(input: {
  contractQty: number
  completedQty: number      // live value at approval time — R-13
  currentQty: number
  allowChangeOrder: boolean
}): { ok: true; totalQty: number; remainingQty: number }
| { ok: false; reason: 'EXCEEDS_CONTRACT_QTY' | 'NON_POSITIVE'; overBy: number }

calculateMeasurementTotal(items: MeasurementItemInput[]): Paise
```

`validateMeasurementItem` is §4's overbilling rule and §42 tests 2 and 3. It returns a
result object rather than throwing, because "you are 120 sq.ft over contract" is a message
the UI must render, not an exception.

### Billing

```ts
buildBillFromMeasurements(input: {
  measurements: ApprovedMeasurement[]
  taxProfile: TaxProfile          // ADR-003 — zeros by default
  deductionProfile: DeductionProfile
}): {
  items: BillItemSnapshot[]       // frozen: name, unit, rate, qty
  subtotalPaise: Paise
  tax: TaxBreakdown
  deductions: DeductionBreakdown
  netAmountPaise: Paise
}

nextBillNumber(prefix: string, fy: string, counter: number): string  // "MC/25-26/0007"
```

### Wages — §14, and never AI

```ts
calculateWagePeriod(input: {
  attendance: AttendanceRecord[]
  dailyRatePaise: Paise
  rules: WageRules              // { halfDayFactor: 0.5, leavePaid: false, holidayPaid: false }
}): {
  presentDays: number; halfDays: number; absentDays: number
  leaveDays: number; holidayDays: number
  payableDays: number
  earnedAmountPaise: Paise
}
```

Rules are injected, not hardcoded — A4 is a Settings value, and §14 requires the half-day
factor be configurable. The worked example from §14 (23 present + 2 half = 24 payable ×
₹700 = ₹16,800) is a literal test case.

### Ledgers and outstanding

```ts
calculateLabourPosition(input: {
  wagePeriods: WagePeriod[]; payments: LabourPayment[]
}): { earnedPaise: Paise; paidPaise: Paise; payablePaise: Paise }

// R-01 — three distinct quantities, never conflated
calculateClientPosition(input: {
  contractValuePaise: Paise
  bills: Bill[]                 // CANCELLED excluded
  payments: ClientPayment[]     // only CONFIRMED counted
}): {
  totalBilledPaise: Paise
  totalReceivedPaise: Paise
  receivablePaise: Paise        // billed − received  ·  owed now
  unbilledBalancePaise: Paise   // contract − billed  ·  left to bill
  contractRemainingPaise: Paise // contract − received
}

computeProjectSummary(input: ProjectSummaryInputs): ProjectSummary
```

`computeProjectSummary` is the **authoritative** definition of a summary document. The
transactional increments in the repositories are an optimisation over it, and a test asserts
the two agree over a randomised transaction history — which is how R-04 drift gets caught in
CI rather than in production.

---

## 3. Repositories — the only place Firestore is imported

```ts
interface Repository<T> {
  getById(id: string): Promise<T | null>
  list(query: BoundedQuery): Promise<Page<T>>     // always limited + cursored (R-10)
  create(input: CreateInput<T>, ctx: AuthContext): Promise<string>
  update(id: string, patch: UpdateInput<T>, ctx: AuthContext): Promise<void>
}
```

There is no `delete` on the base interface. Financial repositories cannot expose one
(ADR-007), so it is absent by construction rather than forbidden by convention.

Transactional operations get named methods, because each is a business event rather than a
CRUD call:

```ts
recordClientPayment(draft: ClientPaymentDraft, ctx): Promise<Result<string, PaymentError>>
confirmClientPayment(id: string, ctx): Promise<Result<void, PaymentError>>
approveMeasurement(id: string, ctx): Promise<Result<void, MeasurementError>>   // bumps completedQty — R-13
generateBill(draft: BillDraft, ctx): Promise<Result<Bill, BillError>>          // allocates number — R-11
lockWagePeriod(id: string, ctx): Promise<Result<void, WageError>>
recordLabourPayment(draft, ctx): Promise<Result<string, PaymentError>>
cancelBill(id: string, reason: string, ctx): Promise<Result<void, BillError>>  // + reversing ledger entry
recomputeProjectSummary(projectId: string, ctx): Promise<SummaryDiff>          // R-04
```

Each wraps `runTransaction` and performs the full six-step commit from `ARCHITECTURE.md` §5:
idempotency check → entity write → ledger entry → summary update → derived recompute → audit
append. All six or none.

Every one of these **fails offline** (R-02) with `OfflineError`, which the UI renders as
"You are offline — this cannot be saved yet" rather than a spinner that never resolves.

### Attendance is the exception

```ts
markAttendance(input: AttendanceInput, ctx): Promise<void>   // plain setDoc — works offline
markAttendanceBulk(inputs: AttendanceInput[], ctx): Promise<void>
watchPendingSyncCount(): Observable<number>
```

Deterministic IDs (ADR-006) make these idempotent, so no transaction is needed and offline
queueing is free.

---

## 4. Result and error handling

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

Expected failures — over-quantity, duplicate payment, offline, permission denied — are
returned, not thrown. Throwing is reserved for genuine bugs, where the error boundary is the
right destination. The distinction keeps `try/catch` out of the happy path.

```ts
type AppError =
  | { kind: 'OFFLINE' }
  | { kind: 'PERMISSION_DENIED'; action: string }
  | { kind: 'VALIDATION'; field: string; message: string }
  | { kind: 'DUPLICATE'; idempotencyKey: string }
  | { kind: 'CONFLICT'; message: string }        // e.g. quantity changed during approval
  | { kind: 'QUOTA_EXCEEDED' }                   // R-10, surfaced honestly
  | { kind: 'STORAGE_UNAVAILABLE' }              // Drive token expired — ADR-009
  | { kind: 'UNKNOWN'; cause: unknown }
```

`STORAGE_UNAVAILABLE` is deliberately non-fatal. A failed attachment upload must never fail
the payment record it was attached to.

---

## 5. Storage adapter

```ts
interface StorageAdapter {
  upload(input: { file: File; kind: DocumentKind; projectId: string }): Promise<StoredFileRef>
  getViewUrl(ref: StoredFileRef): Promise<string>
  delete(ref: StoredFileRef): Promise<void>     // metadata tombstone for financial documents
}
```

`GoogleDriveAdapter` ships in v1; `FirebaseStorageAdapter` only if R-05 resolves favourably.
Both satisfy the same contract and the same test suite, so the choice never reaches business
logic.

---

## 6. Audit

```ts
appendAudit(entry: {
  action: AuditAction; entityType: string; entityId: string
  projectId?: string; before?: unknown; after?: unknown; reason?: string
}, ctx: AuthContext): Promise<void>
```

Called **inside** the transaction it describes, never after it. An audit entry that can
commit while its subject rolls back is worse than no audit entry, because it is a confident
record of something that did not happen.
