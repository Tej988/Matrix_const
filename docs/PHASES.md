# Development Phases

Spec §57 step 7, §44, and the per-phase discipline of §43 and §58.

Every phase ends at the same gate: **lint clean · typecheck clean · unit tests pass · rules
tests pass · build succeeds · docs updated · commit** — then I stop and wait for your
approval (§58). §43 is explicit that a broken phase is not carried into the next one.

Sizes are relative effort, not calendar promises.

---

| # | Phase | Size | Status |
|---|---|---|---|
| 0 | Discovery and architecture | M | ✅ complete |
| 1 | Repository foundation | M | ✅ **complete** |
| 2 | Authentication and RBAC | M | ✅ **complete** |
| 3 | Clients and projects | M | ✅ **complete** |
| 4 | BOQ and rate card | S | ✅ **complete** |
| 5 | Measurements | L | ✅ **complete** |
| 6 | Billing | L | ✅ **complete** |
| 7 | Labour and offline attendance | L | ✅ **complete** |
| 8 | Wages and labour payments | M | ✅ **complete** |
| 9 | Client payments and finance | L | ✅ **complete** |
| 10 | Reports | M | ✅ **complete** |
| 11 | Language | S | ⚠️ **partial** |
| — | **v1 usable — Spark, ₹0** | | |
| 12 | AI text assistant | L | ⬜ needs Blaze decision |
| 13 | Voice assistant | M | ⬜ needs Blaze + R-09 spike |
| 14 | AI document processing | L | ⬜ needs Blaze |
| 15 | Production hardening | M | ⬜ |

---

## Phase 0 — Discovery and architecture ✅

All eight documents §44 requires, plus `DECISIONS.md`, `RISKS.md`, and this file. ER diagram
in Mermaid (`DATABASE.md`), folder structure and Firebase configuration (`ARCHITECTURE.md`,
`DEPLOYMENT.md`), security model, AI tool architecture, testing and deployment strategy.

**Output:** twelve documents. No application code, per §57.

---

## Phase 1 — Repository foundation

Toolchain verified and ready — Node 24.20.0, npm 11.19.0, firebase-tools 15.28.1, JDK 21,
all on Windows natively (`DEPLOYMENT.md` §1).

npm workspaces monorepo (ADR-008) · `apps/web` on Vite + React + TS strict + Tailwind ·
`packages/types`, `validation`, `shared`, `config` · ESLint with the layering rules from
`ARCHITECTURE.md` §4 and the `new Date()` ban (R-12) · Vitest · Firebase emulator suite ·
`construction-dev` connected · `npm run check` as the single local quality gate.

No CI workflow and no branching — deferred past MVP by owner decision
(`DEPLOYMENT.md` §7–§8).

Also this phase: **resolve R-05** by attempting to provision a Storage bucket, and record the
answer.

**Gate:** `npm run check` passes end to end.

**Result — 2026-08-27.** Done, with one item outstanding.

| | |
|---|---|
| Monorepo | npm workspaces: `apps/web`, `packages/{types,shared,validation}` |
| Web app | Vite 6 + React 19 + TS strict + Tailwind 4, builds to 205 KB gzipped |
| Business layer | `Money` (integer paise, ADR-004) and `Dates` (IST-anchored, R-12) |
| Tests | **88 passing** — 67 unit, 21 Security Rules against the emulator |
| Rules | Default deny, `users`, `auditLogs`, `settings`, self-promotion guard |
| Gate | `npm run check` = lint → typecheck → unit → rules → build |

| Firebase | `matrix-const` linked, Web app registered, rules deployed clean |
| Dev server | Vite serves on :5173, HTTP 200 |

**R-05 resolved:** Firebase Storage returns 404 on this Spark project — there is no bucket
and one cannot be provisioned. ADR-009 (Google Drive) stands. Details in `RISKS.md` R-05.

**Bug caught during deploy:** `isMember()` had its path literal wrapped across lines, which
Firestore accepts as a *warning* while parsing it wrongly. It would have silently denied
supervisors access to their own projects in Phase 3. The helper is removed until Phase 3
needs it, and the gotcha is recorded in the rules file.

