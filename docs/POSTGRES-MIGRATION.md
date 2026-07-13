# Migrating WMS from SQLite to PostgreSQL

SQLite (via `better-sqlite3`) is the right default for this app: zero
configuration, a single file, synchronous calls that keep the route code simple,
and more than enough throughput for one warehouse's execution workload. This
document is the plan for the day that stops being true — when you need
concurrent writers across multiple app instances, network-attached storage,
point-in-time recovery, or read replicas. It is a design, not a switch to flip
today.

## When to migrate

Move to PostgreSQL when **any** of these becomes real, not before:

- **Horizontal scaling** — more than one app process needs to write. SQLite
  serialises writers per file; the scheduler lease (`scheduler_locks`) already
  anticipates multiple app instances, but a shared network filesystem is a poor
  home for a SQLite file.
- **High availability** — you need automatic failover, streaming replication, or
  read replicas for reporting/analytics.
- **Concurrency** — sustained concurrent write contention (many pickers +
  receiving + imports) starts producing `SQLITE_BUSY` despite WAL.
- **Operations** — you want managed backups, PITR, connection pooling, and
  standard monitoring (RDS, Cloud SQL, Supabase, Neon, self-hosted).
- **Data size** — the working set outgrows what a single file comfortably holds.

If none of these apply, stay on SQLite.

## What already makes this tractable

The codebase was written to keep the blast radius small:

- **One connection module.** Every route imports `server/db/connection`. Swapping
  the driver is a change in one file plus a thin query-adapter, not a rewrite of
  the routes.
- **Versioned migrations.** `server/db/migrations.js` gives an ordered,
  recorded history in `schema_migrations`. On Postgres, `CREATE TABLE IF NOT
  EXISTS` stops being a deployment strategy; the numbered runner becomes the
  single source of truth for schema state.
- **No SQLite-only SQL in hot paths (mostly).** The workflow queries are plain
  SQL. The portability work below is real but bounded and enumerable.
- **Money/quantity already flagged.** `migrate2.js` notes REAL should become
  `NUMERIC` on a server RDBMS — that guidance is followed here.

## Portability gaps to close

These are the concrete SQLite-isms to translate. Each is mechanical.

| SQLite today | PostgreSQL target | Where |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED ALWAYS AS IDENTITY` (or `BIGSERIAL`) | every table |
| `datetime('now')` defaults | `now()` / `timezone('utc', now())`; store `TIMESTAMPTZ` | all `created_at`/`updated_at`, audit `changed_at` |
| `REAL` for money & quantity | `NUMERIC(18,4)` (money `NUMERIC(18,2)`) | materials.price, all `*_quantity`, `capacity`, `current_occupancy` |
| Booleans as `INTEGER 0/1` | `BOOLEAN` | all `is_*`, `*_flag`, `must_change_password` |
| `TEXT COLLATE NOCASE` (emails) | `CITEXT` extension, or `LOWER()` unique index | `users.email` |
| `INSERT OR IGNORE` / `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO NOTHING/UPDATE` | seed, imports, permissions |
| `RAISE(ABORT, ...)` in triggers | `RAISE EXCEPTION` in a `plpgsql` trigger function | audit append-only triggers |
| Epoch-ms lease in `scheduler_locks` | keep as `BIGINT`, or move to `TIMESTAMPTZ` + `now()`; consider advisory locks | scheduler |
| Synchronous `better-sqlite3` calls | async `pg` (`await pool.query(...)`) | connection layer + every route |
| Boolean coercion `!!row.flag` | native booleans (no coercion needed) | auth/me, serializers |

### The synchronous → async change is the big one

`better-sqlite3` is synchronous; `pg` is not. Two viable strategies:

1. **Adapter that preserves call sites (recommended first step).** Wrap `pg`
   behind a small object exposing `prepare(sql).get/all/run(...)` returning
   promises, and make route handlers `await`. Combined with the `asyncHandler`
   wrapper already used in `routes/auth.js` and `routes/users.js`, this keeps the
   diff regular and reviewable. Transactions (`db.transaction(fn)`) become
   `await withTransaction(async (client) => { ... })`.
2. **Full rewrite to a query builder / ORM** (Knex, Kysely, Drizzle, Prisma).
   Cleaner long-term, larger up-front change. Reasonable if the team already
   standardises on one.

Either way, the `db.transaction(() => { ... })()` blocks in the workflow
services (`services/requests.js`, `routes/warehouse.js`, `routes/picking.js`,
`routes/gi.js`) are the highest-value places to port carefully — they hold the
reservation/allocation invariants.

## Step-by-step plan

1. **Introduce a driver abstraction.** Give `connection.js` a `DB_DRIVER`
   switch (`sqlite` | `postgres`). Ship the Postgres path behind a flag so
   nothing changes until it's set.
2. **Rewrite the schema as Postgres DDL** using the mapping table above. Author
   it as the first Postgres-native migration; keep the numbered ids aligned with
   `schema_migrations` so history is continuous.
3. **Translate triggers.** Recreate the audit append-only guard as a
   `plpgsql` `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`. Same
   guarantee, Postgres syntax.
4. **Port the connection/query layer** using strategy (1) above; make handlers
   `await`. Lean on `asyncHandler` for error forwarding under Express 4.
5. **Data transfer.** Export SQLite → CSV per table (or use `pgloader`, which
   handles SQLite→Postgres type mapping well). Load in FK order:
   roles → permissions → users → role/user permissions → materials → locations
   → warehouses → bins → batches → qr_codes → requests → lines → allocations →
   tasks → audit/notifications/erp logs. Verify row counts and a checksum of key
   columns.
6. **Reset sequences** to `MAX(id)+1` for every identity column after load.
7. **Concurrency & scheduler.** With multiple writers, prefer Postgres
   **advisory locks** (`pg_advisory_lock`) for the background sweeps instead of,
   or alongside, the `scheduler_locks` lease. Set `SCHEDULER_ENABLED=0` on all
   but one instance if you'd rather keep a single runner.
8. **Connection pooling.** Use `pg.Pool` (and PgBouncer in front for many app
   instances). Size the pool to the DB, not the app.
9. **Cutover.** Run both in parallel in staging against the e2e suite
   (`tests/run.sh`) pointed at Postgres. For production, take a brief write
   freeze, do a final delta load, flip `DB_DRIVER`, smoke-test, done.
10. **Backups.** Retire `scripts/backup.js` (SQLite file `.backup`) in favour of
    `pg_dump` / managed snapshots / WAL archiving for PITR.

## Testing the migration

- Point `tests/run.sh` at a disposable Postgres (Docker `postgres:16`) and run
  the full e2e suite. Green there is the acceptance bar.
- Add a data-integrity check post-load: per-table row counts and
  `SUM`/`COUNT` of quantities and reserved amounts must match the SQLite source.
- Re-run the reservation-leak and append-only audit regressions specifically —
  they exercise the transaction and trigger behaviour most likely to differ
  between engines.

## Effort estimate

Bounded and predictable: roughly **1–2 focused weeks** for the adapter + DDL +
query-layer port + data transfer + test pass, assuming strategy (1). A full ORM
rewrite (strategy 2) is longer but pays back in maintainability. The schema is
stable and the invariants are already concentrated in a handful of transactional
blocks, which is what keeps this from being open-ended.
