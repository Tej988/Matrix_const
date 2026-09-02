# Matrix Construction — Management & Financial Platform

A construction business management platform for a family-owned contracting business.
Digitises the chain that turns work into money:

```
Client → Project → Contract/BOQ → Measurement → Bill → Client Payment
Project → Labour → Attendance → Wage → Labour Payment
Project → Expenses
                    ↓
          Project Financial Summary
```

**Status: phases 0–10 complete, 11 partial, 12–14 blocked on a billing decision.**
433 tests passing. Deployed rules and indexes on `matrix-const`, running at ₹0 on Spark.

The full money chain works end to end: client → project → rate card → measurement → approval
→ bill → payment, alongside labour, offline attendance, wages and expenses.

---

## Documents

Read in this order.

| | Document | What it settles |
|---|---|---|
| 1 | [DECISIONS.md](docs/DECISIONS.md) | The nine binding decisions and eight standing assumptions. **Start here** — everything else is downstream. |
| 2 | [RISKS.md](docs/RISKS.md) | Fifteen ambiguities and technical risks, ranked. Including a contradiction in the spec itself. |
| 3 | [PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) | Users, functional requirements traced to the spec, what is out of scope. |
| 4 | [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System shape, stack, folder structure, layering, offline strategy. |
| 5 | [DATABASE.md](docs/DATABASE.md) | Firestore model, ER diagram, every collection, indexes. |
| 6 | [API_AND_SERVICES.md](docs/API_AND_SERVICES.md) | TypeScript contracts between layers. |
| 7 | [SECURITY.md](docs/SECURITY.md) | Roles, Security Rules, threat model, the Drive offboarding gap. |
| 8 | [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) | Tool registry and safety model. Designed now, built Phase 12. |
| 9 | [TESTING.md](docs/TESTING.md) | The thirteen critical tests and the per-phase gate. |
| 10 | [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Firebase and Drive setup, CI/CD, cost control. |
| 11 | [PHASES.md](docs/PHASES.md) | The sixteen phases and what closes each one. |

The original brief is [prompt.md](prompt.md).

---

## The four decisions that shape everything

**Web PWA first** (ADR-001). One React app, installable on Android, with `apps/mobile`
reserved for Expo later. Building both from Phase 1 would double every UI phase.

**Spark plan, ₹0, AI deferred** (ADR-002). Cloud Functions and Firebase AI Logic both require
Blaze — that is a hard platform gate, not a configuration detail. So there is **no server**,
which means Security Rules are the only enforcement boundary, summaries are maintained by
client-side transactions, and no server-side secret can exist. That last point is exactly
why the AI assistant is designed now and built in Phase 12 rather than half-built today.

**Google Drive for files, Google Sign-In for auth** (ADR-009). Firebase Storage most likely
cannot be provisioned on Spark for a new project, so spec §35's storage design probably is
not available to us. Drive gives 15 GB free, the `drive.file` scope keeps the app out of
everyone's personal files, and one-tap Google login removes a password your father would
otherwise have to remember.

**Integer paise everywhere** (ADR-004). Floats cannot represent ₹0.10. A branded `Paise` type
makes the rupees/paise mistake a compile error.

---

## Two things that need your answer

**The spec contradicts itself about "outstanding"** (R-01). §8 insists outstanding must never
be derived from contract value — but §17's own worked example does exactly that: contract
₹18,50,000, billed ₹10,00,000, received ₹10,00,000, "outstanding" ₹8,50,000. If ₹10 lakh was
billed and ₹10 lakh received, the receivable is ₹0; the ₹8,50,000 is unbilled contract
balance. Both are real numbers, they mean different things, and the dashboard leads with one.

So: when your father asks *"Tata project mein kitna baaki hai?"* — does he mean work left to
bill, or money invoiced and unpaid? The model keeps all three quantities separate either way;
this decides which one leads.

**Are you the contractor or a subcontractor?** (A3). I have assumed the business raises bills
*to* Tata Project Limited, with Stonede / Rakesh Rao as the client contact. If it is the
other way round, the receivables model inverts.

Neither blocked the build. **R-01 is resolved in the model rather than by choosing**: all
three figures are computed and labelled separately everywhere they appear, so whichever your
father means is on screen with an unambiguous name. **A3 was assumed** as
contractor-bills-client; reversing it changes `outstanding.ts` and its tests, not the schema.

---

## Getting started

Toolchain verified 2026-08-27 — Node 24.20.0, npm 11.19.0, firebase-tools 15.28.1, JDK 21,
Windows native. Details and the WSL benchmark that ruled out the alternative are in
[DEPLOYMENT.md](docs/DEPLOYMENT.md) §1.

```bash
npm install          # done
npm run check        # lint -> typecheck -> unit tests -> rules tests -> build
npm test             # fast unit suite only
npm run test:rules   # Security Rules against the Firestore emulator
npm run emulators    # emulator UI on http://127.0.0.1:4000
npm run dev          # Vite on http://localhost:5173
```

Firebase is connected (`matrix-const`), rules and indexes are deployed, and
`apps/web/.env.local` is filled in. `npm run dev` runs against the live project.

```bash
firebase deploy --only firestore     # rules + indexes
firebase deploy --only hosting       # after npm run build
```
