# Environments — dykil

Every environment variable the dykil app reads — directly, through its `@ima-jin/*` dependencies, or in its
scripts — with what it does, when it is read, and its dev and prod values. This file, `.env.example`, and
`scripts/lib/env-manifest.mjs` are kept in lock-step by `scripts/__tests__/env-docs.test.ts`: CI fails if code
starts reading a variable that is not documented here.

No secret values live in this repo. Examples are shape-only placeholders; real values live in the untracked
`.env.local` on each host.

## The three env files

| File | Used for | Lands at |
|---|---|---|
| `.env.example` | local development (`pnpm dev`) | `.env.local` in your working copy |
| `.env.dev.example` | the dev deployment (`dev-dykil`, port 3101, `https://dev-jin.imajin.ai/dykil`) | `~/dev/dykil/.env.local` |
| `.env.prod.example` | the prod deployment (`prod-dykil`, port 7101, `https://jin.imajin.ai/dykil`) | `~/prod/dykil/.env.local` |

On a server: `cp .env.<env>.example .env.local && chmod 600 .env.local`, fill the placeholders, then
`node scripts/check-env.mjs <prod|dev>`. `scripts/deploy.sh` runs that check for you on every deploy, and pm2 loads
the same file with `node --env-file` (see `ecosystem.config.cjs`).

## Build-time vs runtime

`next build` bakes every `NEXT_PUBLIC_*` value into the build. **Changing one means rebuilding** —
`scripts/deploy.sh` loads the env file for the build, so a normal deploy handles it. Variables marked *runtime* are
read when the process starts or per request; a `pm2 restart --update-env` is enough. Variables marked *script* are
read only by an operator script (`scripts/legacy-baseline.mjs`, `scripts/import-legacy.ts`), never by the running app.

## Dev vs prod at a glance

- **Kernel host.** Dev talks only to `https://dev-jin.imajin.ai`; prod only to `https://jin.imajin.ai`.
  `check-env.mjs` rejects a dev file pointing at a non-`dev-` host and a prod file pointing at a `dev-` host.
- **`IMAJIN_ENV`.** `dev` on dev (selects the `imajin_session_dev` cookie), **unset** on prod. A production build is
  `NODE_ENV=production` on both, so this is the only thing that tells dev from prod.
- **No database of its own.** dykil owns no schema, so there is no `DATABASE_URL` or `APP_DB_SCHEMA`. The only
  database variable is `LEGACY_DATABASE_URL`, a read-only connection to the old `dykil.*` tables
  ([MIGRATIONS.md](./MIGRATIONS.md)).
- **Identity.** Each environment has its own app DID, claim code and keystore ([REGISTRATION.md](./REGISTRATION.md)).
- **Port.** dev 3101, prod 7101 (from `ecosystem.config.cjs`, not the env file).

## Required on every deployed instance

Missing any of these and `scripts/check-env.mjs` fails the deploy before anything is built.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `AUTH_SERVICE_URL` | runtime | `https://dev-jin.imajin.ai/auth` | `https://jin.imajin.ai/auth` | Kernel auth service base URL, including the /auth prefix. Read by @ima-jin/auth for session and app-token verification and by the attestation client. |
| `MEDIA_SERVICE_URL` | runtime | `https://dev-jin.imajin.ai/media` | `https://jin.imajin.ai/media` | Kernel media service base URL, including the /media prefix. Survey definitions are signed documents (media assets) stored here. |
| `IMAJIN_KERNEL_URL` | runtime | `https://dev-jin.imajin.ai` | `https://jin.imajin.ai` | Kernel base URL (no path). Used by loadAppSigningKey() to redeem the claim code and to fetch this app's signing key at boot. |
| `NEXT_PUBLIC_IMAJIN_AUTH_URL` | build | `https://dev-jin.imajin.ai` | `https://jin.imajin.ai` | Kernel origin (no path) the "Sign in with Imajin" link points at (`<value>/auth`). Baked into the client bundle at BUILD time; rebuild after changing. |
| `NEXT_PUBLIC_APP_URL` | runtime | `https://dev-jin.imajin.ai/dykil` | `https://jin.imajin.ai/dykil` | This app's public URL. Its HOST is the `aud` used to verify scoped app tokens — it must match a host in this app's registered tokenAudiences (operator-confirmed at registration, docs/REGISTRATION.md). |
| `IMAJIN_APP_DID` | runtime | `did:imajin:<dev app DID>` | `did:imajin:<prod app DID>` | This app's own did:imajin:… from registration (docs/REGISTRATION.md); dev and prod each have their own. Required on every boot once a keystore exists. Not a secret. |

