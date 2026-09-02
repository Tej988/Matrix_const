# Architecture Decision Record

Every decision here is binding until superseded by a later entry. Each states the decision,
why it was taken, what it costs, and what would make us revisit it.

Status: **Accepted** (owner decided) · **Assumed** (I decided; correct me and I change it) ·
**Deferred** · **Superseded**

---

## ADR-001 — v1 ships as a Web PWA; native mobile is deferred

**Status:** Accepted — 2026-08-27

Spec §26/§27 ask for a React web app _and_ a React Native + Expo app. Building both from
Phase 1 doubles the work in every UI-bearing phase (3, 5, 6, 7, 8, 9, 10, 11).

**Decision.** v1 is one React + Vite + TypeScript + Tailwind app, shipped as an installable
PWA. Supervisors install it from Chrome on Android via "Add to Home screen"; it runs
full-screen and captures attendance offline. The monorepo reserves `apps/mobile`, and all
business logic, types, and validation live in shared packages an Expo app can import
unchanged.

**Cost.** No true background sync. No native camera pipeline — we use `<input type="file"
capture="environment">`, which is adequate. Web push on iOS needs iOS 16.4+ _and_ the app
installed to the home screen. No Play Store presence without wrapping later.

**Revisit when.** Install friction is reported, or background sync / Play Store presence
becomes necessary. Adding `apps/mobile` at Phase 7+ is a UI-layer job, because the business
layer is already shared.

---

## ADR-002 — Stay on the Firebase Spark (free) plan; AI is deferred to Phase 12

**Status:** Accepted — 2026-08-27

This is the most consequential constraint in the build, so it is written out in full.

Spec §21 and §54 mandate ₹0 infrastructure and forbid paid services without approval. But
**Cloud Functions and Firebase AI Logic both require the Blaze pay-as-you-go plan.** Spark
cannot run them. That is not a configuration detail to engineer around — it is a hard
platform gate, and every choice below follows from it.

**Decision.** Phases 1–11 run entirely on Spark at genuine ₹0. The AI assistant
(Phases 12–14) is _designed_ now and _built_ later, once billing is decided.

**What this forces on the architecture:**

1. **No server-side code exists.** Every write originates in a browser, so **Firestore
   Security Rules are the only enforcement boundary.** Rules are therefore production code:
   reviewed, and tested against the emulator (see `TESTING.md`).
2. **Summary documents are maintained by client-side transactions**, not triggers. Every
   write that moves money runs inside a `runTransaction` updating the entity and
   `projects/{id}/summary/current` together. See `DATABASE.md` § _Summary maintenance_ for
   the reconciliation escape hatch.
3. **No server-side secrets are possible.** Any AI provider key would ship inside the
   browser bundle, readable by anyone. Spec §47 says stop and document rather than leak. So
   we stop. This is exactly why AI is deferred rather than half-built.
4. **No scheduled jobs.** Billing reminders and outstanding-payment nudges (§40) become
   in-app derived indicators computed on load, not push notifications.
5. **No Admin SDK**, so custom auth claims cannot be set. Roles live in Firestore documents
   instead — see ADR-005, and the bootstrap gap in `SECURITY.md`.

**Cost, stated plainly.** Client-authored financial writes are structurally weaker than
server-authored ones. An authenticated user with devtools can _attempt_ arbitrary writes,
and only Rules stand between. We mitigate with strict Rules, an append-only audit log,
immutable financial history, and an owner-run reconciliation routine — but this is **not**
equivalent to a trusted server, and we will not claim it is. When real money depends on
this system, ADR-002 deserves revisiting.

**Revisit when.** You want the AI assistant, or server-enforced financial writes. Blaze
includes the same free quotas; a single-business workload realistically bills ₹0–50/month.
It needs a card on the Google Cloud account and a budget alert. I will not enable it
unprompted.

---

## ADR-003 — Bills carry GST and deduction fields, disabled by default

**Status:** Accepted — 2026-08-27

Spec §7 says "taxes if applicable" without committing. Retrofitting tax onto financial
documents that already exist is a migration on live money — the expensive kind.

**Decision.** From day one the bill model carries:

- `tax`: `{ mode: 'NONE' | 'CGST_SGST' | 'IGST', cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount }`
- `deductions`: `{ tdsRate, tdsAmount, retentionRate, retentionAmount, otherLabel, otherAmount }`
- BOQ items carry optional `hsnSac`.
- Projects carry `taxProfile`, defaulting to `mode: 'NONE'` with all rates zero.

