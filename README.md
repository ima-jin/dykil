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
   this app's `appDid`, registry `id`, and its own keypair (used only for legacy-import self-signing).
2. **Set env**: `cp .env.example .env.local`, then fill in `IMAJIN_APP_DID`, `NEXT_PUBLIC_IMAJIN_APP_ID`,
   `AUTH_SERVICE_URL`, `MEDIA_SERVICE_URL`. This app refuses to start without `IMAJIN_APP_DID` (see
   `instrumentation.ts`).
3. **Install dependencies** — `@ima-jin/auth`, `@ima-jin/config`, and `@ima-jin/logger` are published to GitHub
   Packages only (see `.npmrc`), needing a `read:packages` token:
   ```bash
   export GITHUB_PACKAGES_TOKEN="<a token with read:packages>"
   pnpm install
   ```
   > `pnpm-lock.yaml` in this PR does not yet include those three packages — the environment this
   > PR was built in had no `read:packages` token for the `ima-jin` org (see `docs/packages/PUBLISHING.md`
   > upstream). The first real `pnpm install` above, run with a valid token, completes the lockfile;
   > commit that update before merging or deploying. `pnpm install --frozen-lockfile` (CI) will fail
   > loudly until then, the same way `sonarcloud.yml` fails loudly without `SONAR_TOKEN` — on purpose.
4. **Run it**:
   ```bash
   pnpm dev
   ```
   `/api/health` and `/api/spec` respond immediately.

## The 10 routes

| Route | What |
|---|---|
| `GET /api/health` | health check |
| `GET /api/spec` | this app's own OpenAPI document |
| `POST /api/surveys` | create a survey (a signed media-asset document) |
| `GET /api/surveys/mine` | list the caller's own surveys |
| `GET /api/surveys/handle/:handle` | published surveys by handle (unimplemented stub — no public handle→DID resolver exists; see `FINDINGS.md`) |
| `GET/PUT/DELETE /api/surveys/:id` | read (public if published), update/delete (owner only) |
| `POST /api/surveys/:id/respond` | submit a respondent-signed response (an attestation) |
| `GET /api/surveys/:id/responses` | all responses for a survey, as attestations (owner only) |
| `GET /api/surveys/:id/responses/check` | has the caller (or a given ticket) already responded — replaces the original `responses/by-ticket/:ticketId` row read |

## Auth

Every route authenticates through one interface — `authenticate()` in `src/lib/auth/authenticate.ts` — never
`@ima-jin/auth`'s primitives directly. See `docs/ARCHITECTURE.md` and `FINDINGS.md` for why the underlying
mechanism (currently `requireSessionOrAppToken`) is a deliberately swappable, still-open decision.

## Consuming `@ima-jin/*`

`@ima-jin/auth`, `@ima-jin/config`, and `@ima-jin/logger` are published to **GitHub Packages**
(`npm.pkg.github.com`, `@ima-jin` scope) — see `docs/packages/PUBLISHING.md` upstream, which names this app as
their first out-of-repo consumer. Anonymous `npm install` doesn't work for them; you need a `read:packages` token
(see `.npmrc`). CI (`ci.yml`, `sonarcloud.yml`) reads that token from a `GITHUB_PACKAGES_TOKEN` repo/org secret.

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
    ticket-gate.ts         <- the composable ticket-holder gate (stubbed, see FINDINGS.md)
    kernel/
      media.ts             <- kernel media-service client (survey documents)
      attestations.ts      <- kernel auth-service client (responses)
    auth/
      authenticate.ts       <- this app's single inbound-auth interface
scripts/
  import-legacy.ts  <- one-pass legacy backport, dry-run by default
api-spec/          <- this app's own OpenAPI document, served at /api/spec
instrumentation.ts <- refuses to boot without IMAJIN_APP_DID
```

## The honest test

Every Imajin app before the external integrators was first-party (same repo, same server, privileged access). This
extraction is the **external-integrator** test for dykil specifically: this run's finding (`FINDINGS.md`) is
whether a real vertical survives being rebuilt on the primitives, or collapses into configuration — and, candidly,
which specific kernel gaps currently block the "external" half of that test from being exercised end-to-end.
