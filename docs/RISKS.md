# Ambiguities and Technical Risks

Spec §57 step 2. Everything here is a thing I believe will bite us, written down before it
does. Ranked by expected damage.

Severity: 🔴 blocks or corrupts money · 🟠 degrades a core promise · 🟡 friction

---

## ✅ R-01 — The spec contradicts itself about "outstanding" — ANSWERED, 2026-09-02

**The clearest ambiguity in the document, and it sits on the headline number.**

§8 is emphatic:

> Do not calculate outstanding directly from contract value.
> Maintain Contract Value / Total Billed / Total Received / Receivable as separate concepts.

But §17's and §38's own worked example says:

| Field                  | Value         |
| ---------------------- | ------------- |
| Contract Value         | ₹18,50,000    |
| Total Billed           | ₹10,00,000    |
| Total Received         | ₹10,00,000    |
| **Client Outstanding** | **₹8,50,000** |

If ₹10,00,000 was billed and ₹10,00,000 was received, the receivable is **₹0**. The
₹8,50,000 is `contractValue − totalBilled` — the _unbilled contract balance_, which is
exactly the calculation §8 forbids. Meanwhile §3 lists "Current received amount ₹10,00,000,
Current outstanding ₹8,50,000" without mentioning billing at all, which is a third reading.

These are three genuinely different business quantities and the dashboard shows only one.

**Resolution taken.** I model all three separately and never conflate them:

- `receivable = totalBilled − totalReceived` — money the client owes _now_
- `unbilledBalance = contractValue − totalBilled` — work still to bill
- `contractRemaining = contractValue − totalReceived` — total still to collect

The project card shows **Receivable** as the primary figure with **Unbilled** beside it,
because "who owes me money today" is the operationally useful number. The seed data will
reproduce your real figures under whichever definition you confirm.

**Answered by the business, not by the spec.** In the owner's words:

> in our work we dont have the total contract amount for a project — like for Tata project
> we dont have a fix amount, all our money depends on the work we have and their measurement
> and then bill calculate.

That settles it, and it invalidates the assumption underneath the question. **There is
usually no contract value at all.** The client pays for what is measured and billed, month
by month; the spec's ₹18,50,000 was an illustration, not how these jobs are priced.

Two of the three figures are contract-derived, so on a normal project they simply do not
exist:

| Figure              | With a fixed price  | Measure-and-bill (the usual case)  |
| ------------------- | ------------------- | ---------------------------------- |
| `receivable`        | billed − received   | **billed − received — the answer** |
| `unbilledBalance`   | contract − billed   | `null`                             |
| `contractRemaining` | contract − received | `null`                             |

So **receivable is the operative figure** — the one and only meaning of _"kitna baaki hai"_
for this business. It never needed a contract value to begin with, which is why §8 was right
to forbid deriving outstanding from one.

**What changed in the code.** `Project.contractValuePaise` is now **optional**; a fixed-price
contract is still supported and still shows all three figures, it is simply no longer the
default assumption. Where there is no contract value:

- `calculateOutstanding` returns `unbilledBalancePaise` and `contractRemainingPaise` as
  `null`, **never `0`** — a zero reads on screen as "nothing left to bill", which on a job
  whose billing has barely started is a lie rather than a rounding of the truth. The types
  are `Paise | null`, so a caller cannot print one by accident.
- `ProjectSummary` carries the same two fields as nullable, and `detectDrift` skips them
  rather than reporting a permanent false difference on every measure-and-bill project.
- `contractCoverage` returns `null`, so the amber "the rate card totals X but the contract
  is Y" warning does not render — there is no Y to reconcile against.
- The new-project form labels the field _"only if there is a fixed amount"_ and tells the
  user to leave it blank when the money depends on measured work.
- Firestore Rules make the field optional on create and update, while still validating it as
  a whole non-negative count of paise whenever it is present.

---

## 🔴 R-02 — Firestore transactions do not work offline

`runTransaction` requires a live connection. It does not queue; it **fails**. This directly
undercuts two requirements that the spec treats as independent:

- §13: attendance must be capturable with no internet
- §23/§24: summaries must be updated transactionally

