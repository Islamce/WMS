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
| Deploy commit | the merge commit of **PR #126** on `main` — read it from `main`, do not copy a SHA from this file |
| Host path | `/opt/apps/wms` |
| Runtime | Docker Compose service `wms`, behind central Caddy at `/opt/proxy` on the external network `web` |
| Database | `/opt/apps/wms/data/wms.db` (host) = `/app/data/wms.db` (container) |
| Backups | `/opt/apps/wms/backups` (host) = `/app/backups` (container) |

**Last recorded deploy: `76a1420`, 2026-09-11** (release workflow run 32, green).
That is a record, not a reading. What `/opt/apps/wms` is checked out at right now
is a runtime fact — read it in §2 and trust that.

This release carries one pull request, #126, containing the whole fix plan from
`docs/PRODUCT-CRITIQUE-2026-09-12.md`: the collapsed contracting workflow, the
first-hour starter data and setup guide, the unified screen names, and the flat
subscription.

### Schema change — read this before you start

Production last reported **25 applied migrations**. This deploy adds **two**:

| Migration | What it does |
|---|---|
| `026_tenant_subscription` | Creates an **empty** `tenant_subscription` table |
| `027_document_sequences` | Creates a counter table and seeds it from document numbers already issued |

Both are additive. 026 creates its table empty **on purpose**: no subscription
row means no licence restriction, exactly as `tenant_profile` works for editions,
so this deploy cannot cause production to refuse a write.

027 writes rows, and that is worth understanding before you run it. It reads the
`ISS-`/`GI-` numbers already in `material_request_headers` and records the
highest of each so the counter continues past them. On production it will find
**none** — those numbers are only minted on a no-ERP edition, which this install
is not — so it creates an empty table there too. It reads the request headers and
writes only to its own new table; no existing row is touched.

Nothing is dropped, no row is rewritten, no default changes an existing value.

Migrations run automatically when the container starts. You do not run them by
hand.

### What changes for the people using the system

This release is mostly invisible to production, because production is an
unconfigured single-company install. Three things are **not** invisible, and one
of them needs a heads-up to the users before you start.

**1. Screens are renamed.** The product carried two different names for the same
screen — a sidebar saying "Request Work Queue" above a tile saying "Requests" —
and they are now one name each. Roughly thirty screens read differently
afterwards: "Create Material Request", "Bin & Batch Assignment", "Material
Master", "Goods Receipt", "Stock by Location". No screen moves, no permission
changes, nothing is removed. **Tell the users this is coming**, or the first one
to notice will report it as a fault.

**2. The language picker is gone.** The product ships in English and is
translated when a customer asks. The picker offered Arabic and French over
dictionaries covering a fraction of the screens, so it is hidden until a language
is actually finished.

> **Check this before you deploy.** Anyone whose browser is currently set to
> Arabic or French is switched back to English. That is the intended behaviour,
> but if somebody at this customer has been working in Arabic, they must be told
> first — for them it will look like the product lost a feature. Ask before you
> assume nobody has.

**3. A first-run setup checklist may appear on the home screen.** It is meant for
a brand-new empty tenant and hides itself the moment the system has ever issued
material. Production almost certainly satisfies every step already, so it should
never appear — but *almost certainly* is not good enough to find out in front of
the customer. **Run the check in §2 and confirm it comes back `complete`.**

### What does NOT change on this install

**The contracting workflow is inert here.** Approval routing, the storekeeper
claim, the locally-minted issue and GI numbers — all of it is gated on the
edition, and production has no `tenant_profile` row. No row means ERP staging
stays on, so the request workflow behaves exactly as it does today. Do not run
`scripts/set-tenant-profile.js` as part of this deploy; see §6.

