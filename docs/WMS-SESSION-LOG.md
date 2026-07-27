# WMS Session Log

This is the chronological operational memory for the project. It records durable summaries of conversations and work, not secrets or necessarily verbatim transcripts.

## 2026-07-27 — Credential safety hardening (remaining code asks in Issue #40)

**Objective:** Close the remaining code-hardening items in Issue #40 — `reset-admin` safety, credential audit logging, and force-change semantics. Repository-side only; no production access, no production command.

**Starting state:** `main` at `152a32f`, clean tree, CI green, no open PRs.

**Defects found while reading the credential paths (all real, all fixed here):**

1. **Administrator password reset did not set `must_change_password`.** An administrator knows the interim password, so the account was not solely the user's — yet nothing forced a change. The flag was only ever set by `reset-admin` and the seed.
2. **No credential change was audited.** Neither the administrator reset nor the self-service change wrote an audit record, so "who changed this credential, and when" was unanswerable — exactly the question Issue #40 exists to answer.
3. **`reset-admin` defaulted to publicly known credentials.** A bare `npm run reset-admin` installed `admin@example.com` / `Admin@123456` with no production guard and no confirmation. Run during a deploy or by reflex, this alone reproduces the reported symptom.
4. **`reset-admin` could seed.** When the roles table was empty it ran the **full demo seed** — so a command named "reset-admin" could write a demo dataset into an empty production database. This is a second, independent path to the same class of incident as `INC-2026-07-25-01`.

Item 4 is worth emphasising: it was reachable exactly when the database looked empty, which is the state the 2026-07-25 incident left production in.

**Changes:**

| File | Change |
| --- | --- |
| `scripts/reset-admin.js` | Production requires explicit email, explicit password, and the exact phrase `RESET ADMIN PASSWORD`. Built-in defaults refused. Never seeds — an empty roles table now refuses and points at read-only diagnosis. Writes an audit record. |
| `server/routes/users.js` | Administrator reset sets `must_change_password = 1` and is audited. |
| `server/routes/auth.js` | Self-service change is audited; it remains the only path that clears the flag. |
| `tests/e2e/password_test.py` | Extended from 10 to 25 checks: credential lifecycle, audit presence, secret-leak assertions, and the `reset-admin` refusal matrix. |

**Evidence:**

- `password_test.py`: **25 passed, 0 failed**.
- Full suite (`npm test`): **ALL TEST SUITES PASSED**.
- ESLint: no new problems (one pre-existing unused-import warning in `users.js`, untouched).
- Audit records are asserted **not** to contain the passwords used in the test, nor any bcrypt hash prefix.

**Decisions:** `DEC-012` — credential lifecycle and audit rules.

**Important scope note:** `reset-admin` remains **forbidden in production** by `CLAUDE.md`. This hardening is defence in depth for when that rule is broken; it is not permission to run it.

**Production state:** unchanged. Production changed: no. Database changed: no.

**Remaining work on Issue #40:**

- The cross-table stock consistency audit (batches vs `material_location_stock` vs `stock_transactions` vs dashboard KPIs) is **not** done and needs real data plus production access.
- Confirming whether the auto-seed path actually fired in production still needs the Passenger runtime read-out.

**Exact next step:** deploy `main` to production so both safety fixes are live, then read the `[db] …` identity line from the boot log.

---

## 2026-07-27 — Auto-seed hazard reproduced and fixed (P0 code hardening)

**Objective:** Close the auto-seed hazard identified in the Phase 1 review before any deployment or restart of production. Repository-side only; no production access and no production command.

**Starting state:** `main` at `690302d`, clean tree, CI green. The hazard was recorded as a code-verified hypothesis.

**What was proven:**

The mechanism was reproduced, so it is no longer a hypothesis. Booting the real server against a migrated-but-userless database with `NODE_ENV` unset caused it to **seed demo data and a default administrator** with `must_change_password = 1`.

Method: the new suite was run against the **previous** `server/index.js`, where it failed exactly two end-to-end cases — "does NOT seed with no opt-in" and "does NOT seed when `NODE_ENV=development`" — and passed 19/19 against the new implementation. The test therefore catches the real defect rather than restating the new code.

**Root cause:** the guard was opt-out and keyed on `NODE_ENV`, so it failed **open**. Safety depended on a variable being *present*. Any runtime that does not export `NODE_ENV` — plausible under managed Node.js/Passenger — reached the seed branch.

**Changes:**

| File | Change |
| --- | --- |
| `server/services/firstRunSeed.js` | New. Pure, testable policy: auto-seed requires explicit `ALLOW_AUTO_SEED=1`; `SKIP_AUTO_SEED=1` overrides it. Absence of configuration means refuse. Carries the operator warning text. |
| `server/index.js` | Uses the policy instead of the inline `NODE_ENV` guard. Adds a per-boot database identity line (`[db] path=… size=… users=… migrations=…`), an explicit ask in Issue #40. |
| `tests/e2e/autoseed_guard_test.py` | New. Policy truth table plus end-to-end boots against throwaway databases on isolated ports. |
| `tests/run.sh` | Suite wired into Phase 1. |
| `DEPLOY-HOSTINGER.md` | First-run bootstrap documented as opt-in, with the reason. |

**Evidence:**

- New suite standalone: **19 passed, 0 failed**.
- Same suite against the old guard: **17 passed, 2 failed** (the two end-to-end cases).
- Full suite (`npm test`): **ALL TEST SUITES PASSED**.
- ESLint on changed files: clean.

