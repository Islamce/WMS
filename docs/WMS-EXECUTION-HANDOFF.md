# WMS Corrective Programme — Execution Handoff

You are executing a plan that has already been decided. **Do not redesign it, do not re-audit
the codebase, do not propose alternatives.** Every finding below was verified by running code,
not by reading it. Your job is to apply the changes in order and prove each one worked.

Read `docs/WMS-CORRECTIVE-PROGRAMME.md` for the reasoning. This file is the instruction set.

---

## 0. Ground rules — violating any of these ends the task

1. **Branch:** work on `claude/kynox-wms-status-deployment-70gdw7`. Never push to `main`.
2. **Never run any of these, ever, anywhere near production:**
   `npm test`, `npm run seed`, `npm run fresh-start`, `npm run reset-admin`,
   `node scripts/reset-admin.js`. Until PR A lands, `npm test` deletes the database.
   Locally, run tests **only** with `DB_PATH` pointing inside the repo.
3. **Never delete or overwrite** `data/wms.db`, `data/wms.db-wal`, `data/wms.db-shm`.
4. **Never dispatch a production deploy.** Where this file says STOP, stop and ask the owner.
5. **One PR per section below.** Do not combine them. The separation is the point.
6. After **every** push, the pre-push hook may refuse because the KAAF architecture context
   is stale. Fix with exactly:
   `bash scripts/architecture/generate.sh && git add .ai && git commit --amend --no-edit`
   Do not hand-edit anything under `.ai/`.
