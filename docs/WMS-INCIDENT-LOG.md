# WMS Incident Log

This log records production failures, data-risk events, deployment failures, recoveries, and important near misses. Do not include secrets.

## INC-2026-07-31-01 — Hostinger native addon incompatible; recovery artifact not retained

**Status:** Resolved on 2026-08-01. All recovery gates passed; Passenger was restarted on the
verified native addon. See "Resolution — 2026-08-01" at the end of this entry for the closing
evidence. The narrative below is preserved unchanged as the historical record of how the
incident was diagnosed and worked through.

**Environment:** Hostinger shared Node.js / Passenger production environment.

**Impact:**

- **Reported (production):** the upstream `better-sqlite3 11.10.0` Linux addon
  requires GLIBC 2.29, while the shared host provides GLIBC 2.28; the shared
  host also lacks the compiler toolchain needed for an in-place rebuild.
- The application cannot rely on the upstream prebuild on that host.
- A compatible binary was built in GitHub Actions but was not retained for
  download, so native recovery cannot proceed through the reviewed path.

**Detection and evidence:**

- Draft PR #53, branch `agent/hostinger-glibc228-native-recovery`.
- Native workflow run #2 compiled `better-sqlite3 11.10.0` with GCC Toolset 12
  on Rocky Linux 8, then passed Node `v20.19.4`, ABI 115, GLIBC ceiling, module
  load, and in-memory SQLite query checks.
- The job failed only at `actions/upload-artifact` with
  `Failed to CreateArtifact: Artifact storage quota has been hit`.
- Main CI run #174 passed.
- No downloadable native-addon artifact was created by the failed run.

**Root cause / contributing factors:**

- Native binary compatibility differs between the upstream build environment
  and the Hostinger shared host's older glibc runtime.
- GitHub Actions artifact storage was already full, preventing retention of the
  successfully built compatibility artifact.
- The first PR #53 runbook revision did not fully bind the artifact to its
  source SHA and did not preserve/atomically swap the installed addon before
  host validation.

**Corrective work in Draft PR #53:**

- Check out and verify an explicit full source SHA.
- Emit `native-addon-manifest.json` with source, dependency, lockfile, Node/ABI,
  platform, compiler, GLIBC, and workflow-run provenance.
- Include the source SHA in the artifact name and upload binary, checksum,
  manifest, and GLIBC evidence together.
- Require deployed source identity, effective Passenger safeguards, production
  DB identity/counts, initialization-lock state, staged-addon host preflight,
  timestamped existing-addon preservation, atomic replacement, and an immediate
  validated rollback path before restart can be considered.

**Production and data impact of this correction session:** None. Production was
not accessed. No database, migration, seed, reset, initialization, Passenger
restart, artifact deletion, or PR merge action occurred.

**Open blocker — artifact quota:** Before requesting approval to delete any
artifact, create a read-only inventory containing artifact ID, exact name,
workflow name/path, run ID and attempt, branch/commit, creation and expiry time,
size in bytes, retention purpose, whether it is referenced by a release or
backup/restore procedure, and the reason it is safe or unsafe to delete. Report
the exact proposed deletion IDs and total bytes; do not delete from a wildcard,
age-only filter, workflow-wide action, or repository-wide bulk operation.

**Cleanup update — 2026-08-01:** The owner approved the exact 35-artifact
evidence-supported cleanup pool in
`docs/WMS-ACTIONS-ARTIFACT-INVENTORY-2026-08-01.md` (2,069,364,217 bytes).
Those exact IDs were deleted individually. Post-deletion API verification found
only the four protected artifacts—`8447368682`, `8447506723`, `8462156227`,
and `8576609631`—totaling 288,344,308 bytes. No workflow was rerun and no
native recovery artifact has yet been retained. The incident remains open
pending quota recalculation, an exact-SHA native workflow rerun, artifact
inspection, and all production recovery gates.

One explicitly authorized exact-SHA rerun was attempted after cleanup (run
`30667893534`, attempt 2). All build and validation gates passed, but artifact
upload still failed because quota accounting had not recalculated. No native
artifact was retained. Do not rerun again without separate authorization and
evidence that quota recalculation has completed.

After quota recalculation, one further explicitly authorized rerun (attempt 3)
completed successfully and retained artifact `8822465615` for exact SHA
`e57b278e04f8cf3ed3838a524bda3f0dbb25252f`. The artifact has not yet been
downloaded or independently inspected. The incident remains open pending that
inspection and every production recovery gate; Passenger restart remains
forbidden.

