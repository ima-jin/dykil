# Deploying dykil (prod + dev)

dykil is deployed from **this repo**, as its own pm2 process behind the kernel host's Caddy. Nothing in
`ima-jin/imajin-ai` builds, migrates, or restarts it once the cutover below is done (imajin-ai#1985, #2520).

| | dev | prod |
|---|---|---|
| pm2 process | `dev-dykil` | `prod-dykil` |
| Checkout on the server | `~/dev/dykil` | `~/prod/dykil` |
| Local port | `3101` | `7101` |
| Public URL | `https://dev-jin.imajin.ai/dykil` | `https://jin.imajin.ai/dykil` |
| Health | `http://127.0.0.1:3101/dykil/api/health` | `http://127.0.0.1:7101/dykil/api/health` |

These are the same names, ports and Caddy route the monorepo-era app used, so nothing in front of the app changes.

## The one command

From the target's checkout on the server:

```bash
scripts/deploy.sh dev     # or: scripts/deploy.sh prod
scripts/deploy.sh prod --ref v0.2.0   # a specific tag / sha (this is also the rollback)
scripts/deploy.sh prod --dry-run      # print the plan, execute nothing
```

It is fail-fast: any failure before step 7 stops the deploy and the running process keeps serving the previous
build. The env file is the single source of truth: contract variables exported in the calling shell are ignored
(and listed by name), because `node --env-file` and `pm2 --update-env` would otherwise let a stray variable win.
Note that step 2 swaps in the new ref's `deploy.sh`, so a change to the script itself takes effect from the
*next* run.

1. **preflight** — `git`, `node` (>= `.nvmrc`), `pnpm`, `pm2`, `curl` on `PATH`; no local changes to tracked files;
   `.env.local` exists; no stale `pm2` entry of the same name pointing at a different path (see
   [cutover](#one-time-cutover-checklist)).
2. **checkout** — `git fetch --tags --prune`, then `git checkout --detach` the ref (default `origin/main`). Never
   `git pull`.
3. **env check** — `scripts/check-env.mjs <target>` validates `.env.local` for the target (names only, never values).
   See [ENVIRONMENTS.md](./ENVIRONMENTS.md).
4. **install** — `pnpm install --frozen-lockfile`.
5. **build** — `next build` with `.env.local` loaded, so `NEXT_PUBLIC_*` values are baked in.
6. **legacy baseline** — `scripts/legacy-baseline.mjs`: read-only, idempotent, refuses on a schema or data mismatch.
   This step never migrates. Server boot separately runs app-owned migrations only with `DATABASE_URL` and
   `APP_DB_SCHEMA=dykil`; absent migration credentials skip loudly. See [MIGRATIONS.md](./MIGRATIONS.md).
7. **restart** — `pm2 startOrReload ecosystem.config.cjs --only <prod|dev>-dykil --update-env`, then `pm2 save`.
8. **health** — polls `/dykil/api/health` for up to 60 s and requires `"status":"ok"`. A non-healthy result exits
   non-zero. A healthy-but-unclaimed app (`"claimed":false`) is the expected state on an environment's first deploy;
   the script prints a notice pointing at `/dykil/claim`.

## Before you cut over

This repo replaces the live `apps/dykil` on the **same port**, so the first deploy of an environment takes the old
app down. Two things are still open under #1985 and decide *when* prod should be cut over:

- **The data.** Existing surveys and responses reach the new app only through `scripts/import-legacy.ts` (imajin-ai#2522).
  The legacy tables are left untouched, so the import can be run after the cutover, but until it has run the new app
  serves none of the old surveys.
- **The UI.** This repo currently ships the API routes and the claim page; the survey pages are a later step of #1985
  (FINDINGS.md, "Still open" 6).

Deploy **dev first**, confirm `https://dev-jin.imajin.ai/dykil/api/health`, and cut prod over only when the operator
has decided those two are acceptable. Rollback is the old pm2 entry (see the cutover checklist).

## First deploy of an environment (fresh checkout)

There is no checkout of this repo on the server yet. After the operator steps below are done, it is one command per
environment:

```bash
git clone https://github.com/ima-jin/dykil.git ~/prod/dykil && cd ~/prod/dykil
cp .env.prod.example .env.local && chmod 600 .env.local   # then fill in the placeholders
scripts/deploy.sh prod
```

Use `~/dev/dykil` and `.env.dev.example` / `scripts/deploy.sh dev` for dev.

### Operator steps this repo cannot do

- **Mint the app identity**, once per environment, through the kernel's claim flow. The full runbook is
  [REGISTRATION.md](./REGISTRATION.md#operator-runbook-prod-and-dev): register, approve `apps.provision` on `/jin`,
  put the resulting `IMAJIN_APP_DID` in `.env.local`, deploy, then **paste the claim code on `<app>/claim`**
  (`/dykil/claim`). `check-env.mjs` fails while `IMAJIN_APP_DID` is still the `REPLACE_ME` placeholder. No hand-made
  keys, no key material in logs. Do not lose the keystore: a lost keystore needs a `reissueClaim` rebind.
- **Vault readiness:** after browser claim, sync the names-only `LEGACY_DATABASE_URL` manifest declaration
  on `/jin` and use App secrets Set/Rotate with owner countersign for the existing read-only credential.
  Never put it in `.env.local` or a shell. The baseline fails closed until the grant is active;
  first-claim/deploy ordering is separately coordinated under imajin-ai#2241.
  See [MIGRATIONS.md](./MIGRATIONS.md#vault-backed-legacy-credential-25). The baseline only reads.
- **Create the `app.authorized` attestation** for `events:read` if ticket-gated surveys are wanted
  (`DYKIL_EVENTS_AUTHORIZATION_ID`). Optional; ticket-gated surveys answer 501 until it is set.
- **Caddy** — the route already exists; verify it against the [snippet below](#caddy).

### One-time cutover checklist

1. Take a backup of the `dykil` schema first: `pg_dump --schema=dykil …` (the baseline never writes, but the import
   and the later retirement of the tables are operator steps).
2. `pm2 delete prod-dykil && pm2 save` (and `dev-dykil`) if an old entry still points at the monorepo's
   `~/prod/imajin-ai/apps/dykil` path. `deploy.sh` refuses to run while a same-named entry points elsewhere, because
   pm2 would "reload" it with the old script and cwd. Removing old entries is deliberately never automatic.
3. Optionally dry-run the baseline against prod first: `node --import tsx --env-file=.env.local scripts/legacy-baseline.mjs --require`.
4. `scripts/deploy.sh dev`, verify, then `scripts/deploy.sh prod`.
5. After the switch, remove the leftover `apps/dykil` folders from the server checkouts.

## pm2

`ecosystem.config.cjs` defines `prod-dykil` (7101) and `dev-dykil` (3101). Each entry execs
`node_modules/next/dist/bin/next start -p <port>` directly (never `npm start` — imajin-ai#2447: pm2 would track the
npm wrapper and orphan `next-server` on restart), loads `.env.local` with `node --env-file` (Node exits if the file is
missing, so an instance with no env crashes loudly instead of booting without its identity), uses this checkout as
`cwd`, and logs to `~/.pm2/logs/<name>-out.log` / `<name>-error.log`. A checkout only ever starts its own entry
(`--only`).

```bash
pm2 logs prod-dykil --lines 100     # stdout (the app logs to stdout only)
pm2 describe prod-dykil
```

## Caddy

The route is unchanged from the monorepo era. The app is mounted under the `/dykil` basePath and Caddy must forward
the prefix **intact** — use `handle`, not `handle_path` (which strips it). Caddy's `reverse_proxy` appends the real
peer to `X-Forwarded-For`, which the `/claim` rate limit relies on (see REGISTRATION.md, "Proxy trust assumption");
keep the app port bound to localhost.

```caddy
# prod — inside the existing jin.imajin.ai site block
jin.imajin.ai {
    @dykil path /dykil /dykil/*
    handle @dykil {
        reverse_proxy localhost:7101
    }
    # ...the rest of the site (kernel and other apps) unchanged
}

# dev — inside the existing dev-jin.imajin.ai site block
dev-jin.imajin.ai {
    @dykil path /dykil /dykil/*
    handle @dykil {
        reverse_proxy localhost:3101
    }
}
```

Verify: `curl -fsS https://jin.imajin.ai/dykil/api/health` → `{"status":"ok","service":"dykil",…}`.

## Rollback

Redeploy the previous tag or sha: `scripts/deploy.sh prod --ref <previous-tag>`. There are no automatic down
migrations: preserve schema/data and evaluate compatibility before rolling application code back. Older runners
refuse unknown ledger history. To go back to the monorepo-era app, `pm2 delete prod-dykil` and restore
the old entry from `ima-jin/imajin-ai`'s `deploy/ecosystem.prod.config.js`.

## Troubleshooting

- **`baseline` exits 1** — the message lists exactly what differs. Do not edit the script to force it; fix the
  database (or tell the app owner the schema drifted), then re-run.
- **`baseline` exits 2** — required vault configuration or the legacy operation is unavailable.
  Check the app/environment, bootstrap keystore and owner-countersigned App secrets grant on `/jin`;
  never print the value or restore a plaintext env fallback. Missing credentials no longer skip.
- **`env check` fails** — each line names a variable; see [ENVIRONMENTS.md](./ENVIRONMENTS.md).
- **Health reports `claimed:false`** — the app is booted but unclaimed: open `<app>/claim` and paste the claim code
  (`/api/health` reports `claimed:true` once it is, including after every restart).
- **Health never goes green** — `pm2 logs <name>`: an existing keystore that cannot re-authenticate,
  a wrong `IMAJIN_APP_DID`, or a leftover `DYKIL_APP_PRIVATE_KEY` fails at `instrumentation.ts`.
  Without a keystore the app boots unclaimed; redeem a fresh approval code only on `/dykil/claim`.
  The dev and prod instances must each have their own DID and keystore.
- **Login loops on dev only** — `IMAJIN_ENV=dev` is missing (wrong session cookie name).
