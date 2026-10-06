# Registering this app with the kernel

Per ima-jin/imajin-ai#1990, the kernel refuses to serve an unregistered app: every app is an
identity — a row in the kernel's app registry — before it can compose the platform. Per
ima-jin/imajin-ai#2411 (ruled b by Ryan, 2026-09-27), this app also never holds a raw private
key in an env file: it **refuses to start** without a signing key it can fetch itself via
`@ima-jin/auth-client`'s `loadAppSigningKey()` (see `instrumentation.ts` and
`src/lib/auth/signing-identity.ts`), so registration + a kernel operator's `apps.provision`
approval are the first things a fork needs, before `pnpm dev`.

## 1. Register (self-service)

You must already be signed in to the kernel as a developer (a human DID) before calling this —
the endpoint is `requireAuth`-gated to whoever owns the app being created.

```bash
curl -X POST "${IMAJIN_AUTH_URL}/api/registry/apps" \
  -H "Content-Type: application/json" \
  -H "Cookie: <your kernel session cookie>" \
  -d '{
    "name": "dykil",
    "callbackUrl": "https://dykil.imajin.ai/api/auth/callback",
    "requestedScopes": []
  }'
```

Response (`201`):

```json
{
  "id": "app_xxxxxxxxxxxxxxxx",
  "ownerDid": "did:imajin:...",
  "name": "dykil",
  "appDid": "did:imajin:...",
  "callbackUrl": "https://dykil.imajin.ai/api/auth/callback",
  "requestedScopes": [],
  "tier": "third_party",
  "allowedRedirectHosts": ["https://dykil.imajin.ai"],
  "status": "active"
}
```

This step only mints the app's identity (its `appDid` and registry `id`) — it does **not** hand
back a private key. The app's actual signing key stays in the kernel's vault until a kernel
operator grants it in step 2.

## 2. Grant this app a signing key (`apps.provision`, operator-side)

A kernel operator approves `apps.provision` on the `/jin` dashboard, which mints this app's
Ed25519 signing key **in the vault** and grants it to this app's own DID — never handing the
plaintext key to a human. That approval's response surfaces a one-time, ~15-minute **claim
code** exactly once (`data.claimCode` on the `/jin` decision card). Copy it immediately —
it cannot be retrieved again; if it's lost or expires unused, the operator re-approves
`apps.provision` with `reissueClaim: true` for a fresh one.

### The operator path (recommended): paste the code in the browser