Artifact `8822465615` was subsequently downloaded and independently inspected
locally. The exact four-file set, binary and GLIBC-evidence checksums, source
SHA, dependency and normalized lockfile provenance, Node/ABI, ELF x86-64
identity, workflow attempt, and GLIBC 2.28 ceiling all passed. This does not
replace the mandatory Hostinger staged module-load preflight. The incident
remains open pending all production source/environment/database/lock gates,
staged preflight, reversible swap, and controlled Passenger restart.

**Owner / next step (historical — superseded by the resolution below):** Repository owner. For
the current PR head, require green CI/native checks and retain and independently inspect its
exact SHA-named artifact; keep the transient SHA, run, artifact ID, checksum, and expiry in the
PR description. Then separately authorize a production maintenance window and execute the
deployed-source, Passenger-environment, database identity/count, initialization-lock,
staged-addon preflight, backup, atomic-swap, and rollback gates before any restart. Keep
Passenger stopped until those gates are reviewed.

**Resolution — 2026-08-01 (Reported (production); independently corroborated 2026-08-04 for
the items marked below):**

PR #53 merged and the full `HOSTINGER-NATIVE-RECOVERY.md` gate sequence was executed against
production and passed:

- Deployed source `1bd15f12d70112a977983a96bae63e1b3c441310` matched the expected branch with a
  clean working tree.
- Passenger's effective environment (read from `/proc/$PID/environ`) confirmed all five
  required variables correct.
- Production database `PRAGMA integrity_check = ok`; record counts `9|11|35|9746|1|12|0|0`,
  matching the reviewed baseline.
- No initialization lock present.
- **Independently corroborated:** staged addon SHA-256
  `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` matches the artifact
  already independently inspected above (source SHA `e57b278e`/manifest-bound). It passed
  `ldd`, in-memory load/query, and a read-only backup query before installation.
- The previously installed addon and a database copy were preserved; the new addon was
  installed by same-directory atomic rename. Immediate rollback script retained at
  `/home/u716763642/domains/wms.kynox.io/nodejs/backups/emergency/production-recovery-20260801T202313Z/rollback-production.sh`.
- No seed, reset, initialization, or database-mutating command was run.
- **Independently corroborated:** Passenger is running the new addon;
  `https://wms.kynox.io/healthz` returns `200 {"status":"ok","service":"wms"}`.

**This incident is closed.** `DEC-013`'s native-addon provenance/rollback requirements were
followed in full. See `docs/WMS-SESSION-LOG.md` (2026-08-01 entry) for the complete execution
record and `docs/WMS-CURRENT-STATUS.md` for the current production baseline.

---

## INC-2026-07-25-01 — Production SQLite files deleted, then an empty database activated

**Status:** Resolved and validated on 2026-07-25. One preventive follow-up remains open (see "Open preventive follow-up").

**Environment:** Production — Hostinger managed Node.js / Passenger.

**Impact:**

- `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` were accidentally deleted.
- Production inventory and authentication data were at risk.
- A later active production database was structurally valid but functionally empty.
- Administrator login failed with `Invalid email or password` because the active `users` table contained zero rows — **not** because the password was wrong.

**Detection and evidence:**

- Initial recovery was taken from an open `/proc/<pid>/fd` descriptor, restoring availability.
- Dashboard later showed 9,746 materials, 1,245 empty bins, zero occupied bins, zero stock.
- Read-only inspection of the active production database then showed: users 0, roles 0, materials 0, warehouses 0.
- Read-only filesystem search found valid recovery databases with: users 9, roles 11, permissions 35, materials 9,746, warehouses 1, schema migrations 10.
- All candidate recovery databases passed `PRAGMA integrity_check`.

**Selected recovery source:**

`/home/u716763642/wms-final-live-copy-20260725-090240/wms.db`

