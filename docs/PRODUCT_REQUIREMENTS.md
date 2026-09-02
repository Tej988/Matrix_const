# Product Requirements

Spec §57 step 1 — the specification read back, resolved, and made buildable.

---

## 1. What this is

A construction business management platform for a family-owned contracting business. Not an
attendance app (§2). The centre of gravity is the chain that turns work into money:

```
Client → Project → Contract/BOQ → Measurement → Bill → Client Payment
Project → Labour → Attendance → Wage → Labour Payment
Project → Expenses
                    ↓
          Project Financial Summary
```

Everything converges on the last line. A feature that does not eventually feed the project
financial view is probably not v1.

---

## 2. Who uses it

**The owner (your father) — primary.** Non-technical. Wants answers, not navigation. Success
looks like opening the app and seeing where each project stands within five seconds, and
eventually asking in Hindi instead of tapping. He is the reason §28 forbids an ERP-style
interface, and the reason every design tie-breaks toward fewer, larger, more obvious
controls.

**Site supervisor.** On a phone, at a site, often with poor signal (§13). Marks attendance
daily and enters measurements monthly. Sees no financial figures — not a trust judgement,
just scope. Attendance must work with no signal, every time. This constraint alone shaped
ADR-006 and R-02.

**Accountant / office staff.** Bills, payments, expenses, reports. Desktop or tablet. Cares
about correctness and audit trails more than speed.

**Viewer.** Read-only.

---

## 3. Functional requirements

Traced to the spec. **P0** = v1. **P1** = after Phase 11. **P2** = deferred with a reason.

### Projects and clients — §3, §44 Phase 3

P0 · Client CRUD with contact details · Project CRUD with contract value and status · Project
cards showing live financial position · Project team membership · Global search across
projects, clients, labour, bill numbers, and payment references (§39).

### BOQ and rate card — §5

P0 · Multiple BOQ items per project, each with unit, contract quantity, and rate · Automatic
`contractAmount` · Configurable units · Running completed / remaining quantities. **No rate
is ever hardcoded** (§5) — the Tata figures are seed data, not constants.

### Measurement book — §6

P0 · Monthly measurements against BOQ items, with location and description · Automatic
`quantity × rate` · Draft → Submitted → Approved → Rejected · Previous / current / total /
remaining quantity · Overbilling prevention (§4) · Change orders with explicit approval ·
Only approved measurements are billable.

### Billing — §7, §36

P0 · Generate a bill from approved measurements · Sequential numbering per financial year ·
Frozen line-item snapshots · Draft → Generated → Sent → Partially Paid → Paid → Cancelled ·
Bill PDF (English — R-08) · No deletion, ever (ADR-007). P1 · GST and TDS on the fields
already modelled (ADR-003).

### Client payments — §8, §9

P0 · Manual entry with method, bank reference, and transaction ID · Payment ledger per
project and client · Pending → Suggested → Confirmed → Rejected → Reversed · Confirmed
payments alone count toward received · Duplicate prevention by idempotency key. P1 · Bank
statement CSV import, screenshot OCR — both entering as `SUGGESTED`, never auto-confirmed
(§9). P2 · Email and SMS parsing — §9 says do not make SMS access mandatory; browser SMS
access does not exist, so this needs the deferred mobile app.

### Labour — §10, §11, §12, §13

P0 · Labour profiles with daily wage · Project assignment history, never a `projectId` on
the labour record (§11) · Fast daily attendance with five statuses · **Offline attendance
with automatic sync** · Duplicate prevention · Edit with a reason, by authorised roles only.

Attendance is the most-used screen in the product. One tap per labourer, whole roster on one
screen, no scrolling between saves, works from a cold offline start.

### Wages and labour payments — §14, §15

P0 · Deterministic wage calculation from attendance (**never AI** — §51) · Configurable
half-day factor · Wage periods that lock · Payments recorded against PhonePe, cash, or bank
transfer with reference IDs · Earned / paid / payable per labourer. The app **records**
PhonePe payments; it does not execute them (§15).