7. End every commit message with:
   ```
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
8. Open every PR as a **draft**. Never merge. Never approve.
9. If a step's verification does not produce the stated result, **stop and report**. Do not
   improvise a different fix.

---

## 1. What this product is

KYNOX WMS — a warehouse management system for small Egyptian contracting companies.
Node/Express + SQLite (`better-sqlite3`, synchronous) + vanilla-JS frontend + a Flutter app.

Two editions, selected per tenant in `server/services/tenantProfile.js`:
- **Contracting** — `erpStaging: false`. Approval routes straight to the site store. This is
  the edition being sold.
- **Manufacturing** — `erpStaging: true`. Approval goes through an ERP operator screen first.

Traps that have already caused wrong fixes in this codebase. Read them before touching anything:

- `server/routes/receiving.js:133` puts **every** received batch on `QUALITY_HOLD`. Any fix
  that treats held stock as absent will report a full warehouse as empty.
- `server/services/allocation.js` only allocates `quality_status='RELEASED' AND is_blocked=0`.
- `public/js/app.js` `can()` checks the edition **before** the admin short-circuit, so a module
  missing from a profile is invisible to administrators too.
- Adding **or removing any file** — docs and tests included — makes the KAAF context stale.
- `COALESCE(SUM(x), y)` falls through only when there are **no rows**, not when the sum is 0.

---

## 2. Execution order

Sections are lettered in execution order. **Do not skip ahead.**

---

## PR A — close what is open right now

**Why:** two of these are live paths on the public host. One is a loaded gun pointed at the
production database for the duration of this programme. This PR touches no production data,
needs no migration, and does not depend on any deploy.

### A1. Guard the test runner
`tests/run.sh` line 16 currently reads:
```bash
fresh_db() {
  rm -f data/wms.db data/wms.db-shm data/wms.db-wal
```
Insert a guard **before** the `rm`, inside `fresh_db`:
```bash
fresh_db() {
  # This deletes three files. Inside the production container `data/wms.db` is the
  # bind-mounted live database - the exact three files lost in INC-2026-07-25-01.
  # The prohibition used to live only in CLAUDE.md prose. Now it lives here.
  if [ "${NODE_ENV:-}" = "production" ]; then
    echo "REFUSING: NODE_ENV=production. This deletes the database." >&2; exit 1
  fi
  case "${DB_PATH:-}" in
    /opt/apps/wms/*|/app/data/*) echo "REFUSING: DB_PATH=$DB_PATH is a production path." >&2; exit 1 ;;
  esac
  rm -f data/wms.db data/wms.db-shm data/wms.db-wal
```

### A2. Guard the seeder
`server/db/seed.js` has **no guard at all** — the `SKIP_AUTO_SEED` / `ALLOW_AUTO_SEED`
variables gate only the boot-time auto-seed in `server/index.js`, not this script when it is
invoked directly. Add at the top of the file, after the requires:
```js
// seed.js creates accounts whose passwords are published in README.md on a public
// repository. It must never run against production. The env flags that look like they
// cover this gate only the boot-time auto-seed in server/index.js, not a direct call.
if (process.env.NODE_ENV === 'production') {
  console.error('REFUSING: NODE_ENV=production. Seeding installs publicly documented credentials.');
  process.exit(1);
}
if (/^(\/opt\/apps\/wms|\/app\/data)\//.test(process.env.DB_PATH || '')) {
  console.error(`REFUSING: DB_PATH=${process.env.DB_PATH} is a production path.`);
  process.exit(1);
}
```

### A3. Guard the factory reset
`scripts/fresh-start.js` guards only on `--yes`. Copy the exact shape already used in
`scripts/reset-admin.js` lines 39-73 (a `NODE_ENV === 'production'` branch requiring a typed
confirmation), and add the same `DB_PATH` path refusal as A2.

### A4. Close self-registration
Delete the whole `router.post('/signup', ...)` handler from `server/routes/auth.js`
(it starts at line 29). Delete the sign-up link at `public/js/pages/auth.js:54`
("No account yet? Sign up") and any handler that routes to it.

Before deleting, run `grep -rn "signup" tests/` — if any test drives signup, update that test
to create the user through Users Management instead. Do not leave a broken test.

### A5. Revoke stock_in / stock_out from the default role
In `server/db/seed.js`, `DEFAULT_USER_ROLE_PERMISSIONS` currently reads:
```js
const DEFAULT_USER_ROLE_PERMISSIONS = ['dashboard', 'stock_in', 'stock_out', 'all_locations', 'empty_locations'];
```
Change to:
```js
// stock_in/stock_out bypass the entire request -> approve -> allocate -> pick -> SoD-checked
// GI chain: POST /api/stock/out accepts any non-empty string as a reservation number and
// writes a real ISSUE movement. Self-signup used to assign this role, so an approved
// stranger could remove stock. The screens are in no menu, so no administrator would
// have seen them.
const DEFAULT_USER_ROLE_PERMISSIONS = ['dashboard', 'all_locations', 'empty_locations'];
```
Then add a migration to `server/db/migrations.js` (append as the next id after the highest
existing one) that revokes both from the `user` role on tenants that already exist:
```js
{
  id: '0XX_revoke_legacy_stock_permissions',
  description: 'Revoke stock_in/stock_out from the default user role. These bypass the request workflow entirely and the screens are in no menu.',
  up(db) {
    db.prepare(`
      DELETE FROM role_permissions
      WHERE role_id = (SELECT id FROM roles WHERE name = 'user')
        AND permission_id IN (SELECT id FROM permissions WHERE key IN ('stock_in','stock_out'))
    `).run();
  },
},
```
**Do not** delete the routes or the permissions themselves — production holds
`material_location_stock` rows and an administrator may still need to grant this deliberately.

### A6. Enforce the inventory freeze on the outbound path
`server/services/freeze.js` exports `activeFreeze(warehouseCode)` and `freezeMessage(freeze)`.
They are called in `receiving.js`, `warehouse.js`, `reallocation.js` and `subcontractors.js`
and **not** in `picking.js` or `gi.js`. Add the same call, returning 400 with
`freezeMessage(freeze)`, at:
- `server/routes/picking.js` — the claim handler (around line 75)
- `server/routes/picking.js` — the pick-confirm handler (around line 254)
- `server/routes/gi.js` — the post handler (around line 72)

Copy the exact call shape from `server/routes/receiving.js:89`.

Reason, for the commit message: with a freeze open, receiving correctly refuses while claim,
confirm and GI all succeed. Posting the count then writes an `ADJUSTMENT_OUT` for the same
units, so they leave the ledger twice — or, under blind counting (the default), the issued
material is put back on the books with no adjustment at all.

### A7. Stop the allocator handing out a subcontractor's property
`server/services/allocation.js`, the `eligibleBatches` WHERE clause (around lines 21-25) has
no owner predicate. Add:
```sql
      AND COALESCE(owner_type, 'COMPANY') = 'COMPANY'
```
Reason: this was proved by execution. `allocation.propose()` was called against a plain
company request and returned a batch whose `owner_type` is `SUBCONTRACTOR`. Ownership is
decided at receipt and is deliberately immutable (`server/routes/receiving.js:50-53`); the
allocator ignored it. The reporting layer already excludes subcontractor stock, so the engine
and the reports currently contradict each other.

**Before pushing**, check whether any request is mid-flight with a subcontractor batch
allocated. Run locally against a test database only:
```sql
SELECT COUNT(*) FROM picking_allocations pa
JOIN batches b ON b.id = pa.batch_id
WHERE COALESCE(b.owner_type,'COMPANY') <> 'COMPANY';
```
If non-zero on a real tenant, say so in the PR body — those requests will need re-allocation.

### A8. Remove the published credentials
`README.md` lines 33, 108 and 135 print `Admin@123456` and `Passw0rd!`. The repository is
**public** (verified: `"private": false`). Replace the literal passwords with a sentence
saying the development seed prints credentials to the console on first run, and remove them
from `wms flutter application/README.md` as well if present.
Do **not** change the passwords in `server/db/seed.js` or in the test files — tests depend on
them and they are development-only values.

### Verify PR A
```bash
cd /home/user/WMS
# 1. the guard refuses
NODE_ENV=production bash tests/run.sh 2>&1 | head -3        # expect REFUSING
DB_PATH=/app/data/wms.db node server/db/seed.js 2>&1 | head -3   # expect REFUSING
# 2. signup is gone
grep -rn "signup" server/routes/auth.js public/js/pages/auth.js   # expect no matches
# 3. the default role no longer carries stock permissions
grep -n "DEFAULT_USER_ROLE_PERMISSIONS" server/db/seed.js
# 4. freeze is enforced on both outbound paths
grep -n "activeFreeze" server/routes/picking.js server/routes/gi.js   # expect 3 matches
# 5. the allocator filters owner
grep -n "owner_type" server/services/allocation.js   # expect 1 match
# 6. lint
npx eslint . --ext .js
```
Then run the full suite against a scratch database:
```bash
DB_PATH="$PWD/data/test-prA.db" bash tests/run.sh
```
Every test must pass. If a test fails, fix the code, not the test — with one exception: a test
that drove `/signup` must be rewritten to create the user through Users Management.

### Commit and open the PR
```bash
git add -A && git status --short      # REVIEW THIS LIST. Never commit a file you did not intend.
git commit -F <a message file>
bash scripts/architecture/generate.sh && git add .ai && git commit --amend --no-edit
git push -u origin claude/kynox-wms-status-deployment-70gdw7
```
Open a **draft** PR titled `Close the open stock-removal path and guard the destructive commands`.

**Never use `git add -A` without reading the output of `git status --short` first.** A previous
session committed eleven scratch files containing credentials this way.

---

## STOP 1 — the catch-up deploy

**Do not perform this. Report to the owner and wait.**

Production is at `76a1420`, seven commits behind `main`, with migrations `026` and `027`
unapplied. `027` writes rows. The release workflow refuses any ref that is not the tip of
main, so the first corrective deploy would otherwise carry all seven backlog commits plus two
data-writing migrations plus your change, in one dispatch — and if a row count moves, nobody
could say which caused it.

Tell the owner: *"PR A is ready. Before it deploys, the catch-up release needs to be
dispatched by a human — `production-release.yml` at the current main, `plan_only` first, then
for real. It carries no corrective content. After it goes green, `/healthz` cannot prove the
new build is serving, so somebody must curl a path that exists only in the new code."*

Then continue to PR B, which does not depend on the deploy.

---

## PR B — make the pipeline able to prove itself

### B1. Build marker
`server/index.js:103` is `app.get('/healthz', (req, res) => res.json({ status: 'ok', service: 'wms' }));`
A 200 from the **old** container satisfies the deploy gate exactly as well as a 200 from the new
one. Change to return `process.env.BUILD_SHA`, inject it as a Docker build arg in `Dockerfile`
and `docker-compose.yml`, pass `inputs.release_ref` into it from
`.github/workflows/production-release.yml`, and add a step asserting the served value equals
the requested ref.

### B2. Unpin the frozen cache key
`public/index.html` lines 8, 10, 36, 38 pin three files to `/release-assets/9d79a00/`:
```
<meta name="kynox-release" content="9d79a00" />
<link rel="stylesheet" href="/release-assets/9d79a00/css/kynox-v2.css" />
<script src="/release-assets/9d79a00/js/pages/requests.js"></script>
<script src="/release-assets/9d79a00/js/pages/requestDetail.js"></script>
```
`server/index.js:166-170` aliases the release segment to `public/`, so it is a pure cache key,
frozen since 2026-08-18. **These are exactly the three files PR F and PR G must change.**
Either drive the segment from `BUILD_SHA` or remove the pinning entirely. The edge cache it
defended against was a shared-hosting artifact; the VPS sits behind its own Caddy.

**PR F cannot be verified until this is deployed.**

### B3. Widen the deploy gate
`.github/workflows/production-release.yml:236` reads:
```js
for (const k of ['users', 'materials', 'batches', 'requests']) {
```
Three of the four planned data changes are invisible to it, and the fourth would trip it and
roll the **code** back while leaving the new rows written. Add `roles`, `role_permissions`,
`permissions`, `material_location_stock`, `material_request_lines`, and an
`expected_row_delta` input so an intentional data migration can declare itself.
Also: tag the running image before building, so rollback is a retag rather than a rebuild over
the network inside a failing window; and echo the backup manifest filename into the job summary.

---

## PR C — delete what describes a production that no longer exists

Production has run on a Hostinger VPS under Docker Compose since 2026-09-06. The shared-hosting
Passenger layout is gone. `CLAUDE.md` classifies any instruction that still assumes it as a
defect. These remain:

1. Delete `.github/workflows/hostinger-release-layout-diagnostic.yml` — it is dispatchable,
   uses `environment: production`, consumes the production SSH secrets, and targets
   `/home/u716763642/domains/wms.kynox.io/...`.
2. Delete `.github/workflows/build-hostinger-native.yml` — builds `better-sqlite3` for
   RockyLinux 8 / glibc 2.28, a constraint that no longer applies, and triggers on every PR
   touching `package.json`.
3. Delete `ecosystem.config.js` (PM2) or mark it historical, and remove it from
   `publicEntryPoints` in `kaaf.module.json`.
4. In `kaaf.module.json`, rewrite the `externalIntegrations` entry that declares
   `"Phusion Passenger / PM2"` as a **required** process manager. It propagates verbatim into
   `.ai/summary.md`, which is the first thing an agent reads. Replace with Docker Compose.
   Then regenerate `.ai/`.
5. `docs/kaaf/GOVERNANCE.md` is cited 8 times — from `scripts/architecture/generate.py`,
   `generators/index.py`, `generators/context.py`, `scanners/drift.py`,
   `validators/validate_generated.py`, `utils/provenance.py`, and as
   `"governance": "docs/kaaf/GOVERNANCE.md"` inside `.ai/ai-context.json`. **The file has
   never existed in any commit.** Either write it or strip every citation. Do not leave the
   generated context pointing at a 404.

---

## PR D — correct the documents that would mislead the rest of this work

1. **17 of 42 files in `docs/`** mention Passenger, `~/domains`, or `alt-nodejs`. Add a
   supersession banner at the top of each pointing to
   `docs/HOSTINGER-VPS-MIGRATION-2026-09-06.md`. `CLAUDE.md` says to mark supersession rather
   than rewrite history — follow that. Do not delete the historical content.
2. `server/routes/setup.js:57-59` and `scripts/install-starter-data.js:167-176` both assert
   *"Stock with no bin cannot be allocated to a request, so this step is not optional."*
   **This is false.** `server/services/allocation.js` has no `bin_location` predicate — a
   RELEASED batch with a null bin allocates fine. Correct both strings. Do not "fix" the
   allocator to match the documentation; that would be a behaviour change and it is not in
   this plan.
3. `docs/ANDROID-UAT-V1.0.md`: the steps are written; the **result** columns and the
   `version / APK SHA-256 / commit` header are blank, and only section C was ever recorded.
   Its header instructs running against production while its own steps include GI reversal and
   cycle count — a documented procedure for a debug-signed APK to mutate production stock.
   Retarget it at a tenant provisioned with `scripts/provision-tenant.js`. Remove the rows that
   test settled decisions (Arabic RTL, dark mode) and the ERP steps that no longer occur on a
   contracting tenant.
4. `docs/WMS-CURRENT-STATUS.md` records production at `76a1420`. Update it after the catch-up
   deploy, and after every deploy in this programme.

---

## STOP 2 — the materials stock expression

**Do not write this fix until the owner answers.**

The Materials master adds two ledgers (`batches + material_location_stock`) while the request
screen uses a `COALESCE` fallback between them. The opening-stock importer writes **both** for
the same quantity, so the master double-counts every opening line.

The obvious fix — making the master use the same `COALESCE` — **is wrong** and was proved wrong
on a running endpoint: `COALESCE(SUM(x), …)` falls through only when there are **no rows**, so
a material with a depleted batch row plus legacy stock returns **zero**. And `/api/stock/in`
writes `material_location_stock` with no batch at all, so a material can legitimately hold both.

Ask the owner to run this **read-only** query against production (it writes nothing):
```sql
SELECT
  SUM(CASE WHEN nb>0 AND ns>0 THEN 1 ELSE 0 END)                AS materials_with_both,
  SUM(CASE WHEN nb>0 AND ns>0 AND overlap=ns THEN 1 ELSE 0 END)  AS fully_explained_by_import,
  SUM(CASE WHEN nb>0 AND ns>0 AND overlap<ns THEN 1 ELSE 0 END)  AS holds_real_legacy_stock_too,
  SUM(CASE WHEN nb>0 AND batch_qty=0 AND ns>0 THEN 1 ELSE 0 END) AS coalesce_would_return_zero
FROM (
  SELECT m.id,
    (SELECT COUNT(*) FROM batches b WHERE b.material_id=m.id) AS nb,
    (SELECT COALESCE(SUM(b.remaining_quantity),0) FROM batches b WHERE b.material_id=m.id) AS batch_qty,
    (SELECT COUNT(*) FROM material_location_stock s WHERE s.material_id=m.id AND s.quantity>0) AS ns,
    (SELECT COUNT(*) FROM material_location_stock s
       JOIN locations l ON l.id=s.location_id
       WHERE s.material_id=m.id AND s.quantity>0
         AND EXISTS (SELECT 1 FROM batches b WHERE b.material_id=m.id AND b.bin_location=l.code)) AS overlap
  FROM materials m);
```
- If `holds_real_legacy_stock_too` and `coalesce_would_return_zero` are **both 0**, the simple
  `COALESCE` is safe and you may write it.
- Otherwise, write the compensating expression: batches **plus** only those
  `material_location_stock` rows whose location has no matching batch bin. Add a
  `total_stock_source` field naming which ledgers contributed, and a comment saying it is a
  compensating expression, not a model fix.

**Do not delete `material_location_stock` rows. Ever, in this programme.**

---

## PR E — the site storekeeper role

**Classification: MIGRATION, not a seed change.** `npm run seed` is forbidden in production,
so a seed edit alone reaches no existing tenant. And re-running the seed would be actively
harmful: `server/db/seed2.js:170` runs `UPDATE materials SET is_batch_managed=1` with **no
WHERE clause**, and re-inserts every default grant for all nine roles, silently restoring
permissions an administrator deliberately revoked.

Today no seeded role can run the collapsed contracting workflow: `warehouse_operator` holds
`gi_posting` but not `picking`, `goods_receipt` or `quality`, and `warehouses_master` is
granted to **no role at all**.

1. Add to `ROLES` in `server/db/seed2.js` (for new tenants):
   `site_storekeeper` holding `dashboard`, `warehouse_dashboard`, `goods_receipt`, `quality`,
   `picking`, `gi_posting`, `qr_printing`, `bins_master`, `batch_tracking`, `cycle_count`,
   `inventory_count`, `notifications`.
2. Add an **additive** migration: `INSERT OR IGNORE` the role, then `INSERT OR IGNORE` the
   grants **for that role only**. Touch no existing role's grants. Assign the role to no user.
3. In the PR body, declare the expected row delta (`roles +1`, `role_permissions +N`) so the
   widened deploy gate from PR B does not read it as an accident.
4. Rollback, for the PR body: delete the role's `role_permissions` then the role — clean
   **only while no user is assigned to it**, because `users.role_id` is `NOT NULL REFERENCES`.

**In the same PR**, close the control this role would otherwise leave open. The segregation of
duties this product advertises protects the *goods issue*; the fastest way to make material
disappear is a **cycle count**, which today needs one signature. In
`server/routes/cycleCount.js`, the post handler (around line 84) must refuse when
`cc.counted_by === req.user.id` unless the user is `admin` — the exact four-eyes shape already
used at `server/routes/subcontractors.js:566` and `server/routes/reallocation.js:170`. Add the
`activeFreeze` check there too. Render "counted by X, posted by Y" on the screen so the refusal
is understandable.

**Deploy this PR alone.**

---

## PR F — the forward edge

**Depends on PR E being deployed and verified, not merely merged.**

On a contracting tenant an approved request reaches `Pending Picker Assignment` with stock
reserved against it and **cannot be advanced from any screen**. `POST /api/picking/requests/:id/claim`
(`server/routes/picking.js:75`) is the only forward edge and has no client:
`grep -rn "claim" public/js` returns two prose matches and **zero API calls**.

1. Add a "Ready to pick" list to `public/js/pages/picking.js`, fed by `/api/warehouse/queue`
   filtered to `Pending Picker Assignment`, shown when `App.routesStraightToStore()` is true,
   with a button calling the claim endpoint.
2. `public/js/pages/pickerAssign.js:15` already tells the user *"the store claims its own work
   from My Picking Tasks"* — pointing at a screen with no such control. After (1) that sentence
   becomes true. Leave it.
3. `server/routes/warehouse.js:146` populates the picker dropdown with `WHERE r.name='picker'`,
   so a storekeeper on any other role — and the administrator, the only user a provisioned
   tenant has — is not selectable. Change it to select users holding the `picking` permission
   rather than users with one hardcoded role name.
4. **Fix the test that hid this.** `tests/smoke/first_run_guide_browser.js:154` drives the claim
   **over the API with a bearer token** and then asserts only that the page *text* mentions
   claiming — so it passes on a dead screen. Rewrite it to click the control.

---

## PR G — the design system

**Blocked on PR B2 being deployed.** Without it a correct fix reaches no browser.

`public/css/kynox-v2.css` defines `:root` as the **dark** palette; `[data-theme="light"]`
overrides 12 tokens and **none** of `--success`, `--success-bg`, `--danger`, `--danger-bg`,
`--warning`, `--warning-bg`, `--role-bg`, `--role-text`. The default theme is light, so in the
default theme those eight status tokens are dark-theme values on a white card. Measured:
`.badge.role` is **1.28:1** — and `role` is the fallback `statusClass()` returns, so it is the
badge on "Warehouse Assigned", "Picking in Progress" and every priority chip.

1. Add all eight missing tokens to the `[data-theme="light"]` block, at a contrast ratio of at
   least 4.5:1 against the card background.
2. `kynox-v2.css:88` is
   `.btn:not(.secondary):not(.danger):not(.ghost) { background: linear-gradient(...) }`.
   Specificity (0,4,0) beats `.btn.success` (0,2,0) and it loads after `styles.css`, so **green
   never renders** — Approve, Post Goods Issue, Release, Accept Task all look like any neutral
   button. Give `.btn.success` a rule that wins.
3. **`.btn.warn` has no CSS rule anywhere in either stylesheet.** So `"Reverse GI"` — the
   control that un-posts a goods issue and returns stock to batches — is pixel-identical to
   "Submit". Add the rule.
4. Add a test asserting the computed contrast of the status tokens in the light theme.
   Mutation-test it: break a token deliberately and confirm the test fails.

---

## PR H — screen corrections

1. **Approval integrity.** `public/js/pages/approvals.js:172` collects `approvedLineIds` **only**
   when `decision === 'partial'`. A manager who unticks two lines and presses the big "Approve"
   button approves all of them, silently. Collect the checked line IDs for every decision that
   has a line table. Add a test: untick lines, press Approve, assert the unticked lines are not
   approved.
2. **Mouse-wheel stock mutation.** `public/js/pages/warehouseData.js:156-164` renders a
   `<select>` per row whose `change` handler immediately posts a quality change with a hardcoded
   `reason: 'Quality decision'` — no confirmation, no reason prompt, no `aria-label`. Scrolling
   a long batch list with the cursor over a select silently blocks or releases stock. Require the
   same confirmation and typed reason the *button* path at `warehouseData.js:112-116` already
   demands.
3. **Test hook in production.** Delete the `"Simulate ERP posting error (test)"` checkbox at
   `public/js/pages/giPosting.js:56` and the `simulate_error` field it feeds at line 68. It sits
   directly above the button a storekeeper presses to move real stock.
4. **Dead link.** `public/js/pages/adminViews.js:141` links to `#/request-detail-lookup`, which
   is not a registered route and appears exactly once in the whole repository. Clicking the
   request number in the notification centre silently throws the user to Home. Point it at the
   real request-detail route.
5. **First-run checklist.** `public/js/pages/home.js:83,90` render every step as a bare link with
   **no permission filter**, and `public/js/app.js:319-323` silently redirects a user who lacks
   the permission. A user on the `picker` role bounces on all seven steps. Filter the steps
   through `App.can()`. Note: this is presentation only — the routes are already protected
   server-side, so do not treat it as an authorization fix.
6. **Blank charts under a green light.** `public/js/pages/dashboard.js:87,95` render
   "LIVE OPERATIONS" and a green "Data loaded" indicator unconditionally, and `renderCharts`
   (line 201) has no empty guard, so a fresh tenant sees four blank canvases under a claim that
   data loaded. Guard it and say "no activity yet".
7. **Missing empty states.** `warehouseData.js:276-281` (Bin Locations), `:317-320`
   (Movement Types) and `:150-158` (Quality, "All batches") render `rows.map(...)` with no
   fallback. Use `UI.meaningfulEmptyState`, which 22 other files already use. And stop it
   stamping a green success tick on "No stock recorded yet" — having no data is not an
   achievement.

---

## PR I — mobile, stop the bleeding

Separate track, separate CI, separate release cadence. The APK is not deployed by
`production-release.yml` at all. The app was last touched 2026-09-03; 62 commits have landed on
main since, 15 of them in `server/` or `public/`.

1. **`wms flutter application/lib/screens/gi_screen.dart:18`** pre-fills the GI document number
   with `'49' + timestamp fragment`, so **every mobile goods issue posts a fabricated 10-digit
   pseudo-SAP number** and the server's number-minting branch (`server/routes/gi.js:131-139`) is
   never reached from a phone. Delete the pre-fill; leave the field empty, matching
   `public/js/pages/giPosting.js:53`.
2. **`android/app/build.gradle.kts:32-36`** signs the **release** build with the debug key. A CI
   runner generates a fresh debug keystore when none exists, so consecutive builds carry
   different keys, every update fails to install over the last, and the required uninstall
   silently discards any unsynced offline queue. Add a real signing config with a CI-held
   keystore.
3. **`lib/core/session.dart` `signOut()`** clears the token, user and lock but not `queue`. On a
   shared site phone, storekeeper A's offline counts flush under storekeeper B's token. Clear it.
4. **`lib/screens/receiving_screen.dart`** sends no `owner_type`, so subcontractor material is
   booked as company stock — and ownership is immutable by design
   (`server/routes/receiving.js:50-53`), so there is no way to correct it afterwards. Add the
   ownership question the web screen asks at `public/js/pages/receiving.js:58-67`.
5. **`pubspec.lock`** is stale since 2026-07-27 and pins none of `mobile_scanner`,
   `firebase_core`, `firebase_messaging`, `connectivity_plus`, `local_auth`. Two builds of the
   same commit can ship different camera and push plugins. Run `flutter pub get` and commit it.
6. **`lib/screens/settings_screen.dart:66-72`** still offers Arabic and French. The web settled
   English-only (`public/js/i18n.js:137`). Selecting Arabic flips the whole app to RTL and leaves
   most of it in English. Remove both options.

**Report, do not fix:** `lib/screens/scan_screen.dart:24` constructs a
`MobileScannerController` and never calls `.start()`. If that reading is correct the camera
never opens — the app's central premise. It cannot be settled without a physical device. Say so
in the PR body.

---

## PR J — performance, measured

Every payoff below was measured on synthetic databases at 10× and 1M rows. None of these
changes alters a single output value. The mechanism that makes them matter: `better-sqlite3` is
**synchronous**, so a slow read blocks the whole event loop — a stock-in write was measured at
5 ms idle and **1,577 ms** while one bins query was in flight. A slow screen and a blocked goods
issue are the same defect.

1. `CREATE INDEX idx_tasks_request ON picking_tasks(request_id, id);`
   Warehouse Queue **6,935 → 15 ms**.
2. `CREATE INDEX idx_batches_bin ON batches(warehouse_code, bin_location, remaining_quantity);`
   Bins **1,277 → 12 ms**; empty locations **442 → 1.8 ms**.
   **Must not be a partial index.** A `WHERE remaining_quantity > 0` variant was measured and
   makes the bins query **4× worse** (1,277 → 5,772 ms) because the planner abandons its
   automatic index.
3. `server/services/analytics.js:226-228` calls `shiftDay()` 90 times **inside** the per-material
   loop, regenerating the same 90 date strings for every material. Hoist `const days = [...]`
   above `materials.map(...)`. **1,018 → 20 ms at today's production size** — 849 ms of the
   1,187 ms production pays right now, and it is one line.
4. `server/services/analytics.js:69-76` is `historicalCandidates.some(...)` inside
   `operational.forEach(...)` — quadratic. Build a `Set` of the composite key
   `material_id|category|posting_date|quantity|reference` once and test membership.
   **131,001 → ~50 ms** at 200k×200k.
5. `app.use(require('compression')())` in `server/index.js`. There is no compression anywhere —
   not in Express, not in Caddy. The mobile bin screen: **3,471 KB → 383 KB**.
6. `server/routes/dashboard.js:194-202` and `:253-260` wrap `transaction_date` in `date()`,
   making it non-sargable, five times per dashboard load. Use
   `transaction_date >= date('now','-29 days') AND transaction_date < date('now','+1 day')`.
   **136 → 0.9 ms** each at 1M. Output was verified byte-identical.

Then fix the gate that missed all of it: `tests/load/smoke-load.js` runs against ~20 seeded rows
and probes five endpoints, none of them slow. Extend `tests/load/seed-scale.js` to populate
batches, bins, request headers and lines, picking tasks, audit trail and movement history; point
the load test at that; add the seven slow endpoints to its route list; and wire
`tests/load/write-contention.js` into `npm run test:load` — on a synchronous database the number
that matters is write latency while a read is in flight.

---

## PR K — the report the product is bought for

The single question a contracting owner pays to answer — *what did we spend on which project* —
**cannot be answered by this system today.** Not partially. There is no screen, no endpoint and
no query; `wbs_element` appears in none of `kpi.js`, `dashboard.js` or `analytics.js`.

The data is already there. Build one endpoint and one screen:
```sql
SELECT h.wbs_element AS project, COUNT(*) AS movements,
       ROUND(SUM(st.quantity * m.price), 2) AS spend
FROM stock_transactions st
JOIN material_request_lines   l ON l.id = st.request_line_id
JOIN material_request_headers h ON h.id = l.request_id
JOIN materials                m ON m.id = st.material_id
WHERE st.transaction_type = 'OUT'
  AND st.transaction_date >= ? AND st.transaction_date < ?
GROUP BY h.wbs_element ORDER BY spend DESC
```
Required, all measured:
- `CREATE INDEX idx_mrh_wbs ON material_request_headers(wbs_element);`
- `CREATE INDEX idx_stock_tx_spend ON stock_transactions(transaction_type, transaction_date, request_line_id, material_id, quantity);`
  (this also delivers PR J item 6's index — the two share a migration)
- **The date window must be mandatory and bounded.** Windowed is 301 ms at 1M rows; all-time is
  **2,556 ms** of a fully blocked event loop. Never make "all time" the landing state.
- Never write `date(st.transaction_date)` — it defeats the index.

Three correctness traps that will make the report wrong if ignored:
- `request_line_id` is written in exactly two places, both in `server/routes/gi.js`, and
  `gi.js:243` says outright that pre-migration rows lack it. Every issue posted before migration
  026/027 is **invisible** to this report. State a coverage floor on screen, the way
  `analytics.js` `movementCoverage` already does.
- Reversals carry `request_line_id` too and are `transaction_type='IN'`, so a `WHERE
  transaction_type='OUT'` filter leaves a reversed goods issue counted as spend forever. Use
  `movement_category` and subtract `REVERSAL` rows — `analytics.js:151-156` already implements
  exactly this and should be the shared source.
- `materials.price` is a **single current price**, not the price at time of issue. Every
  historical figure silently reprices when somebody edits a material. Say which it is on screen.

Ship alongside:
- **Enforce `requiredRequestFields`.** `server/services/tenantProfile.js:103` declares
  `['wbs_element','plant']` with the comment *"Project attribution is the whole point of a site
  store — enforce it."* **It is read by nothing.** A request can be created with no project.
- **Make the project a dropdown, not free text.** `public/js/pages/createRequest.js:57` is a
  free-text box; two spellings of one project produce two projects and the report is garbage
  within a month. `reference_data` already has categories — add PROJECT.
- Add a project column and filter to the requests list.

---

## PR L — say what the product is, in the customer's words

1. **Deliver the terminology map.** `server/services/tenantProfile.js:75-81` defines
   `Cost Center → Project Cost Code`, `Plant → Site`, `Warehouse → Site Store`,
   `ERP Operator → Procurement Officer`, `Movement Type → Issue Category`. The `term()` function
   that applies it is exported and **called from nowhere**, and `getTenant()` does not send the
   map to the client. Send it from `/api/auth/me` alongside `modules` and `erpStaging` (the
   client already consumes both) and apply it.
2. **Replace the raw enums shown to users:** the Request Type dropdown renders
   `COST_CENTER, WBS, ORDER, GENERAL` verbatim as the first field of the first form a site
   engineer ever sees; `warehouseData.js:154-157` shows `QUALITY_HOLD / RELEASED / BLOCKED /
   REJECTED` as badge text and option values, on step 5 of the first-hour checklist.
3. **Stop printing fields that cannot have a value on this edition.** `requestDetail.js:52-61`
   shows 14 header fields of which 7 are always "—" on contracting.
   `UI.executionContextCard` puts an 11-field ERP panel on the picking and GI screens, 5
   permanently "—". Every request card appends `ERP — · Movement — · Plant — · SLoc —`.
   `UI.requestStageIndicator` (`ui.js:427`) hardcodes an **"ERP Processed"** stage that cannot
   occur. The status filter offers **35** options, 8 of them unreachable. Hide all of it when
   `erpStaging` is false.
4. **Fix the mixed-unit totals — with per-unit subtotals, not with money.** The dashboard adds
   BAG + TON + M3 into one number. **Do not multiply by `materials.price`**: that column has no
   provenance, no effective date, no valuation basis and no aggregated currency,
   `Number(x) || 0` turns any blank into zero, and the analytics screen already performs exactly
   this multiplication and renders a stock value of **zero** over 530 units of real stock. Group
   by `m.unit` and show one figure per unit.
5. **Make the demo show the control being sold.** `scripts/create-demo-tenant.js` walks through a
   workflow but never triggers the segregation-of-duties refusal, even though
   `server/services/sod.js:33` produces a specific quotable sentence. For a contractor whose
   actual fear is a storekeeper issuing material to himself, that refusal **is** the product, and
   it is currently invisible in its own demo.
6. **Rewrite `public/js/pages/landing.js` for contracting.** It sells a generic WMS and its
   journey step 2 promises *"create the ERP reservation"* — on the public page, to a buyer being
   told they do not need SAP.

---

## 3. Deliberately not being done

Recorded so they are not rediscovered and re-proposed:

- **Bulk-setting `is_batch_managed` on existing materials.** Production holds ~9,700 real
  imported materials. The flag is copied onto request lines at creation time, so a blanket update
  splits behaviour mid-flight for open work, and the deploy gate cannot see a column change at
  all. Setting it in `install-starter-data.js` for **new** tenants is fine and is part of PR E's
  wave; touching existing materials is a feature (editable column, import field, audit), not a
  migration.
- **Deleting `material_location_stock` rows.** Destructive, breaks the legacy location screens,
  irreversible without a restore, and unnecessary once the query is fixed.
- **The subcontractor ledger convergence apply.** Run the read-only report first to learn whether
  anything remains. If it does, it is an out-of-band operation **after** the UI stops writing
  legacy rows — with a verified backup, a reversal script written in advance, and no deploy in
  flight. It writes to `batches`, which the deploy gate watches, so shipping it inside a deploy
  guarantees a false rollback that leaves the rows behind.
- **Arabic.** `ENABLED_LANGS = ['en']` is implemented cleanly and consistently; the machinery is
  dormant, not half-wired. If ever taken up, scope it to the ~150 strings on the yard-facing path,
  not the 1,348 in the baseline.
- **3D warehouse view, and any further analytics.** Both assessed and declined. A contractor's
  store is six locations, half of them open yard, and `bin_locations` carries no coordinates.
  Analytics needs 90 days of history the pilot will not have.
- **Screen consolidation** (four screens about bins, two about counting, two about subcontractor
  stock). Real, but a product decision, not a defect.

---

## 4. Guards — a fix without one comes back

Each guard must be **mutation-tested**: break the code deliberately, confirm the guard fails,
restore. A guard that has never been seen to fail is not a guard.

| Guard | Pins |
| --- | --- |
| Browser test that **clicks** the claim control rather than calling the API | PR F |
| Release a SUBCONTRACTOR batch, raise a company request, assert full shortfall | PR A7 |
| Open a count, attempt a pick and a GI, assert both refuse | PR A6 |
| Computed contrast of the light-theme status tokens | PR G |
| Untick lines, press Approve, assert the unticked lines are not approved | PR H1 |
| Every `href="#/..."` in `public/js` resolves to a registered route | PR H4 |
| Materials list and request screen agree for a material holding **both** batch and legacy stock, and neither returns zero | STOP 2 |
| A cycle time over zero completed requests is `null`, not `0` | plan §2 T6 |
| A signed-up user cannot reach any stock-mutating route | PR A4, A5 |
| `tests/run.sh` refuses when `DB_PATH` points outside the repo | PR A1 |
| Deploy asserts the served `BUILD_SHA` equals the requested ref | PR B1 |
| Every `docs/**` path cited in code or `.ai/` exists | PR C5 |
| Name-table test parses `home_screen.dart` | PR I |
| Load test runs against the scale dataset and asserts write latency under concurrent read | PR J |

---

## 5. When to stop and ask

Stop and ask the owner — do not decide — when:
- a verification step does not produce the stated result;
- a fix would require changing a test's expectation rather than the code;
- you reach STOP 1 or STOP 2;
- a change would touch production data, or you are asked to dispatch a deploy;
- two sources in the repository contradict each other and this file does not say which wins.

Otherwise: execute in order, verify each step, push, open a draft PR, and move to the next.
