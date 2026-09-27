# FINDINGS — dykil rebuilt on kernel primitives (refs #1985)

Run 1 of 2 for #1985 (new-repo side). This is the honest record the issue asked for: every
primitive I needed and couldn't reach through the public contract, filed as issues on
`ima-jin/imajin-ai`; and the answer to the question this run exists to produce.

## (a) Kernel-gap list

One line each, in the order I hit them building the 10 routes. Full context, the exact call I
wanted, and what this app does instead (never a workaround that reaches into kernel internals)
are in each linked issue.

1. **Media asset write + authenticated-read routes don't accept scoped app-tokens.**
   `POST /media/api/assets`, `PUT /media/api/assets/{id}/content`, `DELETE /media/api/assets/{id}`,
   and `GET /media/api/assets/{id}/content` all gate on `requireAuth` (shared session cookie or a
   legacy bearer), not `requireSessionOrAppToken`/`verifyAppToken` (#1069's scoped app-token, the
   same primitive coffee reference-adopted in #1974). Call wanted: those routes accepting
   `Authorization: Bearer <scoped-app-token>` the way `/auth/api/attestations` already does.
   → [ima-jin/imajin-ai#2393](https://github.com/ima-jin/imajin-ai/issues/2393)
2. **No way for a third-party app to get a genuine respondent-signed attestation.**
   `POST /api/attestations` requires a caller-supplied Ed25519 signature already produced by
   `issuer_did`'s own key; there's no delegated-signing analog to the media service's
   `ContentSigner`, the one delegation mechanism that exists (`payload.delegator_did` +
   `POST /auth/api/grants`) is closed to a fixed MCP/intro-funnel capability vocabulary, and the
   published browser SDK (`@ima-jin/auth-client`) has no signing primitive at all. Call wanted: a
   client-side signing helper backed by a session-scoped kernel signing surface, or a general
   delegation capability a third-party app can request for its own attestation type.
   → [ima-jin/imajin-ai#2394](https://github.com/ima-jin/imajin-ai/issues/2394)
3. **No public boolean ticket-holder gate.** The events app's only ticket-access check
   (`GET /api/events/{id}/my-ticket`) is scoped to the caller's own session and returns full
   ticket/organizer detail, not a `{did, eventId} -> {hasAccess}` gate a third-party app can call.
   Call wanted: exactly that boolean gate, app-token-gated.
   → [ima-jin/imajin-ai#2395](https://github.com/ima-jin/imajin-ai/issues/2395)
4. **`GET /api/attestations` has no `context_id` filter.** Only `subject_did`/`type`/`issuer_did`/
   `status`; a survey owner's response listing has to fetch every response across every survey
   they own and filter client-side. Call wanted: an additional `context_id` query param.
   → [ima-jin/imajin-ai#2396](https://github.com/ima-jin/imajin-ai/issues/2396)
5. **No public handle→DID resolver** (pre-existing — the original `apps/dykil` handle route was
   already an unimplemented stub for this exact reason; confirmed still true across
   `auth.yaml`/`registry.yaml`/`profile.yaml`). Call wanted: `GET {kernel}/api/identity/handle/{handle}`.
   → [ima-jin/imajin-ai#2397](https://github.com/ima-jin/imajin-ai/issues/2397)

No new gaps beyond these five were found in this run.

## (b) Does a vertical survive being rebuilt on the primitives, or does it collapse into configuration?

Mostly the former, with one real asterisk. Architecturally, dykil collapsed almost completely:
zero tables, zero migrations, ~130 lines of domain logic (survey validation, canonical-payload
construction) instead of a schema + CRUD layer, and the two primitives it leans on — a signed
document and an attestation — map onto "survey definition" and "response" with very little
impedance mismatch; a form is genuinely just a signed JSON blob, and a response is genuinely
just a claim someone made about it. That's a real, structural simplification, not a cosmetic
one. But the vertical does NOT fully survive end-to-end *today*, for a specific and narrow
reason rather than a conceptual one: the exact token mechanism #1985/#1990 depend on
(`requireSessionOrAppToken`'s scoped app-tokens) has only been reference-adopted in one call
site in the whole monorepo (coffee's `/api/pages/mine`, #1974) and isn't yet wired into the two
kernel endpoints this app needs most — media writes and attestation issuance both still expect
either the transitional shared session cookie or a signature the caller must already possess.
So the code in this repo is honestly spec-complete and unit-tested (79 tests) against the
intended public contract, but a genuinely external respondent (different domain, no shared
cookie, no raw keypair) cannot exercise the write path against a real host-scoped-cookie kernel
deployment until gaps #1 and #2 close. That is itself a useful, narrow finding: the primitives
are the right shape for this vertical, but "app registers, gets a scoped token, composes
attestations and media as any other caller would" is not yet a fully-closed loop in the
kernel's own current implementation — the gap is in *how far the #1069 token migration has
reached*, not in whether surveys-as-signed-documents-and-attestations is a sound model.

## Design decisions carried into this build (not new, recorded for context)

`DECISION · dykil's own app-token mechanism · Should dykil authenticate its own inbound requests
via @imajin/auth's requireSessionOrAppToken (the #1069 Phase 1 host-scoped session-app-token,
coffee's #1974 pattern) or the pre-existing POST /auth/api/apps/token proof-of-possession flow
(AGENTS.md §2's X-App-DID/X-App-Authorization contract, which needs no shared-cookie-domain
assumption at all and is closer to a "true" third-party OAuth flow) · a) requireSessionOrAppToken
b) apps/token PoP flow c) both, preferring the PoP flow with a cookie fallback · rec: a — kept
per explicit product decision from the prior run; implemented behind a single `authenticate()`
interface (`src/lib/auth/authenticate.ts`) specifically so resolving this later, either way, is a
one-file change rather than a route-by-route migration. Still open — not re-litigated here.`

`DECISION · draft-survey visibility · A survey document's kernel .fair access level (public vs
private) is fixed at creation time — there's no endpoint to flip it later, so a "draft" survey
is unlisted-by-obscurity (app-layer 404 for non-owners) rather than cryptographically private ·
a) accept unlisted-by-obscurity for drafts (current choice) b) re-upload a new asset version on
every status change c) block draft-survey creation until the kernel supports an access-level
PATCH · rec: a — kept per explicit product decision from the prior run; documented honestly in
docs/ARCHITECTURE.md. Still open — not re-litigated here.`

`DECISION · zero-table constraint · The constraint said "no schema migrations — if you believe
this app needs one, stop and write it as a DECISION card instead." I did not hit a case that
needed one. Ryan's ruling had already pre-decided this (DECISION #1985->c); this card exists
only to record that the rebuild was checked against it and found no exception, not to reopen it ·
rec: n/a — confirms, doesn't revisit, the existing decision.`
