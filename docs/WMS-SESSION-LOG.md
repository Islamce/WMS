# WMS Session Log

This is the chronological operational memory for the project. It records durable summaries of conversations and work, not secrets or necessarily verbatim transcripts.

## 2026-07-27 — PR #43 review, CI-quota fix, and merge (opening-stock idempotency)

**Objective:** Review, verify, and merge PR #43 (`hotfix/opening-stock-idempotency` → `main`), submitted by another agent, which stops opening-stock CSV imports from silently increasing on-hand quantity when the same material/batch/warehouse is re-imported.

**Starting state:**

- PR #43 open, head `884432e`, `test` CI check red.
- `main` at merge commit `5852fdd` (PR #41 project-memory/runbook).

**Conversation/request summary:**

- User forwarded another agent's report on PR #43 and asked to apply + push its proposed test change to the hotfix branch, then said "the project is yours now" (standing authorization to drive PR #43 to completion without further per-step confirmation, on that branch only).
- A later self check-in instructed: re-check CI; merge with a head-SHA guard if green; if red, diagnose, fix, push; record a session-log entry; flag the production-branch reconciliation advisory; never touch production.

**Files/code inspected:**

- `server/routes/import.js` — new batch-lookup logic: existing opening-stock batch in the same bin → `skipped`; existing batch in a different bin, or an existing non-opening-stock batch → error; otherwise → `created`. The old additive quantity-update path was removed.
- `server/db/migrations.js` migration `012_opening_stock_batch_registry` — trigger `register_opening_stock_transaction` auto-registers opening-stock batches on insert, which is why re-import correctly returns `skipped` rather than erroring.
- `tests/e2e/import_test.py` — replaced an additive-behavior assertion with an idempotency assertion block (repeated opening-stock import is skipped; batch quantity, bin balance, and transaction count are all unchanged).

**Commands/actions:**

- Ran `tests/e2e/import_test.py` locally against the hotfix branch: 42/42 passed, confirming skip behavior, preserved quantities, and no new transaction empirically (not just by code inspection).
- Fetched PR #43 CI job log (`get_job_logs`, job `89793977690`): log showed `✅ ALL TEST SUITES PASSED` (all suites, including `uat2_test.py` 15/15) — the failing step was the trailing `actions/upload-artifact@v4` diagnostic-log upload: `Failed to CreateArtifact: Artifact storage quota has been hit.` This was a GitHub Actions infrastructure condition, not a test or code defect.
- Fixed `.github/workflows/ci.yml`: marked the best-effort diagnostic-log upload step `continue-on-error: true` so an exhausted artifact quota can never fail the `test` job again. Committed (`4d02641`) and pushed to `hotfix/opening-stock-idempotency`.
- Re-checked CI on `4d02641`: `test` check `success`.
- Confirmed PR #43 head was still `4d02641` (guard satisfied) and `mergeable_state: clean`.
- Merged PR #43 via `merge` method.

**Evidence/results:**

- Merge commit: `a0377b80df85f7702cd7ee8c3372b9841948b56d`.
- New `main` head: `a0377b8` (parents `5852fdd` and `4d02641`).
- `main` now contains, in order: `235689d` (idempotency fix), `884432e` (idempotency regression test), `4d02641` (CI artifact-quota reliability fix).

**Decisions:**

- Did not merge while CI was red; did not fabricate a green result. Diagnosed the true cause (infra quota, not a test failure) before acting, per `CLAUDE.md`'s fact/hypothesis discipline.
- Scope of the CI fix was kept to the single failing step (`continue-on-error` on a best-effort upload) rather than broadening into unrelated workflow changes.

**Risks/incidents:** None. No production system or data was touched — all actions were against the GitHub repository (branch, PR, CI) only.

**Files/PRs/commits changed:** `.github/workflows/ci.yml` (commit `4d02641`); PR #43 merged (`a0377b8`).

**Production state:** Unchanged and not inspected in this session. Production remains at the previously confirmed deployed commit `579b5091cf99ea3c4dfa3f5531202eab546b3a88` (see `WMS-CURRENT-STATUS.md`), which predates PR #39 opening-stock reconciliation work reaching final merge state and now also predates this PR #43 merge.

**Remaining work / open advisory:**

- **Production branch reconciliation advisory (OPEN):** an earlier report indicated production may have been operated against an isolated copy of the database on the `hotfix/opening-stock-idempotency` branch for verification purposes. Production's actual deployed application code must be reconciled to the current `main` head (`a0377b8`) through the normal reviewed deployment process — do not assume production already reflects this merge, and do not deploy without following `WMS-PRODUCTION-RUNBOOK.md`.
- The standing blocker from `WMS-INCIDENT-LOG.md` (administrator login failing after the 2026-07-25 DB recovery) is still open and unrelated to this work; it still requires read-only investigation before any account mutation.
- Opening-stock date reconciliation (from PR #39) is still not applied in production and still requires a reviewed dry run first.

**Exact next step:** Deploy PR #43's merged code to production through the documented runbook process (migrate → restart → health check), only after confirming with the user/operator which commit production is actually running, and only after the administrator-login incident is resolved or explicitly deprioritized relative to this deployment.

---

## 2026-07-25 — Project memory system and authentication follow-up

**Objective:**

Prevent repeated loss of context between AI sessions and continue production recovery safely.

**Confirmed starting state:**

- Production commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- Node: `v20.19.4`
- npm: `10.8.2`
- Migrations: 12 recorded, up to date
- Health endpoint: healthy
- Administrator login: failing with `Invalid email or password`
- Opening-stock reconciliation: not applied

**Actions:**

- User requested a durable reference shared by Claude and ChatGPT.
- Added mandatory AI operating instructions and project-memory documents on branch `docs/project-memory-and-runbook`.
- Recorded production safeguards, incidents, decisions, current status, and future documentation protocol.

**Next operational step:**

- Inspect the production users table schema and non-secret account fields read-only.
- Do not seed, reset accounts, or modify the database until the evidence is reviewed.

---

## 2026-07-25 — PR #39 deployment

**Objective:** Deploy FIFO-safe historical opening-stock date support.

**Evidence:**

- PR #39 merged.
- CI Run #145 succeeded.
- Merge/deployed commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- `npm run migrate` result: `Migrations: up to date (12 recorded).`
- Health response: `{"status":"ok","service":"wms"}`

**Result:** Deployment technically healthy. Reconciliation not applied. Login failure discovered afterward.

---

## 2026-07-25 — Production database recovery

**Objective:** Recover production after accidental deletion of SQLite database files.

**Actions and evidence:**

- Recovered database from an open `/proc/<pid>/fd` descriptor.
- Validation copy: `/home/u716763642/wms-recovery-validation-20260725-085901/wms.db`
- Integrity and quick checks passed.
- Restored to the production path and restarted Passenger.
- Health check passed.
- Dashboard showed 9,746 materials, 1,245 empty bins, zero occupied bins, and zero stock.

**Result:** Application and database recovered; authentication follow-up remains open.

---

## 2026-07-23 to 2026-07-24 — Workflow, reallocation, import, and cache work

**Highlights:**

- PR #33 delivered workflow replay/recovery hardening, mobile approval parity, batch/QR traceability, migration 009, governed stock reallocation, segregation of duties, audit, notifications, replay safety, and stock/freeze revalidation.
- Production navigation initially appeared unchanged because of a stale browser asset.
- Added cache-busting query parameter to `navigation-v2.js`; user confirmed the fix worked.
- New requirements captured around durable test/real data, issue-transaction uploads, analytics inputs, and a controlled Start Fresh capability.
- Opening-stock import and historical FIFO concerns led to the later PR #39 work.

---

## 2026-07-20 — Notifications and offsite backup

**Highlights:**

- PR #25 notification/mobile UAT work merged.
- Firebase service account path configured with restrictive permissions.
- Android device token present for the system administrator.
- PR #26 added offsite backup automation.
- Initial Backblaze upload failed because of malformed access-key configuration.
- Credentials were corrected and a manually triggered production offsite backup completed successfully.
- Local retention decision: keep newest seven backup sets.

---

## 2026-07-18 and earlier — Deployment foundation

**Highlights:**

- Hostinger production established under Passenger with `app.js` leading to `server/index.js`.
- `/healthz` used for availability checks.
- Node 20 selected for compatibility with native dependencies.
- Git remote switched to SSH and authenticated successfully.
- APK build and checksum workflows established.
- Migration and deployment sequence standardized around fast-forward pull, dependency install, migrate, Passenger restart, and health validation.

---

## Future entry template

```markdown
## YYYY-MM-DD — Session title

**Objective:**
**Starting state:**
**Conversation/request summary:**
**Files/code inspected:**
**Commands/actions:**
**Evidence/results:**
**Decisions:**
**Risks/incidents:**
**Files/PRs/commits changed:**
**Production state:**
**Remaining work:**
**Exact next step:**
```

Every future AI or human session that changes understanding, code, data, configuration, deployment, or plans must append an entry before completion.
