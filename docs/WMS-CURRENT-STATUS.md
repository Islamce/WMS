# WMS Current Status

Last updated: 2026-09-04

## Executive status

- Repository: `Islamce/WMS`
- Production URL: `https://wms.kynox.io`
- Production platform: Hostinger managed Node.js / Passenger
- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: SQLite at `data/wms.db` using WAL mode
- Production runtime: Node `v20.19.4`, npm `10.8.2`
- Current deployed commit (**Verified (GitHub Actions release run `32290976629` / "Manual production release" #25, 2026-08-31 session)**): `26a5c30`, confirmed via GitHub compare to be identical to `8b4f06fba09e0c0b0fe4cbe2d023276269978a51` (PR #107 — idempotency guards on 3 POST endpoints, audit-log coverage on materials/locations/attachments/openingStockReconcile/import/permissions/users, one mobile-only UI change; no migration). PR #107 was already deployed before the 2026-08-31 session began; no deploy action was taken that session.
- **Production deploy mechanism, corrected (Verified, 2026-08-31):** production is deployed via the `production-release.yml` GitHub Actions workflow into `~/domains/wms.kynox.io/hbuilds/versions/gha-<run-id>-1`, confirmed by matching the live Passenger process's working directory to a specific successful release-workflow run. It is **not** deployed via manual `git merge`/`npm`/restart commands in `~/domains/wms.kynox.io/nodejs` — that checkout exists but is stale (detached HEAD at `90131d6`/PR #49, ~1 month behind `origin/main` as of 2026-08-31) and disconnected from the real deploy path. Do not use that checkout for future deploys without first reconciling or removing it.
- Health endpoint: healthy, returning `{"status":"ok","service":"wms"}` (**Verified**, 2026-08-31 session, via `curl` from an SSH session on the host).
- Passenger runtime environment (**Verified, 2026-08-31, via `/proc/<pid>/environ` on the live process**): `NODE_ENV=production`, `SKIP_AUTO_SEED=1`, `ALLOW_AUTO_SEED=0`, `PRODUCTION_INITIALIZATION_ENABLED=false`, `DB_PATH` correctly set. All five required invariants confirmed correct on the actual serving process, not just an interactive shell.
- Production database (**Verified, 2026-08-31, via direct `sqlite3` query over SSH**): `users=11`, `materials=9746`, `PRAGMA integrity_check=ok`. Healthy and consistent with the last recorded snapshot.
- Database migrations: 14 recorded in production (**Verified** by the idempotent final migration gate, which reported `Migrations: up to date (14 recorded)`). Migrations 013 and 014 were applied in the earlier controlled candidate stage and were not re-applied during the successful final release. Not re-checked in the 2026-08-31 session.
- Offsite backup: **Verified (repo + production), 2026-08-31:** the workflow had failed its last three scheduled runs (#57–#59) with `client_loop: send disconnect: Broken pipe` mid-SSH-session — not the IP-allowlist/ban cause originally suspected (this Hostinger plan tier has no IP-allowlist or firewall feature at all, and no active ban was found). The likely cause is account-wide process-count pressure on the shared hosting plan (Max Processes averaging 186–200 of a 200 cap, cyclical) — unresolved, see "Known remaining work." A manual re-run (`production-backup.yml` run #60, `33431636062`) completed successfully with no configuration changes, producing verified offsite set `20260831193821`. A non-blocking warning about local retention pruning was also surfaced (offsite copy unaffected) — see "Known remaining work." **Update, 2026-09-03: this has recurred — every run since has failed. See item 13 below; there is very likely no successful verified offsite backup since run #60.** **Update, 2026-09-04: root cause CONFIRMED via live hPanel evidence — the account is pegged at/near its 200-process cap almost continuously since 2026-08-29 (all other resources healthy). See item 13 for the full evidence and remediation options (plan upgrade or reducing standing load).**
- PR #53 merged 2026-08-01; its CI and native-build checks were green at merge (see `WMS-INCIDENT-LOG.md` → `INC-2026-07-31-01` for the full artifact/inspection history).
- **Open (2026-09-01): PR #108, "Prevent duplicate submissions from double-clicks."** Client-side hardening — see item 20 below and the 2026-09-01 session log entry for the full audit and fix details. Not yet merged or deployed.

### Evidence classification

Facts in this document are labelled as follows and must not be silently upgraded:

- **Verified (repo):** confirmed directly against Git/GitHub in the stated session.
- **Reported (production):** observed by the operator during a production session and recorded here. Trustworthy as a record, but re-verify before relying on it for a risky operation.
- **Unverified:** believed but not currently evidenced. Must be re-checked before use.

## Workflow context and analytics integrity corrective phase — reconciled for Draft PR

**Verified (repo), 2026-08-11:** The original work was preserved at `a97f07f`
and reconciled as `fix/workflow-context-analytics-integrity-v2`, based on main
`3350d2bacbe2cd2c6610b0b575497ff104693631`, to correct two confirmed defects:

- downstream queue projections omitted ERP reservation/reference, plant,
  storage location, and related request context even though the header retained
  those fields; a canonical execution-context response is now attached to
  request, ERP, warehouse, picker, and GI APIs and rendered by web/Flutter
  operations screens;
- analytics read only `stock_transactions`, treated all OUT rows as demand,
  ignored the append-only imported history, and declared stocked materials
  dead without proving that the 90-day issue-history window was covered.

The branch extends the existing append-only movement-history architecture with
normalized categories, original ERP movement type, analytical dates, source
and batch traceability, preview/dry-run, field mapping, reconciliation, and
rejected-row retrieval. Historical imports remain analytically separate and do
not write batches, location balances, reservations, or `stock_transactions`.
Analytics now uses a canonical combined movement stream, nets issue returns and
reversals, excludes transfers/adjustments/opening balances from demand, and
gates definitive `DEAD` classification on continuous operational-ledger
coverage. Sparse import files contribute observed issue dates but cannot assert
global completeness. Partial or absent
coverage reports stocked/no-issue materials as `UNKNOWN` with a warning.

Runtime tests are defined in `tests/e2e/corrective_integrity_test.py` and the
existing workflow/reversal suites. In this local session, execution is blocked
because dependencies and an npm executable are absent from the clean worktree.
JavaScript and Python syntax checks and
`git diff --check` passed. KAAF regeneration was also attempted and stopped on
the repository's pre-existing declared dependency cycle
`wms-api -> wms-ops-scripts -> wms-api` (already present among the five errors
in `.ai/drift.json`); generated `.ai/` files were not hand-edited. CI remains
the required runtime evidence for the Draft PR; do not represent the
unexecuted local suite as passing.

The original local implementation remains preserved at recovery commit `a97f07f`.
No production access, deployment, migration, historical import, Passenger
restart, database mutation, or merge occurred in this corrective phase.

## Hostinger native-addon recovery — RESOLVED (2026-08-01)

Earlier revisions of this section stated that the native-addon recovery was open, that PR #53
was in Draft, and that Passenger restart remained forbidden. **That statement is stale and is
superseded by this section.**

**Reported (production), 2026-08-01; independently corroborated 2026-08-04 for the items
marked below:** PR #53 (`agent/hostinger-glibc228-native-recovery`) merged, and the full
`HOSTINGER-NATIVE-RECOVERY.md` gate sequence was executed against the production Hostinger
host and passed:

- Deployed source: `1bd15f12d70112a977983a96bae63e1b3c441310`, matching the expected branch,
  with a clean working tree.
- Effective Passenger environment — read from `/proc/$PID/environ`, not an interactive shell —
  confirmed all five required variables correct: `NODE_ENV=production`, `SKIP_AUTO_SEED=1`,
  `ALLOW_AUTO_SEED=0`, `PRODUCTION_INITIALIZATION_ENABLED=false`, and `DB_PATH` resolving to
  the application's `data/wms.db`. This also closes the outstanding auto-seed
  runtime-environment question carried since `INC-2026-07-25-01` and Issue #40.
- Production database: `PRAGMA integrity_check = ok`; record counts
  `9|11|35|9746|1|12|0|0` (users|roles|permissions|materials|warehouses|migrations|batches|
  stock_transactions), matching the last reviewed baseline exactly.
- No `production-initialization.lock.json` present, as expected.
- **Independently corroborated:** native-addon artifact SHA-256
  `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` — matches the artifact
  already independently inspected and recorded on 2026-08-01 (binary, checksum, manifest, and
  GLIBC evidence all verified then). The staged addon passed `ldd`, in-memory load/query, and a
  read-only backup query before installation.
- The previously installed addon and a consistent database copy were preserved; the new addon
  was installed by same-directory atomic rename. The immediate rollback path is retained at
  `/home/u716763642/domains/wms.kynox.io/nodejs/backups/emergency/production-recovery-20260801T202313Z/rollback-production.sh`.
- No seed, reset, initialization, or database-mutating command was run.
- **Independently corroborated:** Passenger is running the new addon; `https://wms.kynox.io/healthz`
  returns `200 {"status":"ok","service":"wms"}`.

This closes `INC-2026-07-31-01` and satisfies `DEC-013`'s gate requirements in full. See
`WMS-INCIDENT-LOG.md` → `INC-2026-07-31-01` for the complete prior history (the original
GLIBC-2.29-vs-2.28 incompatibility, the artifact-storage-quota saga, and the earlier partial
builds), which is preserved unchanged, and the 2026-08-01 session-log entry for the resolution
evidence.

**Evidence-class note:** the Passenger-environment read-out, database identity/lock check, and
gate-execution sequence above are recorded as reported by the operator (per `DEC-010`, not
silently upgraded to Verified). This session independently corroborated only `/healthz`, the
addon SHA-256, and the database counts.

## Current production data state after recovery

Database record counts (**Reported (production)**, 2026-07-25, post-restore):

- Users: 9
- Roles: 11
- Permissions: 35
- Materials: 9,746
- Warehouses: 1
- Schema migrations: 12
- Database integrity: `ok`

Dashboard values (**Reported (production)**, 2026-07-25):

- Materials: 9,746
- Empty bins: 1,245
- Occupied bins: 0
- Stock: 0

The zero stock figure is **expected and consistent**, not evidence of further loss: the validated recovery source itself contained zero `batches` and zero `stock_transactions`. Material-master count alone cannot establish what operational stock existed at the recovery point. These values do not represent intended final operational stock, which still requires controlled Opening Stock loading and reconciliation.

## Administrator authentication — RESOLVED (2026-07-25)

Earlier revisions of this document stated that administrator login was an open blocking issue. **That statement was stale and is superseded by this section.**

The login failure was **not** a credential problem. It was traced to the active production database being structurally valid but functionally empty (`users = 0`, `roles = 0`, `materials = 0`). Restoring a validated recovery copy resolved it, and the operator confirmed a successful login with the existing administrator account. No seed and no `reset-admin` were used.

See `WMS-INCIDENT-LOG.md` → `INC-2026-07-25-01` for the full evidence chain, selected-source checksum, and rollback directory.

## Auto-seed hazard — DEMONSTRATED, fixed in code, NOT YET DEPLOYED

**Status (2026-07-27): the mechanism is proven by executable test, the fix is merged to `main`, and production is not yet known to have it.**

The behaviour below was confirmed empirically, not merely by reading code. Booting the real server against a migrated-but-userless database with `NODE_ENV` unset caused it to seed demo data and a default administrator. `tests/e2e/autoseed_guard_test.py` fails against the old guard and passes against the new one, so this is now a pinned regression rather than an opinion.

**Fix:** auto-seed is now **opt-in** (`ALLOW_AUTO_SEED=1`). Absence of configuration means refuse. Safety no longer depends on `NODE_ENV` being present. The server also logs a database identity line (`[db] path=… size=… users=… migrations=…`) on every boot, and prints a `[CRITICAL]` warning when it declines to seed an empty database.

**Still open:** whether this ever actually fired in production. That requires the runtime-environment read-out below and is the remaining evidence needed to close Issue #40.

### Original analysis (retained for the record)

**Was: hypothesis, code-verified, production-unverified. Directly relevant to Issue #40.**

Reading `server/index.js` against `server/config.js` on `main`:

1. If `SKIP_AUTO_SEED` is not `1`, the first-run auto-seed block executes.
2. If the active database has `users = 0`, it reaches the production guard.
3. The guard is `NODE_ENV === 'production' && ALLOW_AUTO_SEED !== '1'`. If **`NODE_ENV` is not exactly `production`**, the guard does not trigger and control falls through to `require('./db/seed').seed()`.

Consequence: on an empty database with an unset or non-`production` `NODE_ENV`, the application will **create demo data and the default administrator automatically**, with `must_change_password = 1`.

This single mechanism is consistent with **both** symptoms reported in Issue #40 — an unexpectedly empty database and an administrator password that appears to revert to the default — without anyone ever invoking `reset-admin`.

The 2026-07-25 recovery session reported that `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, and `DB_PATH` printed **empty** in an interactive SSH shell. An interactive shell does not necessarily share the Passenger runtime environment, so this is **not yet proof**. It must be resolved by reading the environment as the application process actually sees it, before any deployment or restart.

Related: `server/services/reset.js` derives the production-initialization lock from the application directory (`<app>/data/production-initialization.lock.json`), **not** from `DB_PATH`. If `DB_PATH` were ever repointed outside the app directory, the lock and the database would decouple.

## Recently completed work

### Production recovery

- Accidental deletion of `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` occurred.
- An initial recovery was taken from an open process descriptor under `/proc/<pid>/fd`, which restored availability.
- Subsequent verification found the **active** production database had become functionally empty (`users = 0`), which is what caused the administrator login failure.
- A validated final live copy was then restored through a controlled, rollback-safe procedure.
- `PRAGMA integrity_check` passed before and after restoration.
- Passenger was restarted.
- Health endpoint, record counts, and administrator login were verified.

### Opening stock historical-date hardening

Merged PR #39 introduced:

- explicit `receiving_date` support for opening stock imports;
- historical receipt-date resolution;
- FIFO date preservation;
- receipt timestamps in stock transactions;
- `receiving_date_source` storage;
- opening-stock batch registry migration;
- safe, registry-scoped reconciliation support;
- protection against touching normal operational goods-receipt batches.

CI Run #145 succeeded before merge.

### Deployment

- PR #39 merged to `main`.
- Merge commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- Production repository confirmed at that commit.
- Migration completed successfully with 12 migrations recorded.
- Application restart and health check completed successfully.
- Reconciliation has not been applied.

## Important prior milestones

- PR #25: notification improvements and mobile UAT; merged.
- PR #26: production offsite backup automation; configured and tested successfully after correcting credentials.
- PR #33: workflow replay/recovery hardening, mobile approval parity, batch/QR traceability, and governed stock reallocation.
- Static navigation cache mismatch was resolved by versioning `navigation-v2.js` in `public/index.html`.
- Firebase service account configuration and Android device token registration were previously established.

## Known remaining work

Ordered by priority. Item 1 gates the rest.

1. ~~Complete PR #53 merge-readiness evidence, then execute recovery gates only in an approved production window.~~ **DONE (2026-08-01).** PR #53 merged; all recovery gates executed and passed; see the resolved section above.
2. ~~Resolve the auto-seed / runtime-environment question.~~ **DONE (2026-08-01).** The Passenger-process environment read-out during the recovery confirmed all five required variables correct. This does not retroactively prove what fired during the original 2026-07-25 incident, but current production is confirmed correctly configured and running the fail-closed code fix.
3. ~~Verify production's deployed commit read-only and reconcile it to `main`.~~ **DONE (2026-08-01).** Production confirmed at `1bd15f1`, which contains PR #43 and all later safety hardening. The `hotfix/opening-stock-idempotency` branch advisory is moot — production is now well past that point in history.
4. ~~Verify the production-initialization lock.~~ **DONE (2026-08-01).** No lock file present, as expected.
5. ~~Complete the reviewed native-addon recovery gates.~~ **DONE (2026-08-01).** See item 1.
6. Deploy the remaining unrelated `chore(kaaf)` commits from `main` is **not required** — they are architecture-diagram tooling with no application impact. Do **not** re-import Opening Stock into production until the item below is complete.
7. Run opening-stock date reconciliation in **dry-run mode only** (`apply: false`) and review the output; apply only after explicit review and approval.
8. Complete the cross-table stock consistency audit required by Issue #40 (batches vs `material_location_stock` vs `stock_transactions` vs dashboard KPIs). Needs real data and production access — **production is now confirmed healthy and reachable**, so this is newly feasible. The **code**-hardening asks in Issue #40 are done: auto-seed fails closed, a database identity line is logged every boot, `reset-admin` refuses default credentials and never seeds, and every credential change is audited (`DEC-011`, `DEC-012`).
9. Complete and validate web/mobile parity gaps where still outstanding.
10. Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.
11. ~~Restore the offsite backup workflow.~~ **DONE (2026-08-11).** `INC-2026-08-06-01` closed — five root causes fixed (SSH key, host-key, `REMOTE_APP_DIR`, `DB_PATH`, retention-step error handling) and validated by a fully successful run (#39). SSH/hPanel work was operator-executed throughout historically; **on 2026-08-31, an assisting session was granted SSH access with the operator relaying command output manually, as an explicit one-session operator override of this standing rule** — see the 2026-08-31 session log entry. The rule itself is unchanged going forward absent a similar explicit override.
12. ~~Hygiene follow-up: rotate the SSH private key exposed 2026-08-11.~~ **Very likely DONE, confirmed as far as possible without cryptographic comparison (2026-08-31).** GitHub's Actions secrets page shows `HOSTINGER_SSH_PRIVATE_KEY` (and every other Hostinger-related secret: `HOSTINGER_HOST`, `HOSTINGER_KNOWN_HOSTS`, `HOSTINGER_PORT`, `HOSTINGER_USERNAME`) last updated **8/11/2026** — the exact incident date, consistent with a full credential rotation that day rather than a partial/missed one. Hostinger's SSH Access panel shows a key named `github-actions-wms-backup-20260811`, also dated 8/11, matching the self-documenting `<purpose>-<date>` naming convention the rotation runbook called for. The offsite backup workflow, which depends on this exact secret, has run successfully many times since (most recently run #60, 2026-08-31). Not independently verified via key fingerprint comparison (would require more invasive access than warranted); treat as resolved on the strength of this evidence unless a specific reason to doubt it surfaces.
13. **Open, RECURRED (2026-09-03): shared-hosting process-count pressure, root cause still not found.** The `kynox.io` Hostinger shared hosting plan (7 sites) runs Max Processes at 186–200 of a 200 cap, cyclically hitting the ceiling. Investigated 2026-08-31: an SSH session on the host only ever showed 5–6 processes total (one being the WMS Node/Passenger process), and no stuck/parallel deployment was found under `~/domains/r4c.kynox.io` or `~/domains/r4c-api.kynox.io` (checked specifically — both sites' `hbuilds` directories were merely recently touched by normal Passenger release rotation, no active build/git/npm process running, `find -newer` for recent changes came back empty). **Conclusion (2026-08-31): the process count is very likely LVE/CloudLinux-level account-wide resource accounting (PHP-FPM workers, cron, short-lived spawns across all 7 sites) that is not visible from any single interactive SSH session** — further diagnosis requires either Hostinger support's own account-level tooling, or checking each of the other 6 sites' own process/worker configuration individually (not yet done). Suspected (not proven) cause of the three offsite-backup SSH failures on 2026-08-29–31 (`client_loop: send disconnect: Broken pipe`).
    **Update (2026-09-03, GitHub-API-only session, no SSH access this time):** the "backup has since run clean" note below was optimistic — it has recurred. The scheduled `Production Offsite Backup` run failed on **every** scheduled run from 2026-09-01 through 2026-09-03 (runs `33484449833`, `33602571624`, `33727383230`), plus a fresh **on-demand `workflow_dispatch` run triggered this session** (`33793805218`, 2026-09-03 ~19:00 UTC) failed the identical way in ~14 seconds. All fail at the same point — the very first remote command after SSH key setup (`Snapshot existing manifests`) — with `Connection to *** closed by remote host.` / exit code 255, before any backup work starts. This is a slightly different error signature than the `Broken pipe` seen 2026-08-29–31, but the same class of symptom (an established SSH session dying near-instantly), and GitHub Actions runners get a fresh IP on every run — a brand-new IP hit the identical wall on the on-demand run, which argues against a stale single-IP block and is consistent with the same account-wide resource-pressure theory (or, alternatively, an SSH-side access/IP restriction change on Hostinger's side around 2026-08-29 — not distinguishable from GitHub Actions logs alone). **Not fixed this session — no SSH/hPanel access was used** (per the standing rule; the 2026-08-31 override was explicit and one-session-only and was not re-invoked). Do not use Hostinger's "Stop running processes" control to address this blindly — it interrupts active requests across all 7 sites and what would be interrupted is still not known. **Practical consequence: there is very likely no successful verified offsite backup since run #60 on 2026-08-31** — treat this as the top production-risk item until resolved, given the 2026-07-25 accidental-DB-deletion history. Recommended next step (needs the operator, not self-service from a code session): check Hostinger hPanel's SSH Access page for an IP allow-list or a disabled/expired key, try an interactive SSH login with the same key to see the server's actual rejection reason (which GitHub Actions' logs do not surface), and if nothing is found there, open a Hostinger support ticket with the Max Processes chart and these run IDs/timestamps as evidence.

    **Update (2026-09-04, CONFIRMED via live hPanel Resources Usage page, operator-in-the-loop this session):** root cause is no longer just suspected — it is directly confirmed. hPanel's `kynox.io` plan page (Cloud Startup, 7 sites) shows a top-level banner: **"Your hosting resource limits have been reached."** The **Max Processes** graph (`hpanel.hostinger.com/websites/kynox.io/order/order-usage`) shows the account pegged at or within 1–3 of the 200-process cap almost continuously over the trailing 7 days (08-28 through 09-04), with only two brief narrow dips — this is a sustained ceiling, not an occasional spike, and it covers the exact window the backup started failing (2026-08-29 onward). Live 24h average: 197/200 (98.5%). 7-day average: 179/200. All other resources on the plan are healthy and not the bottleneck: disk 7.5 GB / 100 GB (8%), inodes 248,729 / 2,000,000 (12%), CPU ~1% average, memory ~509–583 MB / 4,096 MB, IOPS near-zero, PHP workers 7/100. This is conclusive: the shared plan has essentially zero spare process slots at almost all times, so a new inbound SSH connection frequently cannot get a process allocated and the server drops it immediately — exactly matching the `Connection ... closed by remote host` / exit 255 signature. **This closes the open question in this item — the account-wide process-pressure theory is confirmed, not just likely.** hPanel itself offers two paid remediations on the same page: "Upgrade plan" (Cloud Startup → next tier, listed at $20.99/mo, more resources including a higher process cap) and "Boost resources" (temporary performance boost, Free–$9.99). Neither was purchased — plan/cost changes require the owner's decision. Do not use "Stop running processes" as a fix; it only clears currently-running processes and the ceiling will refill immediately under the same sustained load. **Recommended path:** either upgrade the plan (raises the process cap, permanent fix) or reduce standing load across the 7 sites on this plan (identify which site(s) are consuming the bulk of the ~180-200 processes — not yet broken down per-site) — a Hostinger support ticket is no longer strictly necessary now that the cause is visible directly in hPanel, though the resource-usage screenshot is good evidence to include if support is contacted anyway.

    **Update (2026-09-04, per-site breakdown search — NEGATIVE RESULT, saves future re-investigation):** owner asked to pursue the free option (identify and reduce whichever site(s) drive the load, rather than paying for a plan upgrade or boost). Searched hPanel's UI exhaustively for a per-site process/resource breakdown across the 7 sites (`r4c.kynox.io`, `r4c-api.kynox.io`, `logix.kynox.io`, `gate.kynox.io`, `analytics.kynox.io`, `wms.kynox.io`, `kynox.io`) and **found none exists**: the plan-wide Resources Usage page only totals account-wide; each site's own Dashboard ("Plan resource usage" widget) repeats the same account-wide Disk/Inodes/Web-Apps/CPU/Memory figures with no Max Processes line at all; Advanced → SSH Access offers only external-client connection details, no in-panel terminal; Advanced → Cron Jobs is empty account-wide (no cron jobs configured — cron is not the cause); each site's "Tools" menu offers only File Manager and Analytics (visits), not a process viewer; and Runtime Logs came back "No logs found" for every Node app checked (r4c-api, analytics), so log volume isn't a usable activity proxy either. What **is** known: 5 of the 7 sites are always-on Node.js "Web Apps" (`r4c`, `r4c-api`, `logix`, `analytics`, `wms` — matching the account's "Web Apps: 5/10" counter), and the other 2 (`gate`, `kynox.io`) are PHP/HTML/static type. With 5 concurrently-running Node apps sharing one 200-process account cap (plus PHP, cron, SSH, mail), the ceiling plausibly comes from the combined baseline of all 5 apps rather than one single "bad" site — hPanel's UI cannot attribute it further. **Practical conclusion for the free-option path:** the only ways to actually get a real per-process/per-site breakdown from here are (a) a free Hostinger support ticket — support has backend/root visibility hPanel's UI doesn't expose and can say exactly which processes are consuming the slots, or (b) the owner deciding whether any of the 7 sites (most plausibly one not in active daily use) can be temporarily paused/stopped to see whether the Max Processes ceiling drops — a product/business call only the owner can make, especially since `r4c.kynox.io`/`r4c-api.kynox.io` are under active development by another agent and should not be touched without coordinating there first. Neither action was taken this session; both were left for the owner's decision.

    **Update (2026-09-04, owner decision + action taken):** owner confirmed `wms.kynox.io` and the R4C pair (`r4c.kynox.io` + `r4c-api.kynox.io`, kept together since the API backs the frontend) are the only sites in active use, and authorized stopping the rest. Checked hPanel's actual controls for `logix.kynox.io` before acting: there is **no "stop/pause" option for a Web App** — the "Running" status dropdown offers only Restart, and the site-row "⋮" menu offers only Add to favorites/Add tag/Change domain/Website Details/**Delete** (full removal, would require re-importing from GitHub and reconfiguring domain/env vars to bring back). Given that gap between what was asked ("stop it") and what hPanel actually offers (keep running, or delete outright), this was surfaced back to the owner rather than deleting the site unasked. Owner chose the lighter, reversible action instead: **auto-deployment was turned off for `logix.kynox.io`** (Dashboard → Auto-deployment toggle → "Turn off auto-deployment"; confirmed via UI, badge now shows off). This only stops future auto-builds from Git pushes — **it does not stop the app's currently-running process(es) and will not by itself lower the Max Processes count or fix the backup**. `gate.kynox.io`, `analytics.kynox.io`, and `kynox.io` were left untouched (owner did not select them to stop). If the backup is still failing after this, the process-count ceiling is unchanged and the remaining paths are still: a Hostinger support ticket, or the owner approving an actual Delete of an unused site.
14. ~~Stale, disconnected `~/domains/wms.kynox.io/nodejs` checkout.~~ **DONE (2026-08-31).** Detached HEAD at `90131d6` (PR #49, 2026-07-28) with uncommitted branding assets (`public/css/kynox-v2.css`, hero images, `kynox-mark.png`, `navigation-v2.js`, `auth.js`) was confirmed byte-identical to the same paths already on `origin/main` (`git show 26a5c30:<path> | diff -` returned empty for every tracked file; image checksums recorded) — the uncommitted state was a harmless stale leftover of already-merged, already-deployed work, not unmerged work at risk. Checkout reset via `git checkout main && git reset --hard origin/main`; now clean and at parity with `origin/main`/production. Untracked runtime artifacts (`backups/`, `console.log`, `stderr.log`, `tmp/`) left in place, harmless.
15. **Open (2026-08-31): local backup-retention warning, cause narrowed but not confirmed.** Offsite backup run #60 (`33431636062`) succeeded and produced a verified offsite set, but surfaced: "Local retention reported a problem; offsite backup is still valid. Inspect /home/***/secure/wms-backups." Investigated: `/home/u716763642/secure/wms-backups` contains 8 valid backup sets (one over the `KEEP_SETS=7` policy) plus orphaned `.db-shm`/`.db-wal` files and two named incident-recovery copies (`wms-inventory-recovery-candidate-...`, `wms-pre-inventory-recovery-...`) from 2026-07-25 — but `scripts/backup-retention.js`'s own file-matching regexes (`wms-<digits>.db`/`.manifest.json`/`attachments-<digits>`) ignore all of those non-conforming names entirely, so they are **not** the cause. The workflow step deliberately swallows any failure (including a transient `scp`/`ssh` hiccup) into this same soft warning; given the SSH flakiness already documented around this time window, a transient connection issue on the retention sub-step (item 13) is the more likely explanation, not a script defect. Not reproduced or confirmed directly. The orphaned recovery-era files in that directory are unrelated leftover hygiene, not yet cleaned up (left alone deliberately, given their incident-recovery provenance).
16. **(New, 2026-08-27) Confirm CI status for `main` head `26a5c30`** via the GitHub Actions UI directly — not independently confirmed from this session's tooling.
17. **(New, 2026-08-27) Renumber PR #67's migration** from `015_analytical_scope_attestations` to `016_...` and rebase it onto current `main`. This requires pushing to PR #67's own branch (`fix/cor002-scope-attestation`), which is outside this session's designated branch — needs explicit authorization before acting. Confirmed cause of PR #67's `dirty` mergeable state: `main` already carries a different migration `015_import_checksum_and_permission_scope` (see "`main` vs. production gap — 2026-08-27" below).
18. **(New, 2026-08-27) Reconcile PR #69** against `main`: rebase it directly onto `main` (not the older `fix/request-line-visibility-picker-state` base) and review overlap with the request-queue-context/branding commits already merged to `main` (`f78aed7`, `54584ae`, `c696665`, `1db9630`).
19. **(New, 2026-08-27) Decide on PR #59**: GitHub reports it as `mergeable_state: clean` (technically mergeable). The blocker is a content decision — adopt task-scoped `CLAUDE.md` context loading or keep the current blanket reading-list requirement — not a merge conflict.
20. **Open (2026-09-01): double-click / duplicate-submission hardening — PR #108 open, not yet merged/deployed.** Audit (browser/API only, per operator instruction) found the `withIdempotency` middleware protecting `POST /api/requests`, `/api/subcontractor/deliveries`, `/api/subcontractor/consumption`, and `/api/receiving` was inert in production because no client page ever sent `idempotency_key`, and several plain (non-`UI.modal`) submit buttons had no click-lockout — most notably Create Material Request, which had neither protection. Server-side, every other workflow action was already found race-safe via `setHeaderStatus`'s optimistic-concurrency `UPDATE ... WHERE ... AND request_status=@from` guard plus explicit safe-replay/atomic-claim patterns on GI posting, picking completion, and reallocation. Fix: `Api.post()` now auto-attaches a UUID `idempotency_key`; a new `UI.withBusy()` helper disables the triggering button for the duration of the call, applied to every previously-ungated plain submit button (`createRequest.js`, `giPosting.js`, `erpOperator.js`, `reallocation.js`, `requestDetail.js`, `shipping.js`, `pickerAssign.js`). `node --check` passed on all 9 edited files. Committed as `0beafd0` on branch `fix/double-click-idempotency`, opened as **PR #108**. Rebased onto `main` (`8b4f06f`, which itself merged PR #107 after this branch was cut) to resolve a real conflict in `reallocation.js` — both PR #107's keyboard-accessibility addition to `[data-detail]` rows and this PR's `UI.withBusy` addition to `[data-approve]`/`[data-execute]` buttons are preserved in the merged file. See the 2026-09-01 session log entry for the full audit and merge-resolution detail. **Not yet merged or deployed** — next step is CI, review, merge, then deploy via the existing GitHub Actions release workflow.

## Production configuration invariants

```text
NODE_ENV=production
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
DB_PATH=/home/u716763642/domains/wms.kynox.io/nodejs/data/wms.db
```

## Commands forbidden in production

```bash
npm run seed
reset-admin
```

Do not delete, replace, truncate, or recreate the SQLite database or WAL files outside an approved and documented recovery procedure.

## KYNOX experience redesign execution — 2026-08-17

**Verified (repo):** A controlled successor branch, `feat/wms-experience-redesign-execution`, was created from the complete PR #68 → #69 stack at `f68c728`. This preserves the merged workflow-context and analytics-integrity work on `main` while extending the open request-line, picker-state, request-card, and role-focused navigation work without reconstructing it.

**Verified (repo):** The first redesign wave adds a presentation-only operational object header and exception treatment to the web Material Request detail surface. It uses the existing canonical workflow-stage indicator and does not change routes, permissions, APIs, workflow transitions, schema, inventory behavior, ERP behavior, audit controls, or production configuration.

**Verified (repo):** Local `npm test` passed all suites after rebuilding `better-sqlite3` for the available Node v22.13.0 runtime. `npm run test:smoke` passed 6/6 base smoke, 10/10 request-line visibility, and 11/11 design-foundation checks after installing the local Playwright Chromium runtime. `npm run lint` completed with 0 errors and the repository's existing warnings. The repository declares Node 20.x, so local runtime compatibility is a caveat; CI remains the authoritative merge gate.

**Production safety:** No production access, deployment, migration, import, reset/seed, Passenger restart, live database access, or PR merge occurred.

**Artifacts:** `docs/WMS-REDESIGN-BASELINE-2026-08-17.md`, `docs/WMS-REDESIGN-SCREEN-INVENTORY-2026-08-17.md`, `docs/WMS-REDESIGN-MARKET-BENCHMARK-2026-08-17.md`, and `docs/WMS-REDESIGN-ARCHITECTURE-2026-08-17.md` record the audit, benchmark, target IA, workflow architecture, role matrix, design decisions, and residual risks.

## `main` vs. production gap — 2026-08-27

**Verified (repo):** `main` head `26a5c30` is 20 commits ahead of the last deployed production SHA `8727133` (2026-08-17), with no divergence — `8727133` is a direct git ancestor of `main`. None of these 20 commits has been deployed or release-qualified. Contents, by area:

- **Backend/data-integrity** (`669f791`, `6bd4fd5`): import provenance and lifecycle-event fixes, and a fix for the `wms-api -> wms-ops-scripts -> wms-api` dependency cycle that was blocking KAAF regeneration. `669f791` adds migration `015_import_checksum_and_permission_scope` — **this is now the 15th recorded migration on `main`**, superseding migration 14 as the highest number.
- **CI**: `aa1d250` makes Playwright browser install resilient (timeout + retry).
- **Web frontend** (`c696665`, `1db9630`, plus asset-cache-busting/release-scoped-asset commits `0a71868`/`1a2512d`/`9d79a00`/`7318387`/`5ee1f5f`, and request-queue-context commits `f78aed7`/`54584ae`): KYNOX brand refresh (real logo, hero banners on Dashboard/Command Center), and inspector queue-context preservation. This overlaps in intent with the still-open, still-Draft PR #69 (built on the older `fix/request-line-visibility-picker-state` branch, not `main`) — the overlap has not been reconciled.
- **Flutter mobile** (`53403e2`, `a53c0e1`, `2fa4896`, `c817cac`, `26a5c30`): KYNOX teal theme, wordmark/app-title/drawer branding, real launcher icon, and a new native+Flutter animated splash screen. No new dependencies. **Not qualified** (`flutter analyze`/tests not run in this pass) and **no new APK has been built**, so none of this reaches existing mobile users regardless of any web/backend deployment.
- **Docs**: `b356d34` session-log entry for GitHub connector setup.

**Migration-numbering conflict — confirmed, not just suspected:** Draft PR #67 (`fix/cor002-scope-attestation`) independently adds its own migration named `015_analytical_scope_attestations`. Since `main` already carries a different `015_import_checksum_and_permission_scope`, PR #67's migration number collides with history already on `main`. This is the direct, confirmed cause of PR #67's GitHub-reported `dirty` (non-mergeable) state — not merely staleness. PR #67 must be renumbered to `016_...` and rebased onto current `main` before any merge decision.

**Not yet done in this pass (no production or database action taken):**
- CI status for `26a5c30` has not been independently confirmed from this session.
- Production has not been checked live (`/healthz`, active SHA, migration count) from this session.
- PR #67 has not been renumbered/rebased yet — that requires pushing to its own branch (`fix/cor002-scope-attestation`), which is outside this session's designated branch and needs separate authorization before acting.
