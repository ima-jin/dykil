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

## Step 2 update (refs #2521) — what the new kernel primitives changed

Step 2 rebuilt the app on the primitives the first run was missing. Status of the run-1 gaps, and
what step 2 found.

**Closed by kernel work, now used:**

- #2535 `PATCH /media/api/assets/{id}/access` — draft/published is now a real access flip, so a draft
  is `private`, not unlisted-by-obscurity. The "draft-survey visibility" DECISION card above is
  resolved by this (option c, without blocking creation).
- #2648 `GET /media/api/assets?context_app=dykil&context_feature=survey` — surveys are listed by
  upload context, not a filename convention.
- #2396 `context_id`, #2533 cursor paging (`before` / `X-Next-Cursor`), #2534 indexed `ref` — the
  owner listing, the owner export and the ticket lookup are server-side filters now. This also fixes
  the two step-1 defects: reads now carry the caller's credentials, and the pagination loop advances.
- #2649 same-issuer `supersedes` and issuer-only revoke — "edit my answer" and "withdraw my
  answer" (see docs/ARCHITECTURE.md).
- #2395 boolean ticket-holder gate — `src/lib/ticket-gate.ts` calls it for real.
- #2536 ruling c — `allowAnonymous` is dropped; every response is signed.

**Still open (this step's own findings):**

1. **`dykil:read` / `dykil:write` can't be granted.** `POST /auth/api/tokens/app` clamps scopes to the
   kernel's `SCOPE_VOCABULARY`; neither is in it. Token callers get a 403 until it is. The cookie path
   is unaffected. → [ima-jin/imajin-ai#2663](https://github.com/ima-jin/imajin-ai/issues/2663)
2. **One token can't satisfy both dykil and media.** A token has one `aud`; dykil and the media routes
   each verify their own. Attestation calls are not affected. Same issue, #2663.
3. **The events gate credential is operator-supplied.** The gate needs `events:read` via
   `requireAppAuth`; session-less service tokens carry no scopes today, so dykil mints its token through
   `POST /auth/api/apps/token` bound to an `app.authorized` attestation id
   (`DYKIL_EVENTS_AUTHORIZATION_ID`). Until an operator creates that, ticket-gated surveys answer 501.
4. **`scripts/import-legacy.ts` sends the app's own token, but the kernel won't accept it yet.** The script
   mints dykil's own app-service token (`src/lib/app-service-token.ts`, `POST /auth/api/apps/token/service`,
   proof of possession with the vault-held key) and sends it as `Authorization: Bearer` on the media asset POST,
   the attestation POST and the idempotency lookup (dykil#16). The media routes and the attestation route only
   verify a `session-app+jwt`, so `--commit` is refused until
   [ima-jin/imajin-ai#2747](https://github.com/ima-jin/imajin-ai/issues/2747) lands. It also doesn't yet record
   the legacy-id to asset-id map #2522 needs.
5. **Respondent signing is still caller-side.** The respondent must produce the Ed25519 signature
   over `canonicalResponsePayload(...)` itself, including `supersedes` for an edit (#2394 gap, unchanged).
6. **No UI yet.** *(Closed by #2719: every screen is ported, see docs/ARCHITECTURE.md "UI".)*

`DECISION · edit semantics · attestations are immutable, the original upserted a response per
(survey, respondent) · a) one active response per respondent unless settings.multipleResponses; an
edit is a new response with payload.supersedes (409 otherwise) b) always allow many, never supersede
c) block edits · rec: a — matches the original's one-row-per-respondent default, uses the kernel's
supersession chain, and keeps the signed record of every prior version readable by id.`

## Step 2b update (refs #2719) — UI parity

The kernel app's screens are ported onto the primitives (docs/ARCHITECTURE.md, "UI"). What the port found:

- **Respondent signing has no browser path** — the UI degrades to "sign the payload yourself, paste the signature", via a
  new `POST /api/surveys/{id}/respond/prepare`. → [imajin-ai#2720](https://github.com/ima-jin/imajin-ai/issues/2720)
- **Handle listing needs a session** — handle→DID works now (`/profile/api/profile/{handle}`); listing another DID's public
  assets does not answer anonymously. → [imajin-ai#2721](https://github.com/ima-jin/imajin-ai/issues/2721)
- **The events access gate counts `sold`/`used`; the events app writes `valid`** (`confirm-payment.ts`,
  `free-checkout-helpers.ts`). A ticket-gated survey therefore blocks paid and free ticket holders alike until events is
  fixed. Not patched here — the gate is the events app's.
- **Legacy survey ids in existing embeds** (`events.registration_form_id` = `survey_…`) resolve the route but find no
  survey until the import records the old→new id map (#2522, step 4).
- `DECISION · respondent signing · The browser cannot sign a response · a) paste-a-signature step now, wait for a kernel
  signer b) adopt #2394's delegated attestation (app signs, `delegator_did` = respondent) once #2400's consent UI exists
  c) node-witnessed signing for session users · rec: a — it keeps "every new response is respondent-signed" true today;
  b is the likely end-state and needs a ruling that a delegated response counts as respondent-signed.`
