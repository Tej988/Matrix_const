# Deployment

Spec §57 steps 8 and 12, and §45–§49.

**Cost position: ₹0.** Firebase Spark, Google Drive free tier, GitHub Actions free tier for
a public repo. Nothing here requires a card. Blaze is not enabled and will not be without an
explicit decision (ADR-002, §54).

---

## 1. Prerequisites

Verified on this machine, 2026-08-27. **Development runs on Windows natively**, not WSL —
see the note below for why.

| Tool | Required | Installed | Where |
|---|---|---|---|
| Node.js | ≥ 20.19 | ✅ v24.20.0 | `C:\Program Files\nodejs` |
| npm | ≥ 10 | ✅ 11.19.0 | with Node |
| firebase-tools | latest | ✅ 15.28.1 | npm global, user scope |
| Java JDK | ≥ 17 | ✅ 21 | `%LOCALAPPDATA%\Programs\Microsoft\jdk-21…`, user scope |
| Git | any | ✅ 2.42.0 | `…\Programs\Git` |

Verify with `node -v; npm -v; firebase --version; java -version`.

**Java is a dev-time dependency only** — the Firebase Local Emulator Suite is a Java
program. Nothing in the shipped application uses it. It was installed from Microsoft's
official zip into the user profile rather than via an MSI, so it needed no administrator
rights: `JAVA_HOME` and PATH are set at user scope, and uninstalling means deleting that
folder and the two environment variables. This matters here because admin access on this
machine requires an IT request.

### Why Windows and not WSL

WSL Ubuntu 26.04 is present with Node 20.20.2 and would otherwise be the natural choice. It
was rejected because the repository lives on the Windows filesystem, which WSL reaches only
over the 9p bridge. Measured on this machine: writing 800 small files took **27 ms** on the
WSL filesystem and **5,068 ms** through `/mnt/c` — a **188× penalty**. A monorepo
`npm install` writes tens of thousands of files, and Vite's watcher would have to fall back
to polling.

Moving the repository into the Linux filesystem would resolve it, at the cost of relocating
the project out of the Windows path and working through VSCode Remote-WSL. Windows-native
Node was chosen as the least disruptive option. If install times ever become painful, that
relocation is the fix.

---

## 2. Firebase project setup

§46 asks for dev / staging / prod. Three projects on day one is real overhead for a
one-developer build, so we start with **`construction-dev`** and add the others before any
real business data is entered — the sequencing §46 itself permits.

Per environment, in the Firebase Console:

1. Create the project. **Decline Google Analytics** — it is free, but it is another data
   flow with no current use.
2. **Authentication** → enable **Google** as the only provider (ADR-009). Set the support
   email and the public-facing app name; both appear on the consent screen your father sees.
3. **Firestore** → Create database → **production mode** (default deny) → region
   `asia-south1` (Mumbai), for latency and data residency. *Region is permanent.*
4. **Hosting** → register the web app, copy the config into `.env.local`.
5. **App Check** → register reCAPTCHA v3, **monitor-only** initially (`SECURITY.md` §5).
6. **Storage** → attempt to provision a bucket, and **record the result in `RISKS.md` R-05.**
   If it demands Blaze, that confirms the finding and Drive is the answer.

### Google Cloud console, same project

7. **APIs & Services → Library** → search `Google Drive API` → **Enable**.

Steps 8–10 happen in **Google Auth Platform** (`console.cloud.google.com/auth`). Google
renamed and reorganised what used to be one "OAuth consent screen" page into five left-nav
sections, which is why the old instructions no longer match the UI. None of this is
scriptable — there is no `gcloud` or `firebase` command for consent-screen configuration, so
it is console-only by necessity, not by choice.

8. **Branding** — App name (this is the text your father sees on the consent screen, so make
   it `Matrix Construction`, not the project ID), user support email, developer contact
   email. Logo and the home page / privacy / terms links are optional in Testing mode.

9. **Audience** — User type **External**. Publishing status stays **Testing**. Under *Test
   users* → **Add users** → every Google account that will sign in: yours, your father's,
   each supervisor. **This list is the allowlist — an account not on it cannot sign in at
   all.** Testing mode allows 100 users and suppresses the "unverified app" warning, so no
   Google verification is needed at this scale (ADR-009).

10. **Data Access** → **Add or remove scopes** → filter for `drive.file` → tick
    `https://www.googleapis.com/auth/drive.file` → **Update** → **Save**. **Nothing wider.**
    That scope grants access only to files this app itself creates; it cannot read anything
    else in anyone's Drive, and preserving that narrowness is deliberate (`SECURITY.md` §7).

11. **Clients** — Firebase already created a client called *"Web client (auto created by
    Google Service)"*. **Edit that one; do not create a new one.** Add to *Authorized
    JavaScript origins*: `http://localhost:5173`, `https://<project-id>.web.app`,
    `https://<project-id>.firebaseapp.com`. Firebase manages the redirect URI
    (`/__/auth/handler`) itself. Copy the Client ID into `.env.local`.