Everything defaults to zero and stays **hidden in the UI** until enabled per-project in
Settings. `netAmount` always runs the full formula; with zeros it reduces to the subtotal.

**Cost.** A few always-zero fields per bill. Negligible.

**Revisit when.** You start raising GST invoices — then it is a Settings toggle plus a PDF
template change, not a migration.

---

## ADR-004 — All money is stored as integer paise

**Status:** Assumed

IEEE-754 floats cannot represent ₹0.10 exactly. Accumulating float rupees across hundreds
of measurement lines produces drift, and drift in a billing system is a bug you learn about
from an annoyed client.

**Decision.** Every monetary field in Firestore is an integer count of **paise**.
₹18,50,000 is stored as `185000000`. Rates are paise-per-unit. A shared `Money` module in
`packages/shared` owns all parsing, formatting, arithmetic, and rounding. **No component
does money arithmetic inline.**

Rounding: `amount = Math.round(quantity * ratePaise)` — half away from zero, applied once
per line item, never to running totals. Line amounts sum as integers, so totals are exact
by construction.

Safe range: `Number.MAX_SAFE_INTEGER` ≈ 9×10¹⁵ paise ≈ ₹90 trillion. Not a concern.

**Cost.** Every read and write crosses a conversion boundary. The `Money` module and its
tests make that mechanical.

---

## ADR-005 — Roles live in Firestore documents, not custom claims

**Status:** Accepted (forced by ADR-002)

Custom auth claims require the Admin SDK → a server → Blaze.

**Decision.** `users/{uid}.role` holds `OWNER | ADMIN | SUPERVISOR | ACCOUNTANT | VIEWER`.
Security Rules read it via `get()`. Project-scoped access is a second check against
`projectMembers/{projectId}_{uid}`.

**Cost.** Each rule evaluation performs document `get()`s. These count as billed reads
(free within Spark quota) and are capped at 10 per single-document request / 20 per query;
our rules use at most 2, so there is headroom. There is also a **bootstrap gap**: nothing
can create the first OWNER except a human in the Firebase Console. That procedure is
documented in `SECURITY.md` § _Bootstrapping the first owner_ — a deliberate manual step,
not an oversight.

---

## ADR-006 — Attendance documents use deterministic IDs

**Status:** Assumed

Spec §12 demands no duplicate attendance for the same project + labour + date; §13 demands
offline capture that syncs later. Those collide: an offline device cannot query for an
existing record before writing.

**Decision.** The attendance document ID is `{projectId}_{labourId}_{YYYY-MM-DD}`. A
duplicate is then not a validation problem — it is physically the same document. Rules
allow `create` only when the document does not exist, and `update` only for authorised
roles supplying an `editReason`. Offline replays are idempotent for free.

**Cost.** Non-opaque IDs. They embed IDs rather than names, so renames are safe.

---

## ADR-007 — Financial records are never deleted

**Status:** Accepted (spec §7, §18)

**Decision.** Bills, payments, expenses, and ledger transactions have no delete path in the
app, and Rules deny `delete` for **every** role including OWNER. Corrections happen through
status transitions (`CANCELLED`, `REVERSED`) plus compensating ledger entries referencing
the original via `reversalOf`. `auditLogs` is create-only: no role may update or delete an
entry.

---

## ADR-008 — Monorepo on npm workspaces

**Status:** Assumed

pnpm is the better monorepo tool, but its symlinked `node_modules` layout fights Expo's
Metro bundler, and ADR-001 keeps an Expo app on the roadmap.

**Decision.** npm workspaces. Ships with Node, no extra install step, stays compatible with
the deferred mobile app.

**Revisit when.** Install times hurt, and mobile is either confirmed dead or confirmed
working under pnpm.

---

## ADR-009 — Google Drive is the file store; Google Sign-In is the auth provider

**Status:** Accepted — 2026-08-27. **Supersedes standing assumption A2.**

Spec §35 assumes Firebase Storage. That assumption probably does not hold: since late 2024,
**newly-created Firebase projects require Blaze to provision a Cloud Storage bucket at
all.** The legacy no-cost 5 GB default bucket survives only on projects that already had
one. Under ADR-002, Firebase Storage is therefore likely _unavailable_ rather than merely
limited. → Verify at Phase 1; tracked as **R-08** in `RISKS.md`.

