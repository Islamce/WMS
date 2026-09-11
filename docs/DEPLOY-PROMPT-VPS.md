# Deployment prompt — WMS to the production VPS

Hand this whole file to whoever (or whatever) has SSH access to the VPS. It is
written to be executed by someone who has **not** followed the development work,
so it states the facts rather than assuming them.

---

## 0. Who you are and what authority you have

You are deploying an already-merged, already-tested change to a **live
production system holding a single customer's real warehouse data**. You have
authority to deploy. You do **not** have authority to fix data, reset anything,
or work around a failure by clearing state.

This system lost its production database once, on 2026-07-25. Everything below
that looks paranoid is there because of that incident. If a step fails, **stop
and report** — a half-finished deployment that is rolled back is recoverable, an
improvised repair usually is not.

### Absolutely forbidden, no exceptions without a separate written approval

- `npm run seed`
- `npm run fresh-start`
- `npm run reset-admin` / `node scripts/reset-admin.js`
- Deleting or replacing `data/wms.db`, `data/wms.db-wal`, or `data/wms.db-shm`
- Running the test suite against the production database
- Changing `DB_PATH`
- `docker compose down -v` (the `-v` destroys volumes)

If you find yourself typing any of these, you have misdiagnosed the problem.

---

## 1. What is being deployed

| | |
|---|---|
| Repository | `Islamce/WMS` |
| Deploy commit | `bd3b5bc11f708cf2c9c61d1e54e542d75aabdaaf` on `main` |
| Host path | `/opt/apps/wms` |
| Runtime | Docker Compose service `wms`, behind central Caddy at `/opt/proxy` on the external network `web` |
| Database | `/opt/apps/wms/data/wms.db` (host) = `/app/data/wms.db` (container) |
| Backups | `/opt/apps/wms/backups` (host) = `/app/backups` (container) |

Production was last deployed **before PR #107**. Four merged pull requests are
being deployed at once: #107, #116, #117, #118.

### Schema change — read this before you start

Production currently reports **20 applied migrations**. This deploy adds four:

| Migration | What it does |
|---|---|
| `021_tenant_profile` | Creates an **empty** `tenant_profile` table |
| `022_stock_ownership` | Adds `owner_type` (default `'COMPANY'`) and `owner_subcontractor_id` to `batches`; `engagement_type` to `subcontractors`; movement type `542` |
| `023_subcontractor_returns` | New `subcontractor_returns` table; seeds permission `subcontractor_return_approval` |
| `024_request_subcontractor_attribution` | Adds `subcontractor_id`/`subcontractor_name` to `material_request_headers`; seeds permission `project_management_approval` |

Every one is **additive**. No column is dropped, no row is rewritten, no default
changes an existing value. Migration 021 creates its table empty **on purpose**:
no `tenant_profile` row means no edition restriction, so the live deployment
behaves exactly as it does today.

Migrations run automatically when the container starts (`server/index.js` line
11 requires `./db/migrate`). You do not run them by hand.

### Two new permissions are granted to NO role

`subcontractor_return_approval` and `project_management_approval` ship assigned
to nobody. That is deliberate and fail-closed. **Nothing breaks** — the new
screens are simply admin-only until an administrator assigns them. See §6.

---

## 2. Before you touch anything — establish the current state

Never infer production state from Git or from this document. Read it from the
running system.

```bash
cd /opt/apps/wms
docker compose ps
docker compose exec wms node -e "
  const db = require('better-sqlite3')('/app/data/wms.db', {readonly:true});
  console.log('migrations:', db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c);
  console.log('users:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
  console.log('materials:', db.prepare('SELECT COUNT(*) c FROM materials').get().c);
  console.log('batches:', db.prepare('SELECT COUNT(*) c FROM batches').get().c);
  console.log('requests:', db.prepare('SELECT COUNT(*) c FROM material_request_headers').get().c);
  console.log('integrity:', db.pragma('integrity_check')[0].integrity_check);
"
git -C /opt/apps/wms rev-parse HEAD
curl -sS -o /dev/null -w '%{http_code}\n' https://wms.kynox.io/healthz
```

**Write these numbers down.** They are what you compare against after the
deploy. Expect roughly 11 users and 20 migrations, but trust what you read, not
what this line says.

**Stop and report** if `integrity` is anything other than `ok`, or if the
container is not running. Do not deploy on top of a sick system.

---

## 3. Back up, and verify the backup

Not optional. Do not continue until the verification passes.

```bash
cd /opt/apps/wms
docker compose exec wms npm run backup
docker compose exec wms npm run verify-backup
ls -la /opt/apps/wms/backups | tail -5
```

