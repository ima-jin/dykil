# Registering this app with the kernel

Per ima-jin/imajin-ai#1990, the kernel refuses to serve an unregistered app: every app is an
identity — a row in the kernel's app registry — before it can compose the platform. This app
**refuses to start** without `IMAJIN_APP_DID` set (see `instrumentation.ts`), so registration
is the first thing a fork must do, before `pnpm dev`.

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
  "publicKey": "...",
  "callbackUrl": "https://dykil.imajin.ai/api/auth/callback",
  "requestedScopes": [],
  "tier": "third_party",
  "allowedRedirectHosts": ["https://dykil.imajin.ai"],
  "status": "active",
  "keypair": { "privateKey": "...", "publicKey": "..." }
}
```

`keypair` is only present when you didn't supply your own `publicKey` — it is shown **once** and
never stored by the kernel. Save `keypair.privateKey` as `DYKIL_APP_PRIVATE_KEY` — this app uses
its own key only to self-sign NODE-WITNESSED LEGACY-IMPORT attestations
(`scripts/import-legacy.ts`), never on behalf of a respondent. Never commit it.

## 2. Fields, and what they mean for this app

| Field | Meaning |
|---|---|
| `appDid` | This app's own `did:imajin:…`, derived from its public key. Set as `IMAJIN_APP_DID`. |
| `ownerDid` | The developer DID that registered the app (you). Not needed as an env var. |
| `tier` | Always `third_party` for self-service registration. |
| `tokenAudiences` | Must include this app's own host (`dykil.imajin.ai`) — the kernel refuses to mint a `POST /auth/api/tokens/app` token for an `aud` that isn't a registered app's audience (#1990). |

`id` (the `app_...` registry id, not the DID) is what you set as `NEXT_PUBLIC_IMAJIN_APP_ID`.

## 3. Wire up this app

```bash
cp .env.example .env.local
# fill in:
#   IMAJIN_APP_DID=<appDid from the response above>
#   NEXT_PUBLIC_IMAJIN_APP_ID=<id from the response above>
#   DYKIL_APP_PRIVATE_KEY=<keypair.privateKey from the response above>
#   AUTH_SERVICE_URL=<kernel node>/auth      (e.g. https://dev-jin.imajin.ai/auth)
#   MEDIA_SERVICE_URL=<kernel node>/media    (e.g. https://dev-jin.imajin.ai/media)
```

Without `IMAJIN_APP_DID` set, `pnpm dev` / `pnpm start` throw immediately (`instrumentation.ts`)
instead of serving requests no kernel call could ever authenticate.

## 4. Register the response-attestation types (one-time, before going live)

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

## 5. This app's own inbound auth (see AGENTS.md §8 and FINDINGS.md)

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

## 6. List or manage your apps later

```bash
curl "${IMAJIN_AUTH_URL}/api/registry/apps?owner=me" \
  -H "Cookie: <your kernel session cookie>"
```

Revoking or rotating an app's credentials is done through the kernel's admin/developer surface,
not by this template — see the kernel's own `/auth/developer/apps` UI.
