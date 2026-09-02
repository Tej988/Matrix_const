# Security Model

Spec §57 step 9, and §20, §25, §47.

**The governing fact:** there is no server (ADR-002). Firestore Security Rules are not one
layer of defence — they are *the* layer. Everything below follows from taking that
seriously.

---

## 1. Identity

Google Sign-In only (ADR-009). No password to reset, phish, or forget, and the same consent
yields the Drive token.

Sign-in is not authorisation. A successful Google login gives a Firebase UID and nothing
else. Access requires `users/{uid}` to exist with `status: ACTIVE` and a role. **A user with
no such document can read nothing and write nothing** — the default-deny posture that makes
an accidental sign-in by a stranger harmless.

Access can be restricted further with an allowed-domain check in Rules if the business moves
to Google Workspace; today the `users/{uid}` gate is sufficient.

---

## 2. Roles (§20)

| | OWNER | ADMIN | ACCOUNTANT | SUPERVISOR | VIEWER |
|---|:---:|:---:|:---:|:---:|:---:|
| Projects, clients | CRU | CRU | R | R¹ | R |
| Project members | CRUD | CRU | R | R¹ | – |
| BOQ / rate card | CRU | CRU | R | R¹ | R |
| Measurements — enter | ✓ | ✓ | – | ✓¹ | – |
| Measurements — **approve** | ✓ | ✓ | – | **✗** | – |
| Bills — create, generate | ✓ | ✓ | ✓ | – | R |
| Bills — cancel | ✓ | ✓ | – | – | – |
| Client payments — record | ✓ | ✓ | ✓ | – | R |
| Client payments — **confirm** | ✓ | ✓ | ✓ | – | – |
| Labour profiles | CRU | CRU | R | R | R |
| Attendance | CRU | CRU | R | **CRU¹** | R |
| Wage periods — lock | ✓ | ✓ | ✓ | – | R |
| Labour payments | ✓ | ✓ | ✓ | – | R |
| Expenses | ✓ | ✓ | ✓ | ✓¹ | R |
| Reports | ✓ | ✓ | ✓ | ¹ | ✓ |
| Users & roles | ✓ | – | – | – | – |
| Settings | ✓ | R | R | R | R |
| Reconciliation | ✓ | – | – | – | – |
| **Delete anything financial** | **✗** | **✗** | **✗** | **✗** | **✗** |

¹ restricted to projects the user is a member of, via `projectMembers`.

Three deliberate choices. **A supervisor cannot approve their own measurements** — the
separation of duty that makes §6's approval workflow meaningful rather than ceremonial. **A
supervisor sees no financial figures at all**; they mark attendance and enter measurements,
which is their job. **Nobody deletes financial records, including OWNER** (ADR-007) — the
rule holds even for the person who owns the business, because that is what makes the audit
trail worth anything.

---

## 3. Rules structure

Shared helpers, defined once:

```js
function signedIn()      { return request.auth != null; }
function userDoc()       { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
function isActive()      { return signedIn() && userDoc().status == 'ACTIVE'; }
function hasRole(roles)  { return isActive() && userDoc().role in roles; }
function isMember(pid)   { return exists(/databases/$(database)/documents/projectMembers/$(pid + '_' + request.auth.uid)); }
function canSeeProject(pid) { return hasRole(['OWNER','ADMIN','ACCOUNTANT','VIEWER']) || (hasRole(['SUPERVISOR']) && isMember(pid)); }
function positivePaise(v)   { return v is int && v > 0 && v < 100000000000; }
function unchanged(f)       { return request.resource.data[f] == resource.data[f]; }
```

At most two `get()`/`exists()` calls per evaluation, against a limit of 10 per
single-document request (ADR-005). Headroom is fine.

A financial collection, in full:

```js
match /clientPayments/{paymentId} {
  allow read: if canSeeProject(resource.data.projectId)
              && !hasRole(['SUPERVISOR']);          // supervisors see no money

  allow create: if hasRole(['OWNER','ADMIN','ACCOUNTANT'])
                && positivePaise(request.resource.data.amountPaise)
                && request.resource.data.status in ['PENDING','SUGGESTED','CONFIRMED']
                && request.resource.data.createdBy == request.auth.uid
                && request.resource.data.createdAt == request.time
                && request.resource.data.idempotencyKey is string;

  allow update: if hasRole(['OWNER','ADMIN','ACCOUNTANT'])
                && unchanged('projectId')            // immutable after creation
                && unchanged('amountPaise')
                && unchanged('createdBy')
                && unchanged('createdAt')
                && request.resource.data.status != 'PENDING';

  allow delete: if false;                            // ADR-007 — no exceptions
}
```

The pattern generalises: **role gate → field validation → immutability of the fields that
define the record → delete denied.** Amount and project are frozen at creation, so a
"correction" cannot quietly become a different payment; it must be a reversal.

Two rules worth stating on their own:

```js
match /auditLogs/{id} {
  allow create: if isActive() && request.resource.data.userId == request.auth.uid;
  allow read:   if hasRole(['OWNER','ADMIN']);
  allow update, delete: if false;        // append-only, no exceptions
}

match /users/{uid} {
  allow read: if isActive();
  allow update: if request.auth.uid == uid
                && unchanged('role') && unchanged('status')   // ← no self-promotion
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(['displayName','phone','locale','photoUrl','updatedAt']);
  allow create, delete: if hasRole(['OWNER']);
}
```