`verify-backup` exits 0 only if the checksum matches the manifest, SQLite
integrity passes, and a restore drill onto a scratch copy succeeds. It never
touches the production database.

Also copy the backup **off the VPS** before proceeding, so a host-level failure
during deployment is still recoverable.

**Stop and report** if `verify-backup` exits non-zero.

---

## 4. Deploy

```bash
cd /opt/apps/wms
git fetch origin main
git log --oneline -1 origin/main          # expect bd3b5bc
git checkout bd3b5bc11f708cf2c9c61d1e54e542d75aabdaaf
docker compose build
docker compose up -d
docker compose logs -f wms                # watch the migrations apply, then Ctrl-C
```

Confirm before building that the required environment is set in the compose
environment (not in your shell):

- `NODE_ENV=production`
- `SKIP_AUTO_SEED=1`
- `ALLOW_AUTO_SEED=0`
- `PRODUCTION_INITIALIZATION_ENABLED=false`
- `JWT_SECRET` — the **existing** 96-character production secret. Do **not**
  generate a new one: every issued token would be invalidated and every user
  logged out.

If `JWT_SECRET` is missing, the service refuses to start. That is the intended
behaviour; find the existing value, do not invent one.

---

## 5. Verify the deployment

```bash
cd /opt/apps/wms
docker compose ps                          # healthy
docker compose exec wms node -e "
  const db = require('better-sqlite3')('/app/data/wms.db', {readonly:true});
  console.log('migrations:', db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c);
  console.log('users:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
  console.log('materials:', db.prepare('SELECT COUNT(*) c FROM materials').get().c);
  console.log('batches:', db.prepare('SELECT COUNT(*) c FROM batches').get().c);
  console.log('requests:', db.prepare('SELECT COUNT(*) c FROM material_request_headers').get().c);
  console.log('integrity:', db.pragma('integrity_check')[0].integrity_check);
  console.log('tenant_profile rows (MUST be 0):',
    db.prepare('SELECT COUNT(*) c FROM tenant_profile').get().c);
  console.log('company-owned batches (MUST equal total):',
    db.prepare(\"SELECT COUNT(*) c FROM batches WHERE COALESCE(owner_type,'COMPANY')='COMPANY'\").get().c);
"
curl -sS -o /dev/null -w '%{http_code}\n' https://wms.kynox.io/healthz
```

Pass criteria, all of them:

1. `migrations` is now **24**.
2. `users`, `materials`, `batches`, `requests` are **identical** to §2. A
   schema migration must not change a single row count.
3. `integrity` is `ok`.
4. `tenant_profile` has **0 rows**. A row here would silently switch modules off.
5. Company-owned batches equals the total batch count — nothing was
   reclassified as subcontractor-owned by the migration.
6. `/healthz` returns 200 over public HTTPS with valid TLS.
7. A real administrator can log in, and an existing material request still opens
   and shows its lines.

**Stop and report** on any failure. Go to §7.

---

## 6. After a successful deploy — one administrative action

The two new authorities are assigned to no role. Until an administrator assigns
them, only an admin can approve a subcontractor return or a subcontractor
request quantity. Nothing is broken; the capability is simply not delegated yet.

This is a decision for the business, not for you. Report it and let the owner
decide who gets them:

| Permission | Who it is for |
|---|---|
| `project_management_approval` | Approves **quantities** on a material request raised for a subcontractor |
| `subcontractor_return_approval` | Approves handing a subcontractor's own material back out of the store |

Assign through the existing Permissions screen. Do not edit the database.

---

## 7. Rollback

If any check in §5 fails:

```bash
cd /opt/apps/wms
git checkout <the SHA recorded in §2>
docker compose build
docker compose up -d
```

**The database does not roll back with the code.** The four new migrations are
additive, so the previous application version runs fine against the new schema —
it simply ignores the new columns and tables. Reverting the code is therefore
enough for an application fault.

Restore the database from §3's backup **only** if §5 showed data loss or a
failed integrity check, and only with explicit approval from the owner. Follow
`docs/WMS-PRODUCTION-RUNBOOK.md`; do not improvise a file copy.

---

## 8. Report back

State plainly, with the actual numbers:

- The before and after values from §2 and §5, side by side.
- Whether every pass criterion in §5 was met — name any that was not.
- Where the verified backup is, on the VPS and off it.
- That the two new permissions are unassigned and awaiting a decision.
- Anything you saw that this document did not predict.

Do not report success unless every check in §5 passed. If you skipped a step,
say which one and why.