**Decision, in three parts:**

1. **Auth is Google Sign-In** (Firebase Auth `GoogleAuthProvider`). One tap, no password for
   a non-technical owner to remember — a UX win independent of storage. Email/password is
   not offered in v1.
2. **Files live in Google Drive**, in one folder the owner creates and shares with staff.
   We request the **`drive.file` scope**, which grants access _only to files our app
   creates_ — the app can never read the rest of anyone's Drive. That narrow scope is
   deliberate and worth preserving.
3. **All access goes through a `StorageAdapter` interface** (`packages/shared/src/storage`).
   The `documents` collection stores metadata plus `provider` and `externalId`, so business
   logic never learns which backend is behind it.

```ts
interface StorageAdapter {
  upload(input: UploadInput): Promise<StoredFileRef>
  getViewUrl(ref: StoredFileRef): Promise<string>
  delete(ref: StoredFileRef): Promise<void> // metadata tombstone only for financial docs
}
```

`GoogleDriveAdapter` ships in v1. `FirebaseStorageAdapter` is written only if R-08 resolves
favourably. Both satisfy the same contract and the same test suite.

**Costs, stated plainly:**

- **Quota follows the uploader.** In Drive, a file counts against the storage quota of
  whoever uploaded it, even inside a shared folder — and it is deleted if that Google
  account is deleted. Mitigation: bill PDFs and other business-critical artefacts are
  uploaded by OWNER/ADMIN only; supervisor uploads are limited to supporting evidence
  (receipt photos) whose loss is recoverable. Documented as **R-09**.
- **Two token lifetimes.** The Firebase ID token and the Drive OAuth access token expire
  independently; the Drive token lasts ~1 hour and Firebase will not refresh it. We
  re-acquire silently via the Google Identity Services token client, and the UI degrades to
  "attachment unavailable, reference number saved" rather than blocking a financial write.
  **A file upload must never be able to fail a payment record.**
- **OAuth consent screen.** Until Google verifies the app, users see an "unverified app"
  warning. With fewer than 100 users we stay in _Testing_ mode with staff listed as test
  users, which suppresses it. Verification is only needed at wider distribution.
- **Drive access is not governed by Firestore Rules.** Drive permissions are per Google
  account, so a user removed from the app in Firestore still holds Drive folder access until
  the owner unshares the folder. Offboarding is therefore a two-step manual procedure,
  written down in `SECURITY.md`. This is a genuine gap, not a solved problem.

**Revisit when.** Blaze is enabled (Firebase Storage becomes cleanly available and the
adapter swap is a one-line change), or a Google Workspace account makes a Shared Drive
possible — a Shared Drive owns its own files and eliminates the quota-follows-uploader
problem entirely.

---

## Standing assumptions

I decided these to keep moving. Each is cheap to change now and expensive three phases from
now — worth a skim.

| #      | Assumption                                                                                                                            | Cost if wrong                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A1     | Code lives in `Matrix_Const/` in this repo, beside `matrix-music/`.                                                                   | Trivial — a directory move.                               |
| ~~A2~~ | ~~Auth is email + password.~~                                                                                                         | **Superseded by ADR-009** — auth is Google Sign-In.       |
| A3     | The business is the **contractor**, raising bills _to_ clients like Tata Project Limited. Stonede / Rakesh Rao is the client contact. | **High** — inverts the receivables model. Please confirm. |
| A4     | Half day = 0.5 payable days, configurable in Settings. Leave and Holiday unpaid by default, also configurable.                        | Low — a Settings value read by the wage calculator.       |
| A5     | One business entity, one Firebase project. Not multi-tenant.                                                                          | High — multi-tenancy is a schema-wide change.             |
| A6     | Indian digit grouping (₹18,50,000), dates `DD-MMM-YYYY`, week starts Monday.                                                          | Trivial.                                                  |
| A7     | Bill numbers are `{PREFIX}/{FY}/{0001}` — e.g. `MC/25-26/0007` — prefix in Settings, counter in a transactional `counters/` document. | Low.                                                      |
| A8     | Hindi means Devanagari (डैशबोर्ड) for UI labels. Hinglish matters for AI input, not the interface.                                    | Low.                                                      |