## First boot only

Advanced/CI path only. The normal path needs no variable at all — paste the claim code at `<app>/claim`.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `IMAJIN_APP_CLAIM_CODE` **(secret)** | runtime | (only for the CI claim path) | (only for the CI claim path) | Advanced/CI fallback. The normal operator path is pasting the one-time code from the kernel operator's /jin approval card on `<app>/claim` (imajin-ai#2427) — no env var needed. If set, it is spent on first boot (no keystore yet) or a lost-keystore rebind; delete it afterwards. |

## Optional

Read by the app, its dependencies or its scripts, and safe to leave unset (the default or degraded mode is noted).

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `IMAJIN_ENV` | runtime | `dev` | (unset) | Selects the kernel session cookie name in @ima-jin/config: `dev` → imajin_session_dev, anything else → imajin_session. MUST be `dev` on the dev instance (a production build is NODE_ENV=production, which does not imply dev); leave unset on prod. |
| `IMAJIN_APP_KEYSTORE` | runtime | `/home/jin/.imajin/dykil.dev.keystore.json` | `/home/jin/.imajin/dykil.prod.keystore.json` | Path of this app's 0600 bootstrap keystore (never the vault key itself). Default ./.imajin/keystore.json relative to the process cwd. Set it to an absolute path outside the checkout so it persists across deploys, and keep it separate for dev and prod. |
| `DYKIL_RESPONSE_ATTESTATION_TYPE` | runtime | `dykil/survey-response` | `dykil/survey-response` | Attestation type a respondent-signed response is issued under (default `dykil/survey-response`). Must already be registered with the kernel (docs/REGISTRATION.md §5). |
| `DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE` | runtime | `dykil/survey-response-legacy-import` | `dykil/survey-response-legacy-import` | Attestation type for NODE-WITNESSED legacy-import rows (default `dykil/survey-response-legacy-import`). Used by scripts/import-legacy.ts and when reading imported responses. |
| `EVENTS_SERVICE_URL` | runtime | `https://dev-jin.imajin.ai/events` | `https://jin.imajin.ai/events` | Events service base URL (`<kernel>/events`). Only ticket-gated surveys need it; they answer 501 until it is set. |
| `DYKIL_EVENTS_AUTHORIZATION_ID` | runtime | (operator-created attestation id) | (operator-created attestation id) | Id of the `app.authorized` attestation granting this app `events:read`; the ticket gate mints its token against it. Operator-created per environment; ticket-gated surveys answer 501 until set. |
| `LEGACY_DATABASE_URL` **(secret)** | script | `postgres://<read-only role>:<password>@localhost:5432/<dev_db>` | `postgres://<read-only role>:<password>@localhost:5432/<prod_db>` | Connection string for the OLD dykil.* Postgres schema, via a READ-ONLY role. Read only by scripts/legacy-baseline.mjs (deploy step 6) and scripts/import-legacy.ts — never at request time. Unset it once the legacy data is retired. |
| `NEXT_PUBLIC_SERVICE_PREFIX` | build | (unset) | (unset) | Read by @ima-jin/config to derive service URLs. dykil takes every service URL from its own env vars; leave unset. |
| `NEXT_PUBLIC_DOMAIN` | build | (unset) | (unset) | Companion to NEXT_PUBLIC_SERVICE_PREFIX (default imajin.ai). Leave unset. |
| `NEXT_PUBLIC_NOTIFY_URL` | build | (unset) | (unset) | Read by the shared @ima-jin/ui NavBar for its notification bell. dykil has no notifications of its own; leave unset. |
| `NEXT_PUBLIC_VERSION` | build | (unset) | (unset) | Read by @ima-jin/ui's build-info footer line. Optional cosmetic build stamp; leave unset. |
| `NEXT_PUBLIC_BUILD_HASH` | build | (unset) | (unset) | Companion to NEXT_PUBLIC_VERSION: commit hash shown in the @ima-jin/ui build-info line. Leave unset. |
| `NEXT_PUBLIC_COMMIT_COUNT` | build | (unset) | (unset) | Companion to NEXT_PUBLIC_VERSION: commit count shown in the @ima-jin/ui build-info line. Leave unset. |
| `LOG_LEVEL` | runtime | `debug` | `info` | pino log level for @ima-jin/logger (default info). Output is stdout only; pm2 captures it. |
| `ENABLE_REQUEST_LOG` | runtime | (unset) | (unset) | Logger request-log switch. Leave unset: this app wires no log sink (AGENTS.md — stdout only). |
| `ENABLE_APP_LOG` | runtime | (unset) | (unset) | Logger persisted-log switch. Leave unset: this app never persists logs to a database. |
| `LOG_DB_TRANSPORT` | runtime | (unset) | (unset) | Logger DB-transport switch. Leave unset: logging must never touch a data store (AGENTS.md). |
| `APP_LOG_LEVEL` | runtime | (unset) | (unset) | Minimum level the logger would persist (default warn). Inert while persistence is off. |