### Expenses — §16

P0 · Project expenses across eight categories, with receipt reference.

### Financial summary and ledger — §17, §18

P0 · Per-project summary with all three receivable-style quantities kept distinct (R-01) ·
Append-only transaction ledger · Reversals rather than edits · Owner-run reconciliation
(R-04). Nothing is labelled _profit_ unless every cost is captured — §17 is explicit, and it
will not be.

### Reports — §37

P0 · Project financial, labour, attendance, billing, payment, expense, outstanding · CSV
export. P1 · PDF and Excel export, cash flow.

### Dashboard — §38

P0 · Portfolio totals, project cards with live figures, today's attendance, pending bills and
payments, a "needs attention" panel replacing the push notifications Spark cannot send
(R-14).

### Language — §29

P0 · Full English and Hindi (Devanagari) interface from Phase 1, translation keys only,
persisted preference. Bill PDFs are English-only in v1 (R-08).

### Documents — §35

P0 · Upload and link receipts, screenshots, quotations, and bill PDFs via Google Drive
(ADR-009) · Metadata in Firestore · Graceful degradation when a file is unavailable.

### AI assistant — §30–§34

P1, Phase 12+, gated on the Blaze decision (ADR-002) · Natural-language queries in Hindi,
English, and Hinglish · Tool-calling against real data, never invented figures · Writes
require explicit confirmation (§32). P2 · Voice (Phase 13, after the accuracy spike — R-09)
· Document extraction (Phase 14).

### Users and security — §20, §25

P0 · Google Sign-In · Five roles · Project-scoped access for supervisors · Security Rules on
every collection · Audit log · No deletion of financial records.

### Backup — §41

P0 · Manual JSON and CSV export, honestly labelled (R-15).

---

## 4. Non-functional

|                   | Target                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost**          | ₹0. No paid service without an ADR and approval (§54).                                                                                                                                       |
| **Performance**   | Dashboard interactive < 2s on 4G, mid-range Android. Attendance marking < 200ms perceived. Bundle < 400 KB gzipped, routes lazy-loaded.                                                      |
| **Offline**       | Attendance fully functional with no connection. Reads served from cache. Financial writes fail honestly rather than appearing to succeed (R-02).                                             |
| **Correctness**   | Integer paise throughout (ADR-004). 100% branch coverage on the business layer. Deterministic calculations, never AI (§51).                                                                  |
| **Security**      | Default deny. Rules on every collection, tested per role. No secrets in the bundle (§47).                                                                                                    |
| **Accessibility** | Minimum 44px touch targets, 16px base text, WCAG AA contrast, full keyboard navigation. §28's "large buttons, large readable text" is an accessibility requirement wearing business clothes. |
| **Reliability**   | No financial data loss. No silent failures. Every mutation audited.                                                                                                                          |

---

## 5. Explicitly out of scope for v1

Named so their absence is a decision on record: materials inventory and purchase orders,
vendor ledgers, equipment tracking, subcontractor chains, multi-company support, payroll
statutory compliance (PF/ESI), direct PhonePe execution (§15 forbids it), SMS parsing, and
native app store distribution (ADR-001).

---

## 6. Done means

§59, applied per feature: the UI works · the data model works · validation exists ·
authorisation exists · error, loading, and empty states exist · tests exist and pass · the
build succeeds · documentation is updated · no obvious vulnerability.

Code existing is not the same as a feature being complete.

---

## 7. How we will know it worked

The owner opens the app and reads a project's position without asking anyone. A supervisor
marks a full day's attendance in under a minute, with no signal, and it is there the next
morning. A month's bill is generated from approved measurements without a calculator. The
figure on the dashboard matches the figure in the ledger — every time, and provably (test 13).

And the thing that would mean it failed: a number on a screen that nobody can trace back to
a transaction.
