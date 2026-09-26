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
- **Ticket-holder check = a composable gate** — `src/lib/ticket-gate.ts`. dykil never reads ticket rows; the events
  app answers a boolean. As of this writing that endpoint doesn't exist upstream (filed as
  [ima-jin/imajin-ai#2395](https://github.com/ima-jin/imajin-ai/issues/2395)), so the gate is stubbed behind an
  interface and fails loudly (`501`) rather than silently reading ticket data.
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
  -> events app ticket gate (src/lib/ticket-gate.ts)          -- boolean only, not yet real
```

## Known simplifications (honest, not hidden)

- **Draft visibility is unlisted, not cryptographically private.** A survey's `.fair` access level (`public` vs
  `private`) is fixed at asset-creation time — the kernel has no endpoint to flip it later. This app sets `access`
  from the survey's initial `status`, and additionally enforces "draft surveys 404 for non-owners" at the app layer
  by checking the document's own `status` field. Someone holding a draft's raw asset id could still fetch its JSON
  directly from the kernel's public asset-serving endpoint. This mirrors how most "unlisted" documents work
  elsewhere on the web; it is not the same guarantee as `private` visibility, and is called out here rather than
  asserted away.
- **No server-side `context_id` filter on attestations.** `GET {kernel}/auth/api/attestations` filters by
  `subject_did`/`type`/`issuer_did` only. Listing "this survey's responses" fetches all of a survey owner's
  responses (across every survey they own) and filters by `context_id` client-side, paginated up to a bounded
  number of pages. Fine at today's scale; a real gap for a prolific survey owner — filed as
  [ima-jin/imajin-ai#2396](https://github.com/ima-jin/imajin-ai/issues/2396).
- **No public handle→DID resolver exists** (checked `auth.yaml`, `registry.yaml`, `profile.yaml`). The
  `/api/surveys/handle/:handle` route was already an unimplemented stub in the original `apps/dykil` for the same
  reason — this rebuild keeps it honest rather than pretending to solve it. Filed as
  [ima-jin/imajin-ai#2397](https://github.com/ima-jin/imajin-ai/issues/2397).

## Deploy convention

Unchanged from the template: this app's own pm2 ecosystem entry (name `dykil`, same as the original monorepo
service) behind a Caddy route whose `Host` header points at this app's port. Caddy routing itself is unchanged
per #1985's acceptance criteria — only where the process runs, not how traffic reaches it, moves.
