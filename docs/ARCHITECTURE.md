# Architecture — dykil

> This app is a **lens** over the user's signed records, and owns zero tables of its own. See `AGENTS.md` §1–§3
> and Ryan's ruling on issue #1985 (2026-09-22, DECISION #1985→c) for why.

## Ryan's ruling, restated

dykil does not earn a domain schema. It is rebuilt on kernel primitives:

- **Survey definition = a signed document** — a media asset (`GET/POST {kernel}/media/api/assets`), owned by the
  survey owner's DID. The kernel signs the asset's `.fair` manifest on the owner's behalf today (`ContentSigner`,
  a documented sovereignty tradeoff ahead of user-held keys, #734).
- **Response = an attestation** — "DID X said Y about survey `<docHash>`, signed", carrying an optional ticket ref.
  `POST {kernel}/auth/api/attestations`, `subject_did` = survey owner, `issuer_did` = the respondent, `context_id`
  = the survey's asset id, `payload.docHash` = a content hash of the survey document.
- **Ticket-holder check = a composable gate** — `src/lib/ticket-gate.ts` asks the events app's
  `GET /api/events/{id}/access?did=` (imajin-ai#2395), which answers exactly `{ hasAccess: boolean }`. dykil never
  reads ticket rows. The call carries a scoped `events:read` app token this app mints with its own key
  (`src/lib/events-gate-token.ts`); an unconfigured gate answers `501`, a refused or unreachable one `502` — it
  never degrades to "no ticket" or "has a ticket".
- **dykil itself = a thin app** composing these primitives `onBehalfOf` the respondent, registered per #1990.

## The three-tier projection model

| Tier | What | Owns truth? |
|------|------|-------------|
| **User's signed records** | the survey document (media asset) and the response (attestation) | ✅ source of truth |
| **Kernel domain core** | the media + attestation stores, indexed for query | ❌ derived projection |
| **Events app** | ticket ownership, answered only as a boolean gate | ❌ another app's own record |
| **This app** | request validation, canonical-payload construction, relaying to the kernel | ❌ a lens |

## Auth: one interface, one open decision

Every route authenticates its caller through exactly one function: `authenticate()` in
`src/lib/auth/authenticate.ts`. No route imports `@ima-jin/auth`'s auth primitives directly. Today that function's
body calls `requireSessionOrAppToken` (mirroring coffee's #1974 reference adoption of the #1069 scoped app-token,
per an explicit product decision). Ryan has an open a/b/c card on whether that's the right long-term mechanism
versus the pre-existing `POST /auth/api/apps/token` proof-of-possession flow (`X-App-DID`/`X-App-Authorization`,
AGENTS.md §2) — see the DECISION card in `FINDINGS.md`. Because every route calls `authenticate()` and nothing
else, resolving that decision later is a change to this one file, not a route-by-route migration.

## Request flow

```
Browser / another app
  -> dykil (Authorization: Bearer <app-token> or shared kernel session cookie)
     authenticate() -- src/lib/auth/authenticate.ts (the ONE place this app's inbound auth lives)
  -> dykil's own route logic (src/lib/survey.ts, src/lib/response-attestation.ts, src/lib/ticket-gate.ts)
  -> kernel media service   (src/lib/kernel/media.ts)         -- survey documents
  -> kernel auth service    (src/lib/kernel/attestations.ts)  -- responses
  -> events app ticket gate (src/lib/ticket-gate.ts)          -- boolean only
```

## Surveys: draft and published

A survey's `.fair` access level follows its `status`: only `published` is `public`; `draft` and `closed` are
`private`. Creating a published survey uploads it `public`; every later status change moves the asset with
`PATCH /media/api/assets/{id}/access` (`persistSurveyUpdate` in `src/lib/route-helpers.ts`). The order keeps the
document from being public longer than its status says: going private flips access first, going public flips
it last, after the new content is written. Surveys are listed with
`GET /media/api/assets?context_app=dykil&context_feature=survey` — no filename convention.

## Responses: signed, editable, withdrawable

A response is an attestation: `type: dykil/survey-response`, `subject_did` = the survey owner,
`context_id` = the survey asset id, `payload.docHash` binding it to the definition answered. The `ticketId` is
carried both in the signed payload and as the attestation's indexed `ref` (not part of the signed bytes).

- **One active response per respondent**, unless `settings.multipleResponses`. A second one is a `409` that names
  the response to edit.
- **Edit** = `POST /respond` with `supersedes: <your earlier response id>`. It lives inside the signed payload,
  because the kernel reads `payload.supersedes` and retires the earlier row only when the same DID issued it.
- **Withdraw** = `DELETE /responses/{id}`, the kernel's issuer-only revoke. The record isn't erased; it drops
  out of reads.
- **Owner export** follows the kernel's cursor (`before` / `X-Next-Cursor`) to the end; `?limit=&cursor=` pages.
- **No anonymous path.** `allowAnonymous` was dropped (imajin-ai#2536, ruling c); it is stripped from any
  incoming settings. Reads are `disclosure_scope`-gated, so every kernel call carries the caller's own
  credentials.

## UI (refs #2719)

Every screen the kernel's `apps/dykil` served resolves under `basePath` `/dykil`, rebuilt on the primitives above and
this app's own `api/` routes (reference: `ima-jin/imajin-ai` @ `8500583197b34d3a2dfeb13208562d5bfa1ffe53`,
`apps/dykil/app/`). The shared `@ima-jin/ui` NavBar / toasts / footer are used; no kernel component is copied.

| Route | Screen |
|-------|--------|
| `/` | landing: what dykil is, sign in, my surveys, create |
| `/create`, `/create?id=<id>` | survey / poll builder (signed document through `POST/PUT /api/surveys`) |
| `/dashboard` | the owner's surveys, response counts, share link, edit, delete |
| `/survey/[id]` | take a survey (the shape `Copy Link` produces) |
| `/survey/[id]/results` | owner results: aggregates over the response attestations, individual responses, CSV |
| `/[handle]`, `/[handle]/[surveyId]` | a handle's published surveys; the old `<handle>/<id>` link shape (the id decides) |
| `/embed/[surveyId]` | chrome-free embed for events pages (`?ticketId=`, `?parentOrigin=`; `survey-height` / `survey-completed` postMessage protocol unchanged) |

Screens live in `src/components`, pages in `app/(chrome)` (with the NavBar) and `app/(bare)` (embed, no chrome) are thin.
The browser talks only to this app's `/api/*`; the browser-side journey is `src/lib/client/*`.

**Respondent signing degrades gracefully.** A response must be signed by its respondent's own key and a signed-in browser
session holds none (no SDK signing helper exists; see imajin-ai#2720). So the respondent flow is
answer → `POST /api/surveys/{id}/respond/prepare` (returns the exact canonical bytes to sign, which embed the survey's
content hash) → the respondent signs with their own DID key and pastes the signature → `POST /respond`. The app never
signs for a respondent. `/respond/prepare` and `/respond` build the signed payload with the same function
(`buildRespondentPayload`), so what is signed cannot drift from what the kernel verifies.

**Ticket-gated surveys** (`settings.eventId`): `GET /api/surveys/{id}/gate` asks the events boolean gate about the
caller's own DID before the form is shown, and `/respond` enforces it again. Never a ticket row.

**Public handle listing**: `GET /api/surveys/handle/{handle}` resolves the handle through the kernel's public profile API,
then lists that DID's `public` survey assets. The media list needs a signed-in caller (imajin-ai#2721), so a signed-out
visitor sees a sign-in prompt.

## Known simplifications (honest, not hidden)

- **Scopes and audiences.** Routes require `dykil:read` / `dykil:write` on the token path, but the kernel can't
  yet grant them, and a token minted for dykil is not accepted by the media routes — see
  [ima-jin/imajin-ai#2663](https://github.com/ima-jin/imajin-ai/issues/2663). The shared session cookie works
  today.
- **Handle listing needs a session.** The handle→DID resolver exists (`GET /profile/api/profile/{handle}`,
  [imajin-ai#2397](https://github.com/ima-jin/imajin-ai/issues/2397)), and `/api/surveys/handle/:handle` now uses it, but the
  media list of another DID's public assets is authenticated: [imajin-ai#2721](https://github.com/ima-jin/imajin-ai/issues/2721).
- **Respondent signing is caller-side.** This app never holds a respondent's key, so the UI asks the respondent to paste
  a signature they produced themselves ([imajin-ai#2720](https://github.com/ima-jin/imajin-ai/issues/2720)).

## Deploy convention

Unchanged from the template: this app's own pm2 ecosystem entry (name `dykil`, same as the original monorepo
service) behind a Caddy route whose `Host` header points at this app's port. Caddy routing itself is unchanged
per #1985's acceptance criteria — only where the process runs, not how traffic reaches it, moves.