## Forbidden

Setting any of these is an error.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `DYKIL_APP_PRIVATE_KEY` **(secret)** | runtime | (never set) | (never set) | Removed. The app throws at boot if this is set — the signing key comes from loadAppSigningKey(), never from env. |

## Set by the platform — not in the env file

Provided by pm2 (`ecosystem.config.cjs`), Next.js or `next.config.mjs`.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `PORT` | runtime | `3101` | `7101` | Listen port. Set by the pm2 ecosystem entry (prod 7101, dev 3101); only used directly by `pnpm dev`. |
| `NODE_ENV` | runtime | `production` | `production` | Set to `production` by the pm2 entry and by `next build`/`next start`. Do not set it in the env file. |
| `NEXT_RUNTIME` | runtime | (set by Next.js) | (set by Next.js) | Injected by Next.js; instrumentation.ts only bootstraps the signing key when it is `nodejs`. Never set by hand. |
| `NEXT_PUBLIC_BASE_PATH` | build | `/dykil` | `/dykil` | Reverse-proxy path prefix (`/dykil`). Set by next.config.mjs at build time — not an env-file value. The Caddy route forwards the prefix intact. |

## Read by dependencies on paths dykil does not use

Leave unset. Listed so the contract covers every variable the installed packages read.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `ATTESTATION_INTERNAL_API_KEY` **(secret)** | runtime | (unset) | (unset) | @ima-jin/auth act-as / attestation calls. dykil exercises neither; leave unset. Never hand-mint it. |
| `AUTH_INTERNAL_API_KEY` **(secret)** | runtime | (unset) | (unset) | Deprecated @ima-jin/auth internal key (agent delegation). Not used by dykil; leave unset. |
| `PROFILE_SERVICE_URL` | runtime | (unset) | (unset) | @ima-jin/auth credential resolution. Not used by dykil; leave unset. |
| `PROFILE_INTERNAL_API_KEY` **(secret)** | runtime | (unset) | (unset) | @ima-jin/auth credential resolution key. Not used by dykil; leave unset. |
| `NODE_DID` | runtime | (unset) | (unset) | @ima-jin/auth node-act-as check (kernel node DID). Not used by dykil; leave unset. |
| `APP_URL` | runtime | (unset) | (unset) | @ima-jin/auth fallback origin for redirects. dykil does not rely on it; leave unset. |
| `NEXT_PUBLIC_BASE_URL` | runtime | (unset) | (unset) | @ima-jin/auth fallback origin for redirects (after APP_URL). dykil does not rely on it; leave unset. |

## In the app template, read by nothing here

Safe to omit; kept in `.env.example` only for template parity.

| Variable | When | Dev | Prod | What it does |
|---|---|---|---|---|
| `NEXT_PUBLIC_IMAJIN_APP_ID` | build | (optional) | (optional) | Listed in the app template (registry `app_…` id); no code in this repo reads it. Safe to omit. |
| `SESSION_COOKIE_SCOPE` | runtime | `host` | `host` | Listed in the app template; no code in this repo reads it. Safe to omit. |

## Dev example

`.env.dev.example` (copy to `~/dev/dykil/.env.local`):