**The subscription is inert here.** No `tenant_subscription` row means no licence
check at all. Do not run `scripts/set-subscription.js` as part of this deploy —
setting a subscription is a commercial decision, and doing it during a technical
deploy is how a warehouse ends up read-only by accident.

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
git -C /opt/apps/wms rev-parse HEAD   # WRITE THIS DOWN — it is the rollback target
curl -sS -o /dev/null -w '%{http_code}\n' https://wms.kynox.io/healthz
```

**Write these numbers down.** They are what you compare against after the
deploy. Expect roughly 11 users and 25 migrations, but trust what you read, not
what this line says.

### Two checks specific to this release

The first confirms the setup checklist will stay hidden. It must print `OUT
movements: <a number greater than 0>`; if it prints 0, **stop and report** — the
checklist would appear on the customer's home screen, which is not a fault but
is not something to discover live.

```bash
docker compose exec wms node -e "
  const db = require('better-sqlite3')('/app/data/wms.db', {readonly:true});
  console.log('OUT movements:', db.prepare(\"SELECT COUNT(*) c FROM stock_transactions WHERE transaction_type='OUT'\").get().c);
  const t = db.prepare(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='tenant_profile'\").get().c;
  console.log('tenant_profile rows:', t ? db.prepare('SELECT COUNT(*) c FROM tenant_profile').get().c : 'table absent');
"
```

The second is a question, not a command: **has anyone at this customer been
using the Arabic or French interface?** If yes, tell them before you deploy. If
you cannot find out, ask the owner rather than guessing.

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
git log --oneline -1 origin/main          # expect a21df51
git checkout a21df51af007931369b45225bbed3f5abd2b93d8
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
  console.log('tenant_subscription rows (MUST be 0):',
    db.prepare('SELECT COUNT(*) c FROM tenant_subscription').get().c);
  console.log('company-owned batches (MUST equal total):',
    db.prepare(\"SELECT COUNT(*) c FROM batches WHERE COALESCE(owner_type,'COMPANY')='COMPANY'\").get().c);
"
curl -sS -o /dev/null -w '%{http_code}\n' https://wms.kynox.io/healthz
```

Pass criteria, all of them:

1. `migrations` is now **27**.
2. `users`, `materials`, `batches`, `requests` are **identical** to §2. A
   schema migration must not change a single row count.
3. `integrity` is `ok`.
4. `tenant_profile` has **0 rows**. A row here would silently switch modules off.
5. `tenant_subscription` has **0 rows**. A row here would start a licence clock
   nobody agreed to, and could eventually make the system read-only.
6. Company-owned batches equals the total batch count — nothing was
   reclassified as subcontractor-owned by the migration.
7. `/healthz` returns 200 over public HTTPS with valid TLS.
8. A real administrator can log in, and an existing material request still opens
   and shows its lines.

### Then look at the home screen with your own eyes

The row counts prove the data survived. They do not prove the customer's first
screen is right, and three changes in this release are visible there.

9. **No setup checklist.** If a "Finish setting up" card is on the home screen,
   the §2 check was wrong or was skipped. Not a rollback on its own — the system
   is working — but report it before the customer sees it.
10. **No subscription banner.** Anything mentioning expiry or read-only means a
    `tenant_subscription` row exists that should not, and criterion 5 has already
    failed. Roll back.
11. **The sidebar and the tiles below it agree.** Pick any screen and check both
    call it the same thing. That is the whole point of the renaming, and it is a
    ten-second check.

**Stop and report** on any failure. Go to §7.

---

## 6. After a successful deploy — what NOT to do next

Nothing in this release requires an administrative action. Two scripts shipped
with it can change how the system behaves, and **neither belongs anywhere near
this deploy**:

| Script | What it would do | When |
|---|---|---|
| `scripts/set-tenant-profile.js` | Put the install on an edition, **hiding screens** from people who used them yesterday | Only when the owner asks, on its own, never bundled with a deploy |
| `scripts/set-subscription.js` | Start a licence term that eventually makes the system **read-only** | Only as a commercial decision by the owner |

Both dry-run by default and print exactly what they would change. Neither has any
effect until `--apply`. If you are unsure, the answer is not to run them.

### The two subcontractor authorities (carried over from the previous release)

They are assigned to no role. Until an administrator assigns
them, only an admin can approve a subcontractor return or a subcontractor
request quantity. Nothing is broken; the capability is simply not delegated yet.

This is a decision for the business, not for you. Report it and let the owner
decide who gets them:

| Permission | Who it is for |
|---|---|
| `project_management_approval` | Approves **quantities** on a material request raised for a subcontractor |
| `subcontractor_return_approval` | Approves handing a subcontractor's own material back out of the store |

Assign through the existing Permissions screen. Do not edit the database.

### When the owner does ask for an edition

Not during a deploy. On its own, so that if something looks wrong the next
morning there is only one change to explain. The dry run prints which modules
would disappear and how many active users hold each one today — read that before
`--apply`. Clearing it (`--profile none --apply`) restores everything, because
permissions are never revoked.

---

## 6b. The `production-release` workflow, and how to use it the first time

`.github/workflows/production-release.yml` used to target the **old shared
host** — `/home/u716763642/domains/...`, the `/opt/alt/alt-nodejs20/...` runtime,
and a Passenger `tmp/restart.txt` restart. `production-backup.yml` was
retargeted to `/opt/apps/wms` and `docker compose` during the 2026-09-06
migration; the release workflow was missed. It is now retargeted to match.

It has since been used against production successfully — a plan run, then run 32
which deployed `76a1420` on 2026-09-11. It is the recommended route for this
release, and the manual steps above are the fallback. Its safeties:

- **`plan_only` defaults to true.** The first dispatch changes nothing and proves
  the plumbing — SSH, the checkout, container health, the database. Run it that
  way first and read the output.
- A verified backup is taken before anything is touched, using the same scripts
  the backup workflow already runs here.
- The currently deployed commit is recorded first and is the automatic rollback
  target if health or the post-checks fail.
- Row counts are compared before and after; a changed count fails the run.
- **There is NO approval prompt.** The `production` environment has no reviewers
  configured, so dispatching with `plan_only` unchecked deploys immediately.
  Earlier versions of this document claimed otherwise; the plan run disproved it
  when its deploy job started three seconds after validation. Treat the dispatch
  itself as the point of no return, and add reviewers in the environment settings
  if a second pair of eyes is wanted.

**If the plan run reports that `/opt/apps/wms` is not a git checkout**, the
workflow stops and this manual procedure is the only route. That is not a
failure of the workflow — it means the directory has to be reconciled into a
checkout before any automation can move it between commits.

## 7. Rollback

If any check in §5 fails:

```bash
cd /opt/apps/wms
git checkout <the SHA recorded in §2>
docker compose build
docker compose up -d
```

**The database does not roll back with the code.** Both new migrations are
additive and create tables the previous application version does not know about,
so it runs fine against the new schema and simply ignores them. Reverting the
code is therefore enough for an application fault.

Restore the database from §3's backup **only** if §5 showed data loss or a
failed integrity check, and only with explicit approval from the owner. Follow
`docs/WMS-PRODUCTION-RUNBOOK.md`; do not improvise a file copy.

---

## 8. Report back

State plainly, with the actual numbers:

- The before and after values from §2 and §5, side by side.
- Whether every pass criterion in §5 was met — name any that was not.
- Where the verified backup is, on the VPS and off it.
- That `tenant_profile` and `tenant_subscription` are both still empty.
- What the home screen looked like: no setup checklist, no subscription banner,
  and the sidebar and tiles agreeing on screen names.
- Anything you saw that this document did not predict.

Do not report success unless every check in §5 passed. If you skipped a step,
say which one and why.