### Drive folder

12. The owner creates a folder in their own Drive and shares it with staff as Editor. The
    folder ID is the last path segment of its URL.

    **Current value:** `1Azjoa4MqaYctoL9LKxbh2_trtXjlHviT`

    It goes into `settings/app.driveFolderId`. Quota follows the uploader (R-06), which is
    why bill PDFs are uploaded by OWNER/ADMIN.

---

## 3. First owner — a required manual step

There is no Admin SDK on Spark, so the first privileged user cannot be created by code
(ADR-005). This is expected, not a defect. Full procedure in `SECURITY.md` §4; in short:
sign in, copy the UID from the Console, hand-create `users/{uid}` with `role: "OWNER"` and
`status: "ACTIVE"`, reload.

Once per environment.

---

## 4. Configuration

```bash
# apps/web/.env.local — git-ignored. Not secret (SECURITY.md §6), just environment-scoped.
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=construction-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=construction-dev
VITE_FIREBASE_APP_ID=…
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_GOOGLE_OAUTH_CLIENT_ID=….apps.googleusercontent.com
VITE_RECAPTCHA_SITE_KEY=…
VITE_ENV=development
```

A committed `.env.example` documents every key with placeholder values. `.env.local` is
git-ignored. The app fails fast at startup on a missing variable rather than rendering a
broken screen — a Zod schema over `import.meta.env`, checked once.

No secret belongs in this file, and none is needed: the browser OAuth flow is PKCE-based and
secretless.

---

## 5. Local development

```bash
npm install                  # from Matrix_Const/ — workspaces resolve everything
npm run emulators            # Auth + Firestore + Hosting on :4000
npm run dev -w apps/web      # Vite on :5173, pointed at the emulator
npm run seed                 # Tata Project Limited / Stonede sample data (§44 Phase 3)
```

Development runs against the **emulator by default**, never the live project — a guard in
`firebase.ts` refuses to connect a `VITE_ENV=development` build to production Firestore.
Cheap insurance against the afternoon someone seeds test data into real books.

---

## 6. Build and deploy

```bash
npm run build -w apps/web        # → apps/web/dist
firebase deploy --only hosting                        # app
firebase deploy --only firestore:rules,firestore:indexes   # rules and indexes
```

`firebase.json` sets long-lived immutable caching on hashed assets and `no-cache` on
`index.html` and the service worker, so a deploy reaches installed PWAs on next launch
rather than being pinned by a stale cache.

Hosting free tier: 10 GB stored, **360 MB/day transfer**. A ~400 KB gzipped bundle with
proper caching is nowhere near it (R-10), but a botched cache header could be — hence the
explicit config.

---

## 7. CI/CD — deferred past MVP

**Not in the MVP** (owner decision, 2026-08-27). Spec §48 asks for GitHub Actions; that is
deferred until the product is in real use.

The quality gates themselves are **not** deferred — they just run locally instead of in CI:

```bash
npm run check      # lint → typecheck → unit tests → rules tests → build
```

Run it before every commit. It is the same command a CI workflow would run, so adding
`.github/workflows/` later is a copy of one line and nothing else changes. Keeping the gate
as a single script from day one is what makes that true.

---

## 8. Branching — deferred past MVP

**Not in the MVP** (owner decision, 2026-08-27). Work goes straight onto `main` with small,
readable commits (§49 conventions retained: `feat:`, `fix:`, `docs:`, `test:`, `chore:`).

Worth knowing what this trades away: no pull-request review point, and no protected
deployable branch. At one developer with no CI, that overhead buys little. Reintroduce
`develop` and `feature/*` when a second person starts committing, or before real business
data goes in — whichever comes first.

---

## 9. Cost control — §54

| Service | Free limit | Expected | Headroom |
|---|---|---|---|
| Firestore reads | 50,000/day | ~2,000 | 96% |
| Firestore writes | 20,000/day | ~150 | 99% |
| Firestore storage | 1 GiB | < 50 MB | ample |
| Hosting transfer | 360 MB/day | ~20 MB | 94% |
| Auth | unlimited | — | — |
| Drive | 15 GB/account | — | ample |

Settings → Usage renders a session read/write counter (§54), so an accidental unbounded
listener is visible immediately rather than at the daily cap. A budget alert cannot be set
without Blaze; the Console quota page is the manual check.

**Nothing paid is introduced without an ADR and your approval.** If a requirement cannot be
met free, §54's procedure applies: document why, what is needed, the estimated cost, and the
alternative — then wait.

---

## 10. Backup — §41

No scheduled export exists on Spark, so backup is a button: Settings → Backup produces a
full JSON plus per-collection CSVs, client-side, from bounded paginated reads. The UI shows
the date of the last export and **never implies anything automatic** (§41 is explicit about
not claiming disaster recovery that does not exist).

Recommended: monthly, stored in the same Drive folder.
