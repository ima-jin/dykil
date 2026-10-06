# dykil — surveys & polls on Imajin primitives

> Forked from [`ima-jin/imajin-app-template`](https://github.com/ima-jin/imajin-app-template). **Read
> [`AGENTS.md`](./AGENTS.md) first** — it defines the boundary this app must not cross.

**Platform:** [Imajin](https://imajin.ai) (sovereign-tech kernel) · Extracted per
[ima-jin/imajin-ai#1985](https://github.com/ima-jin/imajin-ai/issues/1985), rebuilt on kernel
primitives per Ryan's ruling (2026-09-22, DECISION #1985→c) — see [`FINDINGS.md`](./FINDINGS.md).

This repository **is the app** — a real, arms-length third-party application that composes the Imajin platform
**only through its public app surface**. It holds **no `workspace:*` deps, no monorepo internals, no database of
its own, no in-process bus**. A survey is a signed document (a kernel media asset); a response is an attestation;
a ticket-holder check composes through a boolean gate on the events app.

## What it replaces

The original `apps/dykil` (still live in `ima-jin/imajin-ai` until Run 2 of #1985 removes it) stored surveys and
responses in its own `dykil.surveys` / `dykil.survey_responses` Postgres tables. This rebuild has zero tables.
`scripts/import-legacy.ts` backports the old data one time: definitions become signed documents, and existing
(never respondent-signed) responses become NODE-WITNESSED LEGACY-IMPORT attestations — distinguishable from
genuine respondent-signed ones in the data, and never upgraded.

## Getting started

1. **Register this app with the kernel** — see [`docs/REGISTRATION.md`](./docs/REGISTRATION.md). You'll get back
   this app's `appDid` and registry `id`; an operator approving `apps.provision` grants it a vault-minted
   signing key and a one-time claim code — this app never holds its own private key in an env file
   (refs [imajin-ai#2411](https://github.com/ima-jin/imajin-ai/issues/2411)).
2. **Set env**: `cp .env.example .env.local`, then fill in `IMAJIN_KERNEL_URL`, `IMAJIN_APP_DID`,
   `NEXT_PUBLIC_IMAJIN_APP_ID`, `AUTH_SERVICE_URL`, and `MEDIA_SERVICE_URL`. This app refuses to
   start on a raw `DYKIL_APP_PRIVATE_KEY` still being set. **Skip `IMAJIN_APP_CLAIM_CODE` for
   now** — without a keystore or claim code, this app boots in "unclaimed" mode (imajin-ai#2427):
   approve on `/jin` → open `<this app>/claim` → paste the code → done.
3. **Install dependencies** — `@ima-jin/auth`, `@ima-jin/auth-client`, `@ima-jin/config`, and `@ima-jin/logger`
   are published to npmjs.org under the `@ima-jin` scope. Anonymous install, no token needed:
   ```bash
   pnpm install
   ```
   > `@ima-jin/auth@0.8.7`'s own manifest depends on `@ima-jin/config@^0.8.7`, which isn't published
   > (only `0.7.0`/`0.8.0`/`1.0.0` are, as of this writing) — `package.json`'s `pnpm.overrides` pins
   > `@ima-jin/config` to the actually-published `0.8.0` so installation succeeds. Drop that override
   > once `@ima-jin/config@0.8.7` (or later, matching auth/logger) is published.
4. **Run it**:
   ```bash
   pnpm dev
   ```
   The app is served under the `/dykil` basePath (Caddy forwards `/dykil/*` with the prefix
   intact). Locally: `http://localhost:3101/dykil` — `/dykil/api/health` and `/dykil/api/spec`
   respond immediately.

## The routes

| Route | What |
|---|---|
| `GET /api/health` | health check (reports `claimed`, imajin-ai#2427) |
| `GET /api/spec` | this app's own OpenAPI document |
| `GET /claim` | operator-facing claim page (unclaimed boot mode only, imajin-ai#2427) |
| `POST /api/claim` | redeem this app's one-time claim code (unclaimed boot mode only) |
| `POST /api/surveys` | create a survey (a signed media-asset document) |
| `GET /api/surveys`, `GET /api/surveys/mine` | list the caller's own surveys |
| `GET /api/surveys/handle/:handle` | published surveys by handle (unimplemented stub — no public handle→DID resolver exists; see `FINDINGS.md`) |
| `GET/PUT/DELETE /api/surveys/:id` | read (public if published), update/delete (owner only) |
| `POST /api/surveys/:id/respond` | submit a respondent-signed response (an attestation); `supersedes` edits your earlier one |
| `GET /api/surveys/:id/responses` | the survey's responses, as attestations (owner only; cursor-paged export) |
| `GET /api/surveys/:id/responses/check` | has the caller (or a given ticket) already responded — replaces the original `responses/by-ticket/:ticketId` row read |
| `DELETE /api/surveys/:id/responses/:responseId` | withdraw your own response (kernel revoke) |

Read routes need the `dykil:read` token scope, mutating routes `dykil:write`. Every response is signed;
there is no anonymous path (imajin-ai#2536).

## Auth

Every route authenticates through one interface — `authenticate()` in `src/lib/auth/authenticate.ts` — never
`@ima-jin/auth`'s primitives directly. See `docs/ARCHITECTURE.md` and `FINDINGS.md` for why the underlying
mechanism (currently `requireSessionOrAppToken`) is a deliberately swappable, still-open decision.

## Consuming `@ima-jin/*`

`@ima-jin/auth`, `@ima-jin/auth-client`, `@ima-jin/config`, and `@ima-jin/logger` are published to **npmjs.org**
under the `@ima-jin` scope — anonymous `npm install`/`pnpm install`, no `.npmrc` scoping and no auth token needed.
See the version-skew note above for the one thing to watch: `@ima-jin/auth`'s dependency on `@ima-jin/config`
currently outpaces what's published for `config` itself. `@ima-jin/auth-client`'s `loadAppSigningKey()` is what
fetches this app's own signing key at boot — see `src/lib/auth/signing-identity.ts` and
[`docs/REGISTRATION.md`](./docs/REGISTRATION.md).

## Layout

```
AGENTS.md          <- boundary + scope for coding agents (read first)
README.md          <- this file
FINDINGS.md         <- kernel-gap list + the "does it collapse" finding (deliverable #6)
docs/
  ARCHITECTURE.md  <- design notes, the three-tier model, known simplifications
  REGISTRATION.md  <- how to register this app + its attestation types with the kernel
app/               <- Next.js App Router: pages + the 10 API routes
src/
  lib/
    survey.ts             <- survey document model + validation
    response-attestation.ts <- response payload shape (respondent-signed vs node-witnessed)
    ticket-gate.ts         <- the composable ticket-holder gate (events app boolean)
    events-gate-token.ts   <- mints the events:read token the gate needs
    responses.ts           <- a survey's responses as attestations (context_id + cursor)
    kernel/
      media.ts             <- kernel media-service client (survey documents)
      attestations.ts      <- kernel auth-service client (responses)
    auth/
      authenticate.ts       <- this app's single inbound-auth interface
      signing-identity.ts   <- this app's own signing key, fetched via loadAppSigningKey()
scripts/
  import-legacy.ts  <- one-pass legacy backport, dry-run by default
api-spec/          <- this app's own OpenAPI document, served at /api/spec
instrumentation.ts <- refuses to boot without a fetchable signing key (loadAppSigningKey())
middleware.ts      <- gates every route on claim state — unclaimed page, /claim 404 once claimed (imajin-ai#2427)
```

`app/claim/page.tsx` + `app/api/claim/route.ts` are the operator-facing claim page and its server
route (imajin-ai#2427) — see [`docs/REGISTRATION.md`](./docs/REGISTRATION.md).

## The honest test

Every Imajin app before the external integrators was first-party (same repo, same server, privileged access). This
extraction is the **external-integrator** test for dykil specifically: this run's finding (`FINDINGS.md`) is
whether a real vertical survives being rebuilt on the primitives, or collapses into configuration — and, candidly,
which specific kernel gaps currently block the "external" half of that test from being exercised end-to-end.