**Compatibility:** nothing depended on the implicit path — the devcontainer runs `npm run setup`, `docker-compose` documents `npm run seed`, and CI seeds explicitly. A genuine first install now starts once with `ALLOW_AUTO_SEED=1` or runs `npm run seed`.

**Decisions:** `DEC-011` — destructive-by-omission operations must be opt-in and fail closed; safety may not depend on a variable being present to trigger a guard; such guards require a test that fails against the unsafe version.

**Production state:** unchanged. Production changed: no. Database changed: no. **Production still runs the old fail-open guard until this is deployed.**

**Remaining work:**

- Read the Passenger **runtime** environment. This is now needed as *evidence for Issue #40* — whether the auto-seed path actually fired in production — rather than as a safety gate, since the deployed fix makes an unset environment fail safe.
- Verify production's deployed commit and reconcile it to `main`.
- Issue #40 also asks for `reset-admin` hardening (refuse default credentials in production, require typed confirmation) and audit-logging of password resets. Not done in this session.

**Exact next step:** operator returns the read-only production output (commit, branch, `.env` values, database path, lock location, Passenger runtime environment). Phase 2 deployment planning follows from it.

---

## 2026-07-27 — Phase 1: unified source of truth, and correction of a stale status claim

**Objective:** Establish one agreed source of truth across GitHub, production documentation, and AI context before any further production work. Read-only; no production command was run.

**Starting state:**

- `main` at `b9ec782` (verified). Working tree clean.
- PR #42 open and stale; PR #43 and #44 merged; Issues #37 and #40 open.

**Verified (repo) evidence:**

| Fact | Value | Method |
| --- | --- | --- |
| `origin/main` | `b9ec782dddfd3e57dbb3448f9906b340427bb2f4` | `git rev-parse origin/main` |
| Migrations in code | 12, latest `012_opening_stock_batch_registry` | `server/db/migrations.js` |
| PR #43 fix present on `main` | yes (`server/routes/import.js`) | source inspection |
| Temporary debug endpoint | absent | repository search |
| E2E inventory | 21 suites, 397 assertions | `tests/run.sh`, `tests/e2e/*.py` |
| CI on `main` | run #155 on `b9ec782`, success | Actions API |
| Latest offsite backup | run #11, `2026-07-27T06:03:54Z`, success | Actions API |
| Backup history | 8 consecutive successes (#4–#11); #2 failed 2026-07-20, fixed by #3 | Actions API |

**Could NOT be verified — no production access:**

The working environment has no SSH client and no credentials (`command -v ssh` returns nothing; `~/.ssh` is empty). Production commit, database path and identity, live migration count, administrator-login state, and production-initialization lock state therefore remain **Unverified** and were explicitly reported as such rather than assumed.

**Conflicts found and resolved in this entry:**

1. **Administrator authentication (material).** `main` stated login was an open blocking issue. Open PR #42 carried better, newer evidence: the failure was caused by the active production database being empty (`users = 0`), was resolved by a validated restore, and the operator confirmed a successful login. `main` was stale.
2. Issue #40 states the database default is `server/data/wms.db`. Code on `main` resolves an unset `DB_PATH` to `<app>/data/wms.db`, matching the `CLAUDE.md` invariant. The issue text is inaccurate for current code.
3. Zero dashboard stock was recorded without context. The validated recovery source itself contained zero batches and zero stock transactions, so zero stock is consistent rather than evidence of further loss.
4. Production is three merges behind `main` and is not known to contain the PR #43 idempotency fix.
5. Runtime environment variables reported empty in an interactive SSH shell during the recovery session; unresolved (see the new finding below).

**New finding — auto-seed hazard (hypothesis, code-verified, production-unverified):**

Tracing `server/index.js` against `server/config.js`: if `SKIP_AUTO_SEED` is not `1`, the database has zero users, and `NODE_ENV` is not exactly `production`, the production guard does not trigger and the application calls `seed()`, creating demo data and a default administrator with `must_change_password = 1`. This is a single mechanism consistent with **both** symptoms in Issue #40 — an unexpectedly empty database and a recurring default administrator — without anyone invoking `reset-admin`. Recorded in `WMS-CURRENT-STATUS.md` and `INC-2026-07-25-01`; must be confirmed or excluded against the Passenger runtime before any restart or deployment.

**Correction of a prior entry in this log:**

The 2026-07-27 PR #43 entry below states that administrator login was "still open". Per conflict 1 that claim was **stale when written**; it was inherited from `main` without reconciling against open PR #42. The authentication issue was resolved on 2026-07-25. `DEC-010` was added to prevent recurrence.

**Actions:** Closed PR #42 as superseded (stale base, conflicting, unmergeable) and replaced it with a single reconciliation PR opened from current `main` carrying its evidence plus the corrections above.

**Production state:** Unchanged. Production changed: no. Database changed: no.

**Exact next step:** Operator performs read-only verification of the production commit, branch, `.env` values, database path, initialization-lock location, and — decisively — the environment as the **Passenger process** sees it. No restart or deployment until the auto-seed question is settled.

---

## 2026-07-27 — PR #43 review, CI-quota fix, and merge (opening-stock idempotency)

> **Correction (2026-07-27, later session):** the "Remaining work / open advisory" note below repeats a stale claim that administrator login was still failing. That was resolved on 2026-07-25; see the entry above and `INC-2026-07-25-01`. The rest of this entry stands.

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