Both cannot hold for the same write. An offline attendance mark cannot transactionally
update a project summary.

**Resolution taken.** Split writes by their tolerance for delay:

| Write class                                                    | Mechanism                                                                         | Offline                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Attendance                                                     | plain `setDoc` with deterministic ID (ADR-006), queued by Firestore's local cache | ✅ works                                                |
| Labour wage / labour payment / client payment / bill / expense | `runTransaction` including the summary update                                     | ❌ blocked, with an explicit "you are offline" UI state |
| Summary rebuild                                                | owner-triggered full recompute                                                    | ❌ online only                                          |

Financial writes are deliberately **online-only**, and the UI says so plainly rather than
appearing to succeed. Attendance-derived labour cost is therefore **eventually** consistent:
the summary's `labourCost` is recomputed when a wage period is locked, not on each
attendance mark. This is a real, accepted weakening of §24, chosen over silently losing
attendance — which §13 forbids outright.

---

## 🔴 R-03 — Security Rules are the entire security boundary

Consequence of ADR-002. With no server, a signed-in user with devtools can issue any write
the Rules permit. Rules bugs are not cosmetic — they are the vulnerability.

**Mitigation.** Rules are treated as production code: unit-tested against the emulator with
`@firebase/rules-unit-testing`, one test per role per collection per operation, including
explicit _denial_ tests. A phase does not ship with failing rules tests. Financial
collections deny `delete` universally (ADR-007). Field-level validation lives in Rules, not
only in the client.

**Residual risk.** Rules cannot express every invariant. They can enforce "amount is a
positive integer" and "you may only write to a project you belong to". They cannot
efficiently enforce "the sum of bill lines equals the bill total" — that requires reads the
rules engine cannot afford. Cross-document arithmetic invariants remain client-enforced and
audit-detected, **not** server-prevented. Recorded honestly per §24's instruction to
document rather than pretend.

---

## 🔴 R-04 — Summary documents can drift

Summaries are denormalised client-side (R-02). A transaction that fails after a partial UI
update, a legacy record predating a formula change, or a manual Console edit all leave
`projects/{id}/summary/current` disagreeing with the underlying transactions.

**Mitigation.** `recomputeProjectSummary(projectId)` re-derives every summary field from
source documents and is the single definition of truth; the transactional updates are an
optimisation over it. It is exposed to OWNER in Settings → Reconciliation, shows a
before/after diff, and logs to `auditLogs`. A dashboard banner appears when
`summary.computedAt` is older than the project's newest financial write.

Never presented as automatic self-healing. It is a button someone presses.

---

## ✅ R-05 — Firebase Storage is unavailable on Spark — CONFIRMED, 2026-08-27

Since late 2024, new Firebase projects need Blaze to provision a Cloud Storage bucket. Spec
§35's entire storage design may simply not be available to us. → ADR-009 moves files to
Google Drive.

**Resolved.** Tested against the live `matrix-const` project (Spark plan):

```
GET https://firebasestorage.googleapis.com/v0/b/matrix-const.firebasestorage.app/o
  -> HTTP 404 Not Found
```

404, not 403. An existing bucket with default rules refuses an unauthenticated list with
**403 Permission denied**; 404 means there is no bucket. The `storageBucket` field in the
SDK config (`matrix-const.firebasestorage.app`) is only the name a bucket _would_ have —
it is emitted whether or not one has been provisioned, which makes it easy to misread as
confirmation.

**Consequence.** ADR-009 stands: Google Drive is the file store, and
`FirebaseStorageAdapter` is not built. Spec §35's storage design is not available to this
project. If Blaze is ever enabled, provision a bucket and the adapter swap is one line —
`StorageAdapter` exists precisely so that stays true.