Outstanding, both small: `VITE_GOOGLE_OAUTH_CLIENT_ID` is blank until the Google Auth
Platform steps are finished (`DEPLOYMENT.md` §2 step 11), and `firestore.indexes.json` stays
empty until Phase 3 introduces real queries.

---

## Phase 2 — Authentication and RBAC

Google Sign-In (ADR-009) · session handling and route guards · the `users` collection and the
five roles · the "awaiting access" state for users with no profile · the first-owner
bootstrap procedure, executed and documented (`SECURITY.md` §4) · in-app user invitation ·
Security Rules for `users` and `projectMembers` · App Check in monitor mode.

**Gate:** every cell of the §2 role matrix has a passing rules test, including the
self-promotion denials. A signed-in stranger can read nothing.

**Result — 2026-08-27.** Complete, pending one manual bootstrap step.

| | |
|---|---|
| Sign-in | Google popup, `drive.file` scope requested in the same consent |
| Auth states | `loading` / `signed-out` / `unprovisioned` / `disabled` / `ready`, each with its own screen |
| RBAC | `packages/shared/src/business/permissions.ts` — 32 permissions × 5 roles, pure and testable |
| Route guards | permission-gated; nav renders only what the role holds |
| User admin | OWNER-only page: add by UID, change role, enable/disable |
| Audit | role changes write user + `auditLogs` in one batch — rules reject the batch if the audit entry is forged |
| Tests | **113 passing** — 85 unit (18 new RBAC), 28 rules (7 new) |
| Rules | deployed to `matrix-const`, clean |

Two things found while building:

- **Owner self-lockout.** An owner could demote or disable *themselves*. On a sole-owner
  account that is unrecoverable — no server exists to undo it and `user:manage` becomes
  permanently unreachable. Now blocked in Rules *and* in the UI. A second owner, or the
  console, can still do it, so nothing legitimate is prevented.
- **No invitations, by design.** Sending an email invite needs a server (ADR-002). Instead
  the person signs in, reads their account ID off the awaiting-access screen, and passes it
  to the owner. Fewer moving parts, and nothing to spoof.

Deferred to Phase 3: `projectMembers` rules (the collection does not exist yet) and App
Check monitor mode (worth enabling once there is real traffic to observe).

---

## Phase 3 — Clients and projects

Client CRUD · project CRUD with contract value · project cards · membership management ·
`summary/current` created and read (not yet incremented) · global search (§39) · the
Tata Project Limited / Stonede / Rakesh Rao / ₹18,50,000 seed (§44).

**Result — 2026-08-27.** Complete, with two carry-overs.

| | |
|---|---|
| Clients | list, create, contact details; deactivate never delete |
| Projects | list, create with live amount-in-words, detail page |
| Summary | `summary/current` created atomically with every project |
| Membership | `projectMembers` with the `{projectId}_{uid}` ID contract |
| Business layer | `outstanding.ts` (the three R-01 figures) and `projectSummary.ts` (authoritative derivation + drift detection) |
| Tests | **167 passing** — 113 unit (28 new), 54 rules (26 new) |
| Rules | clients, projects, summary, membership — deployed |

**R-01 is resolved in the model rather than by picking a side.** All three figures are
computed and labelled separately on the project page: *Receivable* (billed − received),
*Unbilled balance* (contract − billed), *Contract remaining*. Whichever one the owner means
by "kitna baaki hai", it is on screen with an unambiguous name, and choosing a headline
later is a Settings change, not a migration.

**A3 assumed, not answered:** built as contractor-bills-client. If it is the reverse, the
receivable direction inverts — a change to `outstanding.ts` and its tests, not to the schema.

Two design points worth recording:

- **Supervisors cannot list `projects` at all.** Rules filter documents but cannot filter a
  query, so an unbounded collection read must fail outright. `listForUser` resolves
  membership first and fetches by ID. One extra query, and the boundary stays honest.
