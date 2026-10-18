# App-owned migrations and the read-only legacy verifier
The 2026-10-14 ruling on [imajin-ai#1991](https://github.com/ima-jin/imajin-ai/issues/1991) lifts the
per-app migration deferral for dykil. This repo owns `dykil.surveys`, `dykil.survey_responses` and its
`dykil._migrations` ledger. It does **not** introduce new table-backed application behavior: new surveys remain
signed documents, responses remain attestations, and ticket-holder access still goes through the events API.
The legacy import (#2522) and events' remaining legacy reads (#2542) are not changed or retired here.

## Baseline provenance (root history stays immutable)
`migrations/0001_dykil_baseline.sql` represents the final dykil-only schema from the kernel root history:
- `0001_seed.sql`: two tables, primary keys, six btree indexes and the intra-dykil cascading foreign key.
- `0008_survey_response_ticket_id.sql`: nullable `ticket_id` and its partial btree index.
- `0025_backfill_survey_responses_for_orphan_registrations.sql` and
  `0026_clone_shared_survey_responses_per_ticket.sql`: historical cross-owner data backfills, **not replayed**.
  Their existing rows must be preserved; fresh databases have no legacy data to backfill.
- `0027_drop_ticket_registrations.sql` mentions dykil in historical commentary but only changes events.

These are all root SQL references to dykil at the cut. `migrations/ownership.json` in the kernel assigns both
tables to dykil; no root file is moved, edited, deleted, squashed or re-ledgered. The public root ledger is untouched.
New kernel migrations cannot touch the externally-owned schema (companion kernel PR
[imajin-ai#2844](https://github.com/ima-jin/imajin-ai/pull/2844)). No app SQL references another owner's schema.

## Explicit operator entrypoint
From the repository root, with migration credentials supplied securely in the environment:

```bash
APP_DB_SCHEMA=dykil pnpm migrate
# Or load an operator-owned env file containing DATABASE_URL and APP_DB_SCHEMA:
node --env-file=.env.local scripts/migrate.mjs
```

`DATABASE_URL` is **required** for the explicit command. `APP_DB_SCHEMA` must be exactly `dykil`; neither defaults
to an arbitrary schema nor accepts identifiers/SQL. It never falls back to `LEGACY_DATABASE_URL`.
Use a role restricted to owning/writing the `dykil` schema; do not grant write access to kernel/other app schemas.
An operator must provision that schema/role access appropriately; fresh-database schema creation requires database
CREATE privilege (a dedicated disposable app database is preferred). Credentials are never printed or provisioned here.
Driver error details are suppressed; refusal logs disclose no row content or connection strings. Exit 0 means
success/no pending files; 1 means refused/failed with nothing committed; 2 means invalid CLI arguments.

The callable interface is `loadMigrations(directory?)` and
`runMigrations(pgClient, { schema: 'dykil', migrations })` from `scripts/lib/migrations-core.mjs`.
It requires a dedicated connected client with no open transaction; the runner owns the transaction.
The default directory is `<process.cwd()>/migrations`, so run from the repo root.

## Transaction, adoption and failure behavior
One transaction and a transaction-scoped advisory lock serialize concurrent runs before inspecting schema/ledger.
The runner sets a local `pg_catalog` search path; all writes explicitly target dykil.
- **Fresh database (schema absent):** create only dykil, execute baseline SQL and record its SHA-256.
- **Existing matching schema without ledger:** check live columns/types/defaults/nullability, keys (including
  FK target schema), indexes, catalog objects and importer data invariants. Record baseline as applied in the new
  ledger **without executing baseline DDL, altering tables, replaying data backfills or changing any existing row**.
- **Existing mismatched/partial/empty schema:** fail closed, with no repair and no committed ledger.
- **Existing ledger:** filenames/checksums must match a contiguous prefix of local files. Changed, removed,
  unknown, reordered or empty ledger history fails closed. With baseline-only history the live legacy shape is
  checked again; subsequent reviewed migrations own their schema evolution.
- **Pending files:** execute sorted SQL and record each checksum in the same transaction. Any failure rolls back
  the entire run, including schema/ledger creation; retry after fixing the cause, never force or rewrite applied SQL.

SQL files use a deliberately small additive dialect: schema-qualified `CREATE TABLE`, `CREATE INDEX ... USING
btree`, and one `ALTER TABLE ... ADD COLUMN` per statement. DML, transaction control, procedural SQL, arbitrary
functions, reserved ledger references and cross-schema references are refused. Expand the supported dialect only
with reviewed boundary tests. This guard is defense in depth, not a substitute for schema-restricted DB privileges.
There are no down migrations or automatic retirement/drop operations.

## Boot and existing deployments
The Next.js node instrumentation hook runs the same adapter before serving requests. With no `DATABASE_URL`,
boot prints **SKIPPED**, writes nothing and continues; it does not require migration credentials simply because
the current deployment has a read-only `LEGACY_DATABASE_URL`. Setting `DATABASE_URL` enables fail-fast migrations
and requires `APP_DB_SCHEMA=dykil`. `next build` does not run the hook or need database credentials.
Deploy workflows/release behavior are unchanged. `scripts/deploy.sh` retains its separate read-only check before
restart; operators can explicitly migrate before restart if they want schema refusal before stopping an old process.

## Read-only legacy verifier and import
`scripts/legacy-baseline.mjs` continues to use **only** `LEGACY_DATABASE_URL` (read-only role), inside
`BEGIN READ ONLY`/`ROLLBACK`. It accepts the new ledger without writing it. It never calls the migration runner.

```bash
node --import tsx --env-file=.env.local scripts/legacy-baseline.mjs
node --import tsx --env-file=.env.local scripts/legacy-baseline.mjs --require
```

Exit 0: verified or schema absent. Exit 1: schema/data mismatch.
Exit 2: usage/configuration/connection failure. Missing vault credentials always fail closed;
`--require` remains accepted for compatibility, but is no longer needed.
This verifier still checks counts and importer invariants, not application storage behavior. It tolerates extra
indexes and ignores index/constraint names, as before. The migration adoption checks add stricter catalog guards.
Do not force a mismatch through: reconcile the database deliberately and rerun.

## Vault-backed legacy credential (#25)

The audited main consumers of `LEGACY_DATABASE_URL` are the baseline and importer CLIs only.
Web requests never read this credential. `instrumentation.ts` and `pnpm migrate` use the
separate optional `DATABASE_URL`; this adoption neither expands that scope nor enables migrations.
Unclaimed web boot and the browser claim flow remain unchanged.

`scripts/lib/legacy-vault-boot.mjs` uses the published `@ima-jin/auth-client >=0.8.24`
`createVaultBoot` boundary. The thin entrypoints await keystore-authenticated encrypted fetch,
then dynamically import their application/DB workers. Workers read the typed, frozen config at
module load, before constructing clients; the credential stays in memory and is never assigned
to `process.env`. Missing, revoked, empty or refused credentials prevent worker import and DB
initialization. Startup and driver errors are fixed diagnostics, never provider exception details.
Both CLIs use the existing `tsx` loader to resolve the SDK's Next.js imports.

Coordinated operator cutover prerequisites (not executed by this app-code change):

1. Preserve the app's existing identity and per-environment bootstrap keystore from browser claim.
2. On `/jin`, select the correct app/environment and **Sync manifest secrets**; review and sign
   the name/kind-only `LEGACY_DATABASE_URL` / `operator-supplied` declaration in `imajin.app.json`.
   Sync registers the recipe; it does not supply a value.
3. In that app's **App secrets** panel, use **Set** for missing material, or **Rotate** for a reviewed
   replacement. Supply the existing read-only connection only in the masked operator UI and obtain
   the owner's countersign. Staged material is not active until countersign execution succeeds.
   Do not generate a different database credential as a substitute.
4. Coordinate readiness and the removal of the old plaintext entry through
   [imajin-ai#2241](https://github.com/ima-jin/imajin-ai/issues/2241), then run the reviewed command.
   Never copy, rotate or import values via shell/SSH, commands, logs, responses or env files.

No live manifest sync, secret mutation, env edit or restart is authorized here.
The deploy baseline now fails closed until these prerequisites exist, even with no legacy env entry;
fresh first-claim orchestration must be coordinated separately, not bypassed by an env fallback.
No changes to imajin-ai#2260 or auth-callback PR #23 are included.

## Tests and rollout evidence
`pnpm test` runs the existing Vitest suite plus migration unit tests. For real SQL:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/dykil_test pnpm test:sql
```

Use an isolated disposable database: tests destroy its dykil schema. CI runs a dedicated PostgreSQL 16 SQL job
and also runs SQL tests during coverage generation. Tests cover fresh builds, populated adoption with unchanged
rows/xmin/relfilenodes, reruns, concurrent locking, checksum/history refusal, drift and transaction rollback.
Kernel companion validation replays full root history and compares baseline schema output; live dev/prod restore
verification remains operator work, tracked by the
[DECISION card on #1991](https://github.com/ima-jin/imajin-ai/issues/1991#issuecomment-6228023270).