Open `<this app's URL>/claim` and paste the claim code (and the app DID, if the card shows one, to
confirm you're claiming the right app). Submit — no ssh, no env file edit, no restart. This app's
own `app/api/claim/route.ts` calls the kernel's `POST /api/apps/claim` on your behalf, writes the
local bootstrap keystore (`IMAJIN_APP_KEYSTORE`, default `./.imajin/keystore.json`, mode `0600`),
and hot-swaps the in-memory signing identity immediately. `/claim` 404s once this succeeds; the
code is spent and cannot be reused.

This is only possible because this app boots in **unclaimed mode** (imajin-ai#2427) when neither a
keystore nor `IMAJIN_APP_CLAIM_CODE` is present: instead of crashing at boot, every route except
`/claim`, `/api/claim`, and `/api/health` serves a minimal "not claimed yet" page, and
`/api/health` reports `{ claimed: false }`.

### Proxy trust assumption (rate limiting on `/claim`)

`POST /api/claim` is rate limited per client address, and the only address it trusts is the
**last** hop of `X-Forwarded-For` — the one appended by this app's own front door. That is only
sound if both of these hold:

- **The front door must set `X-Forwarded-For`.** Caddy's `reverse_proxy` does this by default
  (with no `trusted_proxies` configured, it discards any client-supplied value and appends the
  real peer address). Any other proxy must be configured to do the same. `x-real-ip` is never
  consulted — a proxy does not overwrite it, so it is fully client-controlled.
- **The app port must not be directly reachable.** Bind it to localhost or a private network
  and firewall it, so every request arrives through the front door. A client that can reach the
  port directly can send any `X-Forwarded-For` it likes and sidestep the per-address limit.

Without a usable `X-Forwarded-For`, all callers share one coarse fallback bucket.

### The advanced / CI path: an env var

On this app's own first boot, `loadAppSigningKey()` mints its own Ed25519 "bootstrap" keypair,
exchanges the claim code plus that keypair's public half for the real signing key via
`POST /api/apps/claim`, and persists ONLY the bootstrap keypair (never the signing key) in a
local keystore file. Every later boot re-authenticates with that persisted bootstrap key via
`POST /api/apps/signing-key/fetch` — no claim code spent, no operator action needed. See
[`packages/auth-client`'s README](https://github.com/ima-jin/imajin-ai/blob/main/packages/auth-client/README.md)
upstream for the full mechanism.

## 3. Fields, and what they mean for this app

| Field | Meaning |
|---|---|
| `appDid` | This app's own `did:imajin:…`, derived from its public key. Set as `IMAJIN_APP_DID`. |
| `ownerDid` | The developer DID that registered the app (you). Not needed as an env var. |
| `tier` | Always `third_party` for self-service registration. |
| `tokenAudiences` | Must include this app's own host (`dykil.imajin.ai`) — the kernel refuses to mint a `POST /auth/api/tokens/app` token for an `aud` that isn't a registered app's audience (#1990). |

`id` (the `app_...` registry id, not the DID) is what you set as `NEXT_PUBLIC_IMAJIN_APP_ID`.

## 4. Wire up this app

```bash
cp .env.example .env.local
# fill in:
#   IMAJIN_KERNEL_URL=<kernel node>          (e.g. https://dev-jin.imajin.ai)
#   IMAJIN_APP_DID=<appDid from step 1>
#   NEXT_PUBLIC_IMAJIN_APP_ID=<id from step 1>
#   IMAJIN_APP_CLAIM_CODE=<optional — leave unset and claim via <app>/claim in the browser instead>
#   AUTH_SERVICE_URL=<kernel node>/auth      (e.g. https://dev-jin.imajin.ai/auth)
#   MEDIA_SERVICE_URL=<kernel node>/media    (e.g. https://dev-jin.imajin.ai/media)
# IMAJIN_APP_KEYSTORE is optional (defaults to ./.imajin/keystore.json) — never commit it
# or the claim code; delete IMAJIN_APP_CLAIM_CODE from .env.local once boot succeeds once.
```

Without a signing key it can fetch via `loadAppSigningKey()`, `pnpm dev` / `pnpm start` throw
immediately (`instrumentation.ts`) instead of serving requests no kernel call could ever
authenticate — and it fails just as loudly if a raw `DYKIL_APP_PRIVATE_KEY` is still set,
since this app never reads a private key from env.

## 5. Register the response-attestation types (one-time, before going live)

This app's responses are attestations of two app-namespaced types (see
`src/lib/response-attestation.ts`), which must be registered once under the developer DID's own
handle before `POST /auth/api/attestations` will accept them:

```bash
curl -X POST "${IMAJIN_AUTH_URL}/api/attestations/types" \
  -H "Content-Type: application/json" \
  -H "Cookie: <your kernel session cookie>" \
  -d '{ "localName": "survey-response", "description": "A respondent-signed answer to a dykil survey." }'

curl -X POST "${IMAJIN_AUTH_URL}/api/attestations/types" \
  -H "Content-Type: application/json" \
  -H "Cookie: <your kernel session cookie>" \
  -d '{ "localName": "survey-response-legacy-import", "description": "A NODE-WITNESSED LEGACY-IMPORT backport of a pre-#1985 response." }'
```

This requires `requireEstablishedDID` (an established-tier identity) — use the developer DID
that owns this app, not the app's own DID. See `ima-jin/imajin-ai`'s
`app/auth/api/attestations/types/route.ts`.

## 6. This app's own inbound auth (see AGENTS.md §8 and FINDINGS.md)

This app authenticates every inbound request through one interface, `authenticate()`
(`src/lib/auth/authenticate.ts`), currently implemented with `requireSessionOrAppToken`
(`@ima-jin/auth`), mirroring coffee's #1974 reference adoption. A caller mints a token via:

```bash
curl -X POST "${IMAJIN_AUTH_URL}/api/tokens/app" \
  -H "Content-Type: application/json" \
  -H "Cookie: <caller's own kernel session cookie>" \
  -d '{ "aud": "dykil.imajin.ai", "scopes": [] }'
```

and calls this app with `Authorization: Bearer <token>`. See `FINDINGS.md`'s DECISION card for
why this is an open call, not a settled one, and gap #2393 for why the KERNEL's own media and
attestation write routes don't yet accept that same token — this app's own auth and the kernel
calls it makes downstream are, today, two different trust boundaries.

## 7. List or manage your apps later

```bash
curl "${IMAJIN_AUTH_URL}/api/registry/apps?owner=me" \
  -H "Cookie: <your kernel session cookie>"
```

Revoking or rotating an app's credentials is done through the kernel's admin/developer surface,
not by this template — see the kernel's own `/auth/developer/apps` UI.