The self-promotion guard is the single most important line in the ruleset. Without it, any
signed-in user writes `role: 'OWNER'` to their own document and the entire matrix above
evaporates.

---

## 4. Bootstrapping the first owner

A genuine gap, stated plainly. Without the Admin SDK (ADR-002) nothing can mint the first
privileged user, and Rules cannot allow self-assignment of `OWNER` without allowing everyone
to do it.

The procedure, run once per environment by a human:

1. Owner signs in with Google. The app shows **"Your account is awaiting access."** Nothing
   is readable.
2. In the Firebase Console → Authentication, copy the new UID.
3. In Console → Firestore, create `users/{uid}` with `role: "OWNER"`, `status: "ACTIVE"`,
   `displayName`, `email`, `locale: "en"`.
4. Reload. Full access. Every subsequent user is invited from within the app.

Documented in `DEPLOYMENT.md` as a required step. It is manual, it is deliberate, and it is
a one-time cost per environment.

---

## 5. App Check

Rules answer *who is asking*. App Check answers *what is asking* — it blocks scripted
clients hitting the Firestore REST API with a stolen config, which Rules alone cannot
distinguish from the real app.

Enabled with the **reCAPTCHA v3 provider, free on Spark**, in monitor-only mode from Phase 1
so we can watch legitimate traffic, then enforced before real data lands (Phase 15). Debug
tokens cover local development and CI.

---

## 6. Configuration and secrets (§47)

**The Firebase web config is not a secret.** `apiKey`, `authDomain`, `projectId` are
public identifiers by design, shipped in every Firebase web app; they identify the project,
they do not authorise anything. Security comes from Rules and App Check. The same is true of
the Google OAuth **client ID**.

So: config lives in `.env.local` as `VITE_`-prefixed variables and in GitHub Actions secrets
for CI, with `.env.local` git-ignored — for environment hygiene, not confidentiality.

**What must never enter this repo:** an OAuth client *secret* (not needed — the browser flow
is PKCE-based and secretless), a service-account JSON, or any AI provider API key. On the
last one, §47 is explicit and ADR-002 agrees: a browser-shipped AI key is readable by
anyone, so we stop and document rather than leak. That constraint is the direct reason AI is
deferred to Phase 12 rather than half-built now.

---

## 7. Google Drive security (ADR-009)

**Scope is `drive.file` and nothing wider.** It grants access only to files the app itself
creates. The app is structurally incapable of reading the rest of anyone's Drive — worth
preserving against any future convenience argument for `drive.readonly`.

The OAuth access token is held **in memory only**. Never `localStorage`, never
`sessionStorage`, never a cookie: an XSS that reaches a stored Drive token is a far worse
day than one that does not. It is re-acquired silently per session via the GIS token client.

### Offboarding is two steps (R-07)

Drive permissions live outside Firestore and Rules cannot revoke them.

1. In the app: set the user to `DISABLED`. App access stops immediately.
2. In Google Drive: remove them from the shared folder. **Until this happens they retain
   access to every file in it.**

The app shows a blocking reminder with a direct link to the folder's sharing settings when
step 1 is performed. It cannot perform step 2 — that needs a server. A real gap, named
rather than hidden.

---

## 8. Threat model

| Threat | Control | Residual |
|---|---|---|
| Stranger signs in with Google | No `users/{uid}` → default deny | None |
| User escalates own role | `unchanged('role')` in Rules | None |
| Supervisor reads project financials | Role gate on every financial collection | None |
| User writes directly via devtools/REST | Rules validate every field; App Check blocks non-app clients | Rules bugs → emulator test suite |
| Financial record altered after the fact | Immutable fields; delete denied; append-only audit | Console access by a project admin |
| Double-submitted payment | `idempotencyKey` checked inside the transaction | None |
| Bill total ≠ sum of lines | Client-computed, audit-detectable | **Not server-prevented** (R-03) |
| Departed staff retain file access | Manual folder unshare | Window between the two steps (R-07) |
| Drive token stolen via XSS | In-memory only; `drive.file` scope caps blast radius | Files created by the app |
| Quota exhaustion denial-of-service | Bounded queries, no unbounded listeners | Deliberate abuse by a signed-in user (R-10) |

The two rows in bold type are the ones I would not describe as solved. Both trace to
ADR-002, and both close if Blaze is ever enabled.

---

## 9. Privacy

Labour records hold name, phone, role, and wage — no Aadhaar, no ID scans, no photographs
(§10). Wage data is visible only to OWNER, ADMIN, and ACCOUNTANT. Audit logs record who did
what, are readable only by OWNER and ADMIN, and are never surfaced to the person acted upon.
Nothing is shared with any third party; there is no analytics SDK and no error-reporting
service in v1.

---

## 10. Review gates

Rules change without a passing emulator test suite: blocked in CI. A phase does not close
with a failing rules test (§43). Phase 15 runs a full review: every collection, every role,
every operation, including explicit *denial* assertions — testing that ADMIN can write is
half the job; testing that SUPERVISOR cannot is the half that catches real bugs.