- **The detail page recomputes the three outstanding figures from stored totals** instead of
  trusting the stored ones. Since summaries are maintained client-side and can drift (R-04),
  this makes an inconsistency visible rather than authoritative.

Carried to Phase 4: global search (§39) — worth building once there is more than one entity
type to search — and the Tata seed, which is now just data entry through the UI.

---

## Phase 4 — BOQ and rate card

BOQ CRUD with units, quantities, rates · `contractAmount` computed in `business/` ·
`boqCalculator` with test 1 (§42) at 100% branch coverage · bulk entry, since a real BOQ is
dozens of lines and one-at-a-time forms are how data entry gets abandoned.

**Result — 2026-08-27.** Complete, with bulk entry deferred.

| | |
|---|---|
| `boqCalculator` | contract amount, remaining/unbilled quantity, completion %, roll-ups |
| §4 rule | `validateQuantity` — rejects overshoot unless a change order is explicitly approved |
| Units | SQFT, SQM, RMT, NOS, KG, MT, CUM, LS, DAY |
| UI | rate card table on the project page, live `qty × rate` preview with amount in words |
| Coverage check | warns when the rate card total ≠ the project contract value |
| Tests | **208 passing** — 139 unit (26 new), 69 rules (15 new) |

Three points worth recording:

- **`completedQty` and `billedQty` cannot be moved by editing the rate card.** Rules pin both
  with `unchanged()` on update and require zero on create. They move only inside the
  measurement-approval and billing transactions. Without that pin, the §4 overbilling guard
  could be bypassed by typing into a form field instead of approving a measurement (R-13).
- **A change order must be an explicit `true`.** `validateQuantity` never defaults the
  override, and a test asserts that `undefined` and `false` both still reject — §4 wants the
  overshoot to be a deliberate act, so it is a parameter rather than a fallback.
- **Completion is measured by value, not by row count.** Three items with one partly done
  reads as 20.2% complete, not 33%.

Deferred: **bulk entry.** A real BOQ is dozens of lines and one-at-a-time entry is how data
entry gets abandoned — but paste-a-table needs a parser, a preview, and per-row error
handling, which is its own piece of work. Single-item entry is correct and usable now; bulk
import lands alongside the CSV work in Phase 10.

---

## Phase 5 — Measurements

The measurement book (§6) · monthly entry against BOQ items with location · Draft → Submitted
→ Approved → Rejected with role separation (a supervisor cannot approve their own) ·
previous / current / total / remaining quantities · **overbilling prevention re-validated at
approval against live `completedQty`** (R-13) · change orders.

**Gate:** §42 tests 2 and 3, including the concurrent-approval integration case.

The largest correctness risk in the build. R-13 is where money quietly goes wrong.

---

## Phase 6 — Billing

Bill generation from approved measurements · frozen line snapshots · transactional numbering
(R-11) · the status lifecycle · cancellation with a reversing ledger entry, never deletion ·
bill PDF via pdfmake, English (R-08) · PDF archived to Drive by OWNER/ADMIN (R-06) · the
first transactional summary updates, and the `transactions` ledger.

**Gate:** §42 tests 4 and 12; a generated PDF checked by eye against a real bill.

---

## Phase 7 — Labour and offline attendance

Labour profiles (§10 — no Aadhaar) · assignment history (§11) · the attendance screen: whole
roster, one tap per labourer · deterministic IDs (ADR-006) · **offline capture and sync**
(§13) · pending-sync indicator · authorised edit with a reason · PWA install prompt.

**Gate:** §42 tests 6 and 9, the offline suite from `TESTING.md` §5, and **manual testing on
a real Android phone in aeroplane mode.** This phase is not done because tests pass; it is
done when attendance survives a day with no signal.

---

## Phase 8 — Wages and labour payments

`wageCalculator` with configurable rules (§14, A4) · wage periods and locking · labour
payments across PhonePe, cash, and bank transfer, recorded not executed (§15) · earned /
paid / payable · `labourCost` into the summary on lock (R-02).

**Gate:** §42 tests 7 and 8, including the `halfDayFactor` configurability case.

