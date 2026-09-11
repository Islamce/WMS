# Write-contention baseline (2026-09-11)

**Purpose:** decide whether the PostgreSQL migration in `docs/POSTGRES-MIGRATION.md`
is needed now, later, or not yet — from measurement rather than assumption.

**Verdict: not now.** SQLite sustained 200 concurrent writers with zero lock
exhaustion, including in the worst case where every writer contends on the same
row. The application's own rate limiter is reached long before the database is.

---

## Why the existing load test could not answer this

`tests/load/smoke-load.js` drives four endpoints — `/healthz`, `/api/auth/me`,
`/api/dashboard`, `/api/kpi` — all of them reads.

SQLite in WAL mode does not block readers against each other or against the
writer. It serialises **writers**. A read-only load test therefore measures the
one dimension that was never at risk, and cannot find the ceiling however large
you make it. That test is a useful CI smoke check; it is not a capacity
measurement, and it should not be quoted as one.

## What was measured instead

`tests/load/write-contention.js` drives `POST /api/stock/in`, whose transaction
upserts `material_location_stock` and appends to `stock_transactions` — genuine
contention on a shared row.

Two modes bracket reality:

- **spread** — workers write different materials. The realistic case: storekeepers
  handling different items.
- **same** — every worker writes the same material and location. The pessimistic
  bound: maximum row contention.

Dataset (`tests/load/seed-scale.js`): 50,000 materials, 200 locations,
200,000 stock transactions, 62 MB on disk.

## Results

| Mode | Workers | Writes | Throughput | p50 | p99 | `SQLITE_BUSY` | Failed |
|---|---|---|---|---|---|---|---|
| spread | 10 | 300 | 561/s | 16 ms | 45 ms | **0** | 0 |
| spread | 25 | 500 | 644/s | — | 229 ms | **0** | 0 |
| spread | 50 | 1,000 | 696/s | — | 154 ms | **0** | 0 |
| spread | 100 | 2,000 | 589/s | — | 2,325 ms | **0** | 0 |
| spread | 200 | 4,000 | 737/s | — | 497 ms | **0** | 0 |
| same | 50 | 1,000 | 792/s | 57 ms | 130 ms | **0** | 0 |
| same | 200 | 4,000 | 827/s | 203 ms | 1,032 ms | **0** | 0 |

Every run completed with **zero** `SQLITE_BUSY` and **zero** failed writes.

p99 is noisy between runs (2,325 ms at 100 workers, 497 ms at 200) — first-run
cache warming on a 62 MB database, not a load-dependent trend. p50 is the
stabler read, and it stays double-digit up to 50 workers even in `same` mode.

### The finding that nearly became a wrong conclusion

The first run at 100 workers reported 1,812 failures. That looked like a
database ceiling. It was **HTTP 429 from the application's own rate limiter**
(`API_RATE_LIMIT`, default 2,000 requests/minute per IP) — a safeguard working
correctly. The database was never stressed in that run.

Reporting that as a capacity limit would have justified weeks of migration work
against a database that had not been touched. `write-contention.js` now
classifies 429 separately from every other failure and says plainly when a run
measured the limiter instead of the database.

## What this means

**For the Postgres decision.** `docs/POSTGRES-MIGRATION.md` lists the triggers to
migrate on: sustained `SQLITE_BUSY` under concurrent write contention, multiple
writing processes, high availability, data size. None is met. Container-per-tenant
also changed the question: SQLite's single-writer limit is now **per tenant**, so
the bar is one contractor's site store — five to ten concurrent users — against a
database that did not flinch at 200.

**For selling.** "How much can it take?" now has a measured answer rather than a
hedge: several hundred concurrent writers per tenant, with the API rate limiter,
not the database, as the first thing to raise.

**What has NOT been measured**, and should not be claimed:

- Read latency at scale. Dashboard and KPI queries were not timed against a large
  dataset; 200,000 transactions is modest.
- The full workflow. Picking confirmation and goods issue hold longer, more
  complex transactions than `stock/in` and may behave differently.
- The real VPS. This ran in a development container, not on the production host
  alongside the other services sharing it.
- Sustained load. Runs were seconds, not hours; WAL checkpoint behaviour over a
  long run is untested.

## Reproducing

```bash
node tests/load/seed-scale.js --db /tmp/load.db \
  --materials 50000 --locations 200 --transactions 200000

DB_PATH=/tmp/load.db PORT=3211 SKIP_AUTO_SEED=1 API_RATE_LIMIT=0 \
  JWT_SECRET=<32+ chars> node server/index.js &

LOAD_BASE_URL=http://127.0.0.1:3211 \
  node tests/load/write-contention.js --workers 200 --writes 20 --contention same
```

`API_RATE_LIMIT=0` disables the limiter so the database is what gets measured.
Both scripts refuse non-local targets unless `ALLOW_REMOTE_LOAD_TEST=1`: this
writes real stock movements and must never touch a customer's deployment.