_(Worth a glance in the console to double-confirm: Firebase → Storage showing a "Get
started" button rather than a file browser is the same answer from the other direction.)_

---

## 🟠 R-06 — Drive quota follows the uploader, not the folder

A file in a shared My Drive folder counts against the uploader's 15 GB and **is deleted when
that Google account is deleted.** A departing supervisor takes their uploaded receipts with
them.

**Mitigation.** Bill PDFs and business-critical artefacts are uploaded by OWNER/ADMIN only,
landing in your father's Drive. Supervisor uploads are limited to recoverable supporting
evidence. A Google Workspace Shared Drive would remove this problem entirely, since a Shared
Drive owns its own files — worth considering if you ever move the business to Workspace.

---

## 🟠 R-07 — Drive access survives app offboarding

Drive permissions are per Google account and are invisible to Firestore Rules. Setting
`users/{uid}.status = 'DISABLED'` revokes app access but **not** Drive folder access.

**Mitigation.** Offboarding is a documented two-step procedure (`SECURITY.md`): disable in
the app _and_ unshare the Drive folder. The app shows a reminder banner on the user-disable
action. There is no way to automate this without a server — a genuine gap, named rather than
hidden.

---

## ✅ R-08 — Devanagari in generated PDFs — SOLVED for reports, 2026-09-03

Neither jsPDF nor pdfmake renders Devanagari with built-in fonts, and **embedding Noto Sans
Devanagari does not fix it.** The font supplies glyphs; it does not decide which ones. A
Devanagari cluster needs conjunct formation (क्ष, त्र, ज्ञ) and vowel reordering — the i-matra
in किशोर is stored after its consonant and drawn before it — and that decision belongs to an
OpenType shaping engine (HarfBuzz). No in-browser PDF writer ships one; they place glyphs in
codepoint order. So a labourer named रामकिशोर would come out of a wage sheet as
recognisable-but-wrong rubbish, which is worse than not printing the name at all.

**Resolution — render, then photograph.** The browser already has a shaping engine and has
already used it: every report is defined as HTML by
`features/reports/reportPdf.ts#renderReportHtml`. `features/reports/pdfExport.ts` mounts that
HTML in an off-screen iframe, waits on `document.fonts.ready` so nothing is captured
mid-fallback, rasterises it with **html2canvas**, and wraps the pixels in an A4 page with
**jsPDF**. Correct Devanagari is not something the exporter achieves; it is a property of the
thing it photographs. The report can now be sent on WhatsApp as the actual document rather
than as a retyped summary of it.

**The trade, stated plainly.** The text in that PDF is an image: not selectable, not
searchable, not machine-readable, and larger than a text PDF (~2× the bytes of an equivalent
text page). For a document that is forwarded in a chat and read on a phone that is the same
deal as a photographed bill, which is what it replaces. The browser-print path
(`openPrintWindow`) is kept alongside it and still produces real, selectable text — the
Reports UI says which button gives which.

**Cost.** Both libraries are behind `await import()` and `vite.config.ts` walks the module
graph to keep them and their whole transitive tree (core-js, canvg, fast-png, dompurify…)
out of the always-loaded `vendor` chunk — see R-10. Initial bundle is unchanged; jsPDF
(~127 KB gz) and html2canvas (~48 KB gz) are fetched on the tap that needs them, once per
device thanks to the PWA cache.

**Still open: bills.** Bill and quotation PDFs remain English-only browser-print documents,
which matches how they are issued to corporate clients. The same technique applies to them
if Hindi bills are ever wanted; only reports have been converted.

---

## 🟠 R-09 — Web Speech API is thin ice for Hindi

Phase 13 assumes browser speech recognition. Reality: `SpeechRecognition` is Chromium-only
(no Firefox), needs a network round-trip to Google, does not work offline, and `hi-IN`
accuracy on construction vocabulary and proper nouns ("Stonede", "BOQ", labour names) is
unproven. Hinglish — Hindi grammar with English nouns, which is how the query in §33 is
actually spoken — is the hardest case for any single-language model.

**Mitigation.** Phase 13 starts with a measurement spike against real recorded phrases
before any UI is built. Voice is an _accelerator layered over_ a fully usable tap interface,
never the only path to a feature. If accuracy is poor, we ship voice for a constrained
command grammar rather than open-ended natural language, and say so.

---

## 🟠 R-10 — Free-tier quota headroom

Spark daily limits: **50,000 document reads, 20,000 writes, 1 GiB stored**; Hosting **360
MB/day** transfer.

Rough sizing at 5 users / 5 active projects / 40 labourers:

| Activity                        | Daily writes | Daily reads                              |
| ------------------------------- | ------------ | ---------------------------------------- |
| Attendance (40 labourers × 1)   | 40           | ~120                                     |
| Measurements / bills / payments | ~30          | ~300                                     |
| Dashboard loads (5 users × 6)   | 0            | ~900 (summary docs, not raw collections) |
| Rules `get()` evaluations       | —            | ~400                                     |
| Audit log                       | ~70          | ~0                                       |

Order of ~150 writes and ~2,000 reads/day — roughly **4% of the read quota**. Comfortable.

**The danger is not steady state, it is a mistake:** one unbounded `onSnapshot` on
`attendance` with no `where` clause, or a dashboard that reads raw collections instead of
summary documents, can burn 50,000 reads in minutes and hard-stop the app until midnight
Pacific. Enforced by convention (every query bounded and paginated), by code review, and by
a dev-mode read counter surfaced in Settings → Usage (§54).

---

## 🟡 R-11 — Bill number races

Sequential bill numbers via a `counters/` document are safe under `runTransaction` but
serialise concurrent bill creation and fail offline (R-02). Acceptable: bills are created by
one or two people, rarely, and only online.

Numbers are allocated **at generation, not at draft**, so abandoned drafts leave no gaps —
which matters for GST audit trails if ADR-003 is ever switched on.

---

## 🟡 R-12 — Dates must be IST-anchored

`new Date()` in a browser is device-local. A supervisor marking attendance at 00:30 IST on a
phone set to UTC would write the previous day's `dateKey`, silently corrupting a wage
period. Device clocks on cheap Android handsets are also simply wrong sometimes.

**Mitigation.** A single `packages/shared/src/datetime` module owns all date handling.
`dateKey` is always computed as `YYYY-MM-DD` in **Asia/Kolkata**, never from raw local time.
`serverTimestamp()` is used for audit fields; device time is stored separately as
`clientCreatedAt` so offline sync can detect skew. No component calls `new Date()` directly
— enforced by an ESLint `no-restricted-globals` rule.

---

## 🟡 R-13 — Measurement "previous quantity" is a snapshot, not a live value

Two supervisors entering measurements against the same BOQ item concurrently can each read
the same `completedQty`, and their combined entry can exceed the contract quantity — the
exact overbilling §4 forbids.

**Mitigation.** `boqItems.completedQty` is only ever incremented inside the same transaction
that **approves** a measurement, and the over-quantity check is re-evaluated _at approval
time_ against the live value, not against the value shown when the draft was typed. A draft
may be created optimistically; approval is where the invariant is enforced. If approval
would breach the contract quantity, it is rejected and requires an explicit change order.

---

## 🟡 R-14 — No push notifications on Spark

§40 wants FCM reminders for pending bills and due payments. FCM itself is free, but _sending_
requires a server or scheduled job → Blaze.

**Mitigation.** v1 derives these as in-app indicators computed on load — badge counts and a
dashboard "Needs attention" panel. Real push is Phase 12+ alongside the Blaze decision.

---

## 🟡 R-15 — Backup is manual by definition

§41 asks for export; §41 also says do not claim automated disaster recovery unless it exists.
On Spark there is no scheduled export. Settings → Backup produces a full JSON + per-collection
CSV download **when a human clicks it**. The UI states the date of the last export and never
implies anything automatic.

---

## Open questions for you

1. ~~**R-01** — which number is "baaki hai"?~~ **Answered:** there is usually no contract
   value, so it is the receivable — invoiced and unpaid. See R-01 above.
2. **A3** — is the business the contractor billing Tata Project Limited, or a subcontractor
   under someone else?
3. **A4** — is a half day exactly 0.5 payable days, and are Leave/Holiday paid or unpaid?
4. Do you have an existing Firebase project and Google Cloud account, or should Phase 1
   start with creating `construction-dev` from scratch?

None of these block Phase 1. All of them change Phase 3 onward.
