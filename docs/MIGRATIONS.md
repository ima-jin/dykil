# Migrations and the legacy baseline

dykil has **no migrations** and owns **no database** (Ryan's ruling, 2026-09-22, DECISION #1985→c): a survey is a
signed document (a kernel media asset) and a response is an attestation. This page records why no migration was
carried into this repo (imajin-ai#2520), and what runs instead on every deploy.

## The per-table decision

The migration rule for apps (imajin-ai#1991) is that an app's migrations stay with the app only for tables it owns.
The old monorepo `apps/dykil` had two tables, both created by the monorepo's shared root migrations
(`0001_seed.sql`, plus `0008` for `ticket_id`):

| Table | Owner | Decision | Why |
|---|---|---|---|
| `dykil.surveys` | dykil (legacy) | **No migration here.** Retained read-only until retired. | Not kernel-owned. Each row becomes a signed document via `scripts/import-legacy.ts`. A table in this repo would contradict the zero-table ruling. |
| `dykil.survey_responses` | dykil (legacy) | **No migration here.** Retained read-only until retired. | Not kernel-owned. Each row becomes a NODE-WITNESSED LEGACY-IMPORT attestation. The events app still reads it cross-schema (imajin-ai#2542) until it is moved off. |

Neither is a kernel-owned table, so **none of dykil's migrations stay**. The shared root migrations
(`0001`, `0008`, `0025`, `0026`) are the kernel repo's history and are never copied or replayed here. In particular,
`0025`/`0026` touch `events` tables, which this app must never do.

The tables are **not dropped**. Retiring them is a separate, deliberate operator step, taken only after the import
has been verified (imajin-ai#2522) and the events app no longer reads them (imajin-ai#2542). This repo never issues a
`DROP`, `TRUNCATE`, `ALTER` or write against them.

## What runs instead: the legacy baseline

`scripts/legacy-baseline.mjs` is the baseline for the existing prod and dev schema **and data**. `scripts/deploy.sh`
runs it on every deploy (step 6), before the process is restarted.

```bash
node --env-file=.env.local scripts/legacy-baseline.mjs            # what deploy.sh runs
node --env-file=.env.local scripts/legacy-baseline.mjs --require  # fail instead of skip when no URL is set
```

It reads `LEGACY_DATABASE_URL` (use a read-only role) and checks that the live `dykil` schema is exactly what
`scripts/import-legacy.ts` was written against:

- **Idempotent, trivially.** It only reads, so running it again is a no-op. There is deliberately no tracking table:
  that would be an app-owned table. The "baseline" is the pinned expectation in
  `scripts/lib/legacy-baseline-core.mjs` (`EXPECTED_TABLES`), not a row in a database.
- **Refuses on mismatch, loudly.** It introspects `pg_catalog` (tables, columns, types, nullability, defaults,
  primary and foreign keys, required indexes) and the data invariants the importer relies on (no orphaned responses,
  known `status`/`type` values, `fields` and `answers` are JSON objects). Any difference exits **1** with the full list
  of problems, and the deploy stops before restarting. Extra tables, extra columns and unique constraints are
  mismatches too: their data would not be imported. Constraint and index *names* are not compared, and extra
  indexes are tolerated.
- **Never drops, truncates, alters or inserts.** Every statement is a `SELECT`, issued inside `BEGIN READ ONLY` and
  rolled back, so Postgres itself rejects a write. The test suite audits every statement it issues.
- **No content leaves the database.** Output is counts only. Row content and connection details are never printed.
- **Fresh databases** (no `dykil` schema) report "nothing to baseline" and exit 0.
- **Skipped loudly** when `LEGACY_DATABASE_URL` is unset (exit 0, a `SKIPPED` line). Use that once the legacy data is
  retired; use `--require` to forbid it.

Exit codes: `0` verified, fresh or skipped · `1` refused (mismatch) · `2` usage, configuration or connection error.

A refusal means the schema or data drifted from what was audited. Do **not** edit the script to force it through:
reconcile the database by hand (or tell the app owner), then re-run.

## If dykil ever needs a table of its own

It should not: that reopens the zero-table ruling. If a future change genuinely needs one, it needs a new DECISION
card first. The rule then is the app-owned-schema rule in imajin-ai#1991: one Postgres schema, named for the app,
never a kernel-owned or another app's schema, with additive, guarded (`IF NOT EXISTS`) migrations that are never
squashed or dropped.