```dotenv
# dykil — DEV deployment env (dev-dykil, port 3101, https://dev-jin.imajin.ai/dykil)
# Copy to ~/dev/dykil/.env.local on the server (chmod 600) and fill the
# placeholders. Never commit the real file. Reference: docs/ENVIRONMENTS.md.
# Validate with: node scripts/check-env.mjs dev

# --- Build-time (baked in by `next build` — rebuild after changing) ---
NEXT_PUBLIC_IMAJIN_AUTH_URL=https://dev-jin.imajin.ai

# --- Runtime ---
# PORT and NODE_ENV come from the pm2 entry (ecosystem.config.cjs).
NEXT_PUBLIC_APP_URL=https://dev-jin.imajin.ai/dykil
# MUST be `dev` here: selects the imajin_session_dev cookie.
IMAJIN_ENV=dev

AUTH_SERVICE_URL=https://dev-jin.imajin.ai/auth
MEDIA_SERVICE_URL=https://dev-jin.imajin.ai/media
IMAJIN_KERNEL_URL=https://dev-jin.imajin.ai
EVENTS_SERVICE_URL=https://dev-jin.imajin.ai/events
# Operator-created app.authorized attestation id (events:read); optional.
DYKIL_EVENTS_AUTHORIZATION_ID=

# --- Identity (operator step: docs/REGISTRATION.md) ---
IMAJIN_APP_DID=did:imajin:REPLACE_ME
# The normal path needs no claim code in this file: open
# https://dev-jin.imajin.ai/dykil/claim after the first deploy and paste it.
# IMAJIN_APP_CLAIM_CODE=
# Persistent, per-environment keystore (must survive deploys):
IMAJIN_APP_KEYSTORE=/home/jin/.imajin/dykil.dev.keystore.json

# --- Legacy schema (read-only role; deploy step 6 verifies it) ---
LEGACY_DATABASE_URL=postgres://dykil_readonly:CHANGE_ME@localhost:5432/imajin_dev

LOG_LEVEL=debug
```

## Prod example

`.env.prod.example` (copy to `~/prod/dykil/.env.local`):

```dotenv
# dykil — PROD deployment env (prod-dykil, port 7101, https://jin.imajin.ai/dykil)
# Copy to ~/prod/dykil/.env.local on the server (chmod 600) and fill the
# placeholders. Never commit the real file. Reference: docs/ENVIRONMENTS.md.
# Validate with: node scripts/check-env.mjs prod

# --- Build-time (baked in by `next build` — rebuild after changing) ---
NEXT_PUBLIC_IMAJIN_AUTH_URL=https://jin.imajin.ai

# --- Runtime ---
# PORT and NODE_ENV come from the pm2 entry (ecosystem.config.cjs).
NEXT_PUBLIC_APP_URL=https://jin.imajin.ai/dykil
# IMAJIN_ENV is deliberately NOT set on prod (prod uses the imajin_session
# cookie). check-env.mjs rejects IMAJIN_ENV=dev here.

AUTH_SERVICE_URL=https://jin.imajin.ai/auth
MEDIA_SERVICE_URL=https://jin.imajin.ai/media
IMAJIN_KERNEL_URL=https://jin.imajin.ai
EVENTS_SERVICE_URL=https://jin.imajin.ai/events
# Operator-created app.authorized attestation id (events:read); optional.
DYKIL_EVENTS_AUTHORIZATION_ID=

# --- Identity (operator step: docs/REGISTRATION.md) ---
IMAJIN_APP_DID=did:imajin:REPLACE_ME
# The normal path needs no claim code in this file: open
# https://jin.imajin.ai/dykil/claim after the first deploy and paste it.
# IMAJIN_APP_CLAIM_CODE=
# Persistent, per-environment keystore (must survive deploys):
IMAJIN_APP_KEYSTORE=/home/jin/.imajin/dykil.prod.keystore.json

# --- Legacy schema (read-only role; deploy step 6 verifies it) ---
LEGACY_DATABASE_URL=postgres://dykil_readonly:CHANGE_ME@localhost:5432/imajin_prod

LOG_LEVEL=info
```

## Secrets handling

- `LEGACY_DATABASE_URL` (carries a database password) and, on the CI claim path only, `IMAJIN_APP_CLAIM_CODE` are the
  only secret-bearing variables a correct deployment sets. Keep `.env.local` mode `0600`, owned by the deploy user,
  never in git. Use a read-only database role for the legacy URL.
- This app's signing key is **never** in an env file — `DYKIL_APP_PRIVATE_KEY` makes the app refuse to boot. The key is
  fetched at boot by `loadAppSigningKey()`; only the 0600 bootstrap keystore (`IMAJIN_APP_KEYSTORE`) is persisted.
  Treat that file like the claim code: never commit, copy, or sync it.
- `check-env.mjs` and the deploy script print variable *names* only, never values.