---

## Phase 9 — Client payments and finance

Manual payment entry with the full status lifecycle · idempotency (§42 test 10) · payment
ledger · expenses across eight categories · the complete `transactions` ledger · receivables
· **the owner-run reconciliation routine** (R-04) · Settings → Usage read counter (§54).

**Gate:** §42 tests 5, 10, and 13 — the reconciliation property test. This is where R-01 gets
settled in code, so I will need your answer by then.

---

## Phase 10 — Reports

Seven reports (§37) · CSV export · Recharts, lazy-loaded · Settings → Backup (§41, R-15).

---

## Phase 11 — Language

Full `hi` translation · locale switch persisted · Devanagari rendering across every screen ·
Indian digit grouping in both locales · **review with your father in Hindi**, because a
translation that is technically correct and idiomatically wrong is still wrong.

**v1 ends here.** Everything above runs on Spark at ₹0 and is a complete, usable product.

---

## Phase 12–14 — AI

Gated on the Blaze decision (ADR-002). Designed in `AI_ARCHITECTURE.md`; deferred, not
abandoned.

**12 — Text assistant.** Provider adapter · the twelve read tools (§31) · authorisation at
the tool boundary · grounded responses · write proposals with mandatory confirmation (§32) ·
Hinglish intent handling.

**13 — Voice.** *Opens with the R-09 accuracy spike*: twenty real phrases, spoken by a real
user, scored — before any UI is built. Then STT/TTS, the large microphone button (§33), and
a constrained command grammar if open-ended recognition proves unreliable.

**14 — Document processing.** Payment screenshot OCR · bank statement parsing · quotation to
BOQ draft. Everything extracted enters as `SUGGESTED` and requires human confirmation (§34).

---

## Phase 15 — Production hardening

Full Security Rules review, every collection × role × operation · App Check moved to
enforcement · performance and bundle audit · offline sync review · financial consistency
review across the whole ledger · accessibility audit · real-device testing · staging and
production Firebase projects (§46) · production deployment gate (§48).

**Gate:** no known correctness or security defect. Every risk in `RISKS.md` is closed,
mitigated, or explicitly accepted in writing.

---

## Sequencing notes

**Why language is Phase 11, not Phase 1.** §29 says do not hardcode strings, and we will not
— every string is a translation key from Phase 1. But *writing* the Hindi happens once the
screens have stopped moving. Translating a UI three times is waste.

**Why AI is last.** §2 is clear that this is not an AI product; it is a financial system that
will eventually have an assistant. §51 puts every number under deterministic control. Build
the truth first, then the interface to it — and the assistant is more useful when there is
real data to ask about.

**Why offline attendance sits at Phase 7 rather than earlier.** It is the highest-risk
technical feature (R-02), and it needs the labour model beneath it. Early enough to fail
safely, late enough to build on solid ground.

---

## Phases 5–11 — Result, 2026-08-29

Built in one pass at the owner's request, overriding §58's phase-by-phase approval gate.
Every phase still passed the same gate before the next began.

| Phase | What shipped |
|---|---|
| **5 Measurements** | Measurement book, monthly sheets, submit → approve workflow, live §4 quantity checking, approval transaction that moves `completedQty` atomically |
| **6 Billing** | Bill generation from approved measurements, transactional bill numbering per FY, frozen line snapshots, GST/TDS/retention through one formula, printable bill, cancellation with reversal |
| **7 Labour + attendance** | Labour roster, per-project assignments and rates, offline attendance on deterministic IDs, online/offline indicator |
| **8 Wages** | `wageCalculator` (§14 example exact), per-record rate handling, earned/paid/payable ledger, advances shown as negative |
| **9 Payments + expenses** | Client receipts with bill settlement, labour payments, expenses, append-only ledger, idempotency keys |
| **10 Reports** | Seven reports, each rendering to **PDF and spreadsheet from one definition**; doubles as the §41 backup |
| **11 Language** | English + Hindi, type-checked translation table, toggle in the header — **partial coverage, see below** |