- Size: 32,628,736 bytes
- SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`
- Integrity: `ok`

**Recovery actions:**

1. Created protected safety directory `/home/u716763642/wms-pre-auth-restore-20260725-112132`.
2. Created a SQLite backup of the empty active production database.
3. Copied the selected recovery source into the safety directory.
4. Verified both safety copies with integrity checks and SHA-256 checksums.
5. Identified and stopped only the WMS Passenger process.
6. **Moved** the active empty DB/WAL/SHM files into the safety directory; no files were destroyed.
7. Restored the selected database to `data/wms.db` with restrictive permissions.
8. Revalidated integrity and record counts.
9. Ran `npm run migrate` only — no seed, no account reset.
10. Confirmed `Migrations: up to date (12 recorded)` (source had 10 before restore).
11. Restarted Passenger via `tmp/restart.txt`.

**Validation:**

- Restored database checksum matched the selected recovery source.
- `PRAGMA integrity_check`: `ok`.
- Users 9, roles 11, materials 9,746, warehouses 1, schema migrations 12.
- `/healthz`: HTTP 200 with `{"status":"ok","service":"wms"}`.
- Operator confirmed successful administrator login using the existing account.

**Data-loss assessment:**

- The recovered state contains the confirmed users, roles, permissions, warehouse, and 9,746 material records.
- `batches` and `stock_transactions` were **zero in the validated recovery source**. Zero stock on the dashboard is therefore consistent with the restored data, and material-master count alone does not prove what operational stock existed at the recovery point.
- Opening-stock reconciliation was not applied during this incident.

**Root cause / contributing factors:**

- Production SQLite DB/WAL/SHM files were handled directly.
- Recovery copies and active database state were not clearly distinguished during the earlier restoration sequence.
- The project had no mandatory durable runbook or AI continuity record when the deletion occurred.
- Interactive SSH environment variables printed empty, creating operational ambiguity — see the open follow-up below.

**Corrective and preventive actions:**

- Added `CLAUDE.md` and durable project-memory documents.
- Explicitly prohibited direct deletion of SQLite DB/WAL/SHM files.
- Required read-only discovery before account resets or seeding.
- Required backup, checksum, integrity, process isolation, rollback, and post-restore validation for any database recovery (recorded as `DEC-009`).
- Retained the safety directory pending a reviewed retention decision.
- Continued prohibition of `npm run seed` and `reset-admin` in production.

**Preventive follow-up — auto-seed hazard (DEMONSTRATED 2026-07-27, fixed in code):**

The suspected mechanism was reproduced. Booting the real server against a migrated-but-userless database with `NODE_ENV` unset caused it to **seed demo data and a default administrator** with `must_change_password = 1`. The old guard was opt-out and keyed on `NODE_ENV`, so a runtime that does not export `NODE_ENV` — plausible under managed Node.js/Passenger, and consistent with what this project observed — fell through to the seed branch.

This is a credible mechanism for both this incident's empty database and the recurring default-admin symptom in Issue #40, requiring no one to have run `reset-admin`.

Fix (merged to `main`, **not yet deployed** at time of writing):

- Auto-seed is now **opt-in** via `ALLOW_AUTO_SEED=1`; absence of configuration means refuse. Safety no longer depends on a variable being present.
- `SKIP_AUTO_SEED=1` remains an overriding kill switch.
- The server logs a database identity line on every boot (`[db] path=… size=… users=… migrations=…`) so a mispointed `DB_PATH` or an unexpectedly empty file is visible immediately.
- Declining to seed emits a `[CRITICAL]` warning that names the data-loss possibility and forbids seeding or resetting accounts as a first response.
- `tests/e2e/autoseed_guard_test.py` pins the policy; it fails against the old guard and passes against the new one.

**Still open:** whether the auto-seed path actually executed in this production incident. Confirming or excluding it requires reading the Passenger **runtime** environment (not an interactive SSH shell) and is the remaining evidence needed to close Issue #40.

**Other open preventive follow-up:**

- Establish a tested restore drill and stronger database-file protection controls.

**Owner / next step:** project owner / production maintainer. Next safe step is read-only runtime-environment verification, before any restart or deployment.

---

## INC-2026-07-23-01 — Stale browser navigation JavaScript

**Status:** Resolved.

**Symptoms:**

- New navigation behavior was deployed but the browser continued using stale JavaScript.
- No useful console errors appeared.

**Resolution:**

- Versioned the navigation script URL in `public/index.html`:
  `navigation-v2.js?v=69c3de1a`
- Restarted the application.
- User confirmed the navigation worked.

**Lesson:**

- Static asset changes require cache-busting or a controlled asset versioning strategy.

---

## INC-2026-07-20-01 — Offsite backup upload rejected

**Status:** Resolved.

**Symptoms:**

- GitHub Actions offsite backup failed with `InvalidAccessKeyId` / malformed access-key configuration.

**Resolution:**

- Corrected Backblaze B2 S3-compatible credentials/configuration.
- Re-ran the workflow successfully.
- Confirmed production offsite backup summary and retention behavior.

**Lesson:**

- Validate credential format and endpoint configuration with a manual workflow run before relying on scheduled backups.

---

## INC-2026-07-14-01 — Node process port already in use

**Status:** Resolved historically.

**Symptoms:**

- Application start failed with `EADDRINUSE` on port 3000.

**Lesson:**

- Inspect the active process and hosting runtime before starting a second Node process manually under Passenger-managed hosting.

---

## Required format for future incidents

For every incident record:

- ID and title
- Date/time and environment
- Status
- User-visible and technical impact
- Detection
- Evidence
- Timeline
- Root cause or current hypothesis
- Recovery actions
- Validation
- Data-loss assessment
- Corrective/preventive actions
- Owner and next step
- Related PR, issue, commit, workflow run, or session-log entry