**433 tests** — 276 unit, 157 Security Rules.

### Design decisions worth recording

- **Approval re-validates against live quantities.** The §4 check runs again inside the
  approval transaction, not just at draft time. Two supervisors can each write a sheet that
  is valid alone; the second approval fails with the specific item and shortfall (R-13).
- **Measurements accumulate within a sheet.** Two lines against the same BOQ item are checked
  against each other, so Block A 6,000 + Block B 6,000 against a 10,000 contract is rejected
  rather than passing line by line.
- **Bill numbers are allocated at generation, not at draft**, so abandoned drafts leave no
  gaps — which matters if GST invoicing is ever switched on.
- **Attendance is a plain write, never a transaction.** Transactions fail outright offline
  (R-02) and §13 forbids losing attendance to a network failure. The deterministic ID makes
  replay idempotent, and Rules enforce the ID format so a client cannot sidestep it.
- **Financial writes fail loudly offline** rather than appearing to succeed.
- **Attendance inside a locked wage period is immutable** — it has been paid against.
- **LABOUR-category expenses are excluded from `otherExpenses`**, since `labourPaid` already
  covers wages. Counting both would double every worker's cost.
- **PDFs are browser-printed HTML, not a PDF library.** Saves ~400 KB of bundle, produces
  selectable text, and renders Devanagari natively rather than needing an embedded subsetted
  font with correct conjunct shaping (R-08).
- **CSV escapes formula-leading cells.** A description starting `=` executes on open in Excel;
  that is a real attack vector, and the export carries a UTF-8 BOM so Hindi names are readable.

### Phase 11 is partial, deliberately flagged

The infrastructure is complete and type-safe — a missing Hindi key is a compile error. Fully
translated: **the app shell, navigation, and the entire attendance screen**, which is what a
Hindi-speaking supervisor actually touches daily.

Not yet translated: projects, BOQ, measurements, bills, wages, reports and settings. Those are
office screens used by roles who read English, so the practical gap is small — but §29 asked
for no hardcoded strings anywhere, and that is not yet true. Retrofitting the remaining
~150 strings is mechanical work, not design work.

---

## Phase 12–14 — AI: BLOCKED, not skipped

**Cannot be built without a billing decision.** Firebase AI Logic and Cloud Functions both
require the Blaze plan, and a provider key shipped in the browser bundle would be readable by
anyone — which §47 explicitly says to stop and document rather than leak.

What exists instead (`packages/shared/src/ai/tools.ts`, 20 tests):

- **11 tool definitions** covering every query in §30, each with its required permission and
  project-scoping flag.
- **No write tool exists.** Mutating tools are named `propose*` and return an object a human
  confirms; the app performs the write. §32 made this mandatory and the tests enforce it.
- **Authorisation runs in code**, via the same `can()` used by the UI — never by asking a
  model to respect a role.
- **`getClientOutstanding` returns all three figures**, so the assistant cannot quietly pick
  one meaning of "kitna baaki hai" and sound authoritative (R-01).
- **Safety rules** from §52 as constants, with tests asserting each is present.

When Blaze is enabled, connecting a provider is an adapter over tested code, not a rewrite.

**Phase 13 additionally needs the R-09 spike** — Web Speech API Hindi accuracy on construction
vocabulary is unproven and should be measured before any UI is built on it.

---

## Phase 15 — Production hardening: partial

Done throughout rather than as a final pass:

- **Security** — 157 rules tests; every collection, every role, denial cases included.
- **Financial consistency** — reconciliation tool in Settings re-derives any project's totals
  from source records and shows a diff before writing (R-04).
- **Performance** — every query bounded; dashboards read summary documents, never raw
  collections (R-10).
- **Error handling** — error boundary, Firestore error translation, auto-retry on transient
  failures like index builds.
- **Accessibility** — 44px minimum touch targets, `aria-label` on icon buttons, `role="alert"`
  on errors.

**Still outstanding:** App Check (worth enabling once there is real traffic to observe),
a browser/device test pass on an actual site phone, and the Phase 11 translation gap.
