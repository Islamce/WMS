# WMS Incident Log

This log records production failures, data-risk events, deployment failures, recoveries, and important near misses. Do not include secrets.

## INC-2026-08-06-01 — Production offsite backup workflow failing (10+ consecutive days, SSH auth now rejected)

**Status:** Root cause fixed for both the SSH authentication failures and a second,
independent bug the SSH fix uncovered, as of 2026-08-11 — see "Resolution — 2026-08-11" at the
end of this entry. **Not yet closed:** the `REMOTE_APP_DIR` workflow fix has not yet been
validated by a full green run. The diagnosis below is preserved unchanged as the historical
record of how the incident was worked through.

**Escalation (2026-08-10):** A third, more serious error signature appeared today —
`Permission denied (publickey,password)`. Until now every failure was either a connectivity
problem (timeout) or a post-authentication shell-configuration problem (`/sbin/nologin`); in
both of those, SSH itself was able to authenticate when it connected. Today's run shows the
SSH key being **rejected outright**, meaning either the key was removed/rotated on the
Hostinger host, the backup account was disabled, or the `SSH_KEY` GitHub secret no longer
matches what the host will accept. This is a more serious condition than the prior two
signatures and narrows the owner's investigation.

**Correction (2026-08-09, preserved for history):** The original 2026-08-06 version of this
entry described the failures as two clean, sequential phases (`/sbin/nologin` through
2026-08-04, then connection timeouts from 2026-08-05 onward). Re-inspection of every run's log
on 2026-08-09 showed that framing was wrong: the two error signatures alternated
intermittently rather than succeeding one another in a clean phase transition. The per-run
table below carries that correction forward and adds the new 2026-08-10 finding.

**Environment:** GitHub Actions (`production-backup.yml`), SSH connection from the Actions
runner to the Hostinger production host (aliased `hostinger` in the workflow's SSH config).
The SSH key used here (`SSH_KEY` GitHub Actions secret) is unrelated to any credential used to
push code to this repository from any AI session — code pushes go over HTTPS with a GitHub
token, not this SSH key.

**Impact:**

- **Verified (repo, via GitHub Actions run history):** the scheduled `Production Offsite
  Backup` workflow has failed on every run for 10 consecutive days, 2026-08-01 through
  2026-08-10 (runs #16–#25). The most recent successful run was #15 on 2026-07-31.
- No offsite backup has been produced since 2026-07-31. Per `DEC-008`, local backup retention
  keeps only the newest 7 sets, so each further missed cycle erodes the disaster-recovery
  safety margin; at 10 missed daily cycles this now well exceeds the local retention window —
  local backup depth is likely already thinner than the missed-cycle count.
- No evidence of data loss, corruption, or any change to `data/wms.db`. This is a backup
  **delivery** failure, not a database incident.

**Detection and evidence:**

- Reported via a GitHub Actions failure-notification email: "[Islamce/WMS] Production
  Offsite Backup workflow run" / "Production Offsite Backup: All jobs have failed."
- **Verified (repo)**, from `mcp__github__get_job_logs` on every one of the 10 failed runs,
  three distinct error signatures now recur:

  | Run | Date | Error |
  |---|---|---|
  | #16 | 2026-08-01 | `/sbin/nologin: No such file or directory` |
  | #17 | 2026-08-02 | `ssh: connect to host *** port ***: Connection timed out` |
  | #18 | 2026-08-03 | `/sbin/nologin: No such file or directory` |
  | #19 | 2026-08-04 | `/sbin/nologin: No such file or directory` |
  | #20 | 2026-08-05 | `ssh: connect to host *** port ***: Connection timed out` |
  | #21 | 2026-08-06 | `ssh: connect to host *** port ***: Connection timed out` |
  | #22 | 2026-08-07 | `/sbin/nologin: No such file or directory` |
  | #23 | 2026-08-08 | `/sbin/nologin: No such file or directory` |
  | #24 | 2026-08-09 | `/sbin/nologin: No such file or directory` |
  | #25 | 2026-08-10 | `Permission denied (publickey,password)` |

  - `/sbin/nologin: No such file or directory` (6 of 10 runs): SSH connects and authenticates,
    but the remote login shell path configured for the backup account is invalid. The
    dominant signature through 2026-08-09.
  - `ssh: connect to host *** port ***: Connection timed out` (3 of 10 runs, on 08-02, 08-05,
    08-06): a TCP-level failure — the connection never reaches the host, so no authentication
    is attempted. Appeared intermittently, not as a lasting state change.
  - `Permission denied (publickey,password)` (1 of 10 runs, 08-10, most recent): the SSH
    connection reaches the host, but the offered key is rejected during authentication itself
    — a step earlier in the process than either prior signature, since the two previous
    signatures both required successful authentication to occur.
- **Verified (repo, via `git log --oneline -- .github/workflows/production-backup.yml`):**
  the workflow file's last change is commit `86363c5` ("Security hardening of the
  offsite-backup workflow and scripts"), well before this failure window. The workflow
  definition itself is not the cause of any of the three error signatures.

**Root cause / current hypothesis:**

- The `/sbin/nologin` signature (the majority pattern through 08-09) is consistent with a
  persistent account/shell-configuration problem on the Hostinger host for the specific SSH
  account the backup workflow authenticates as.
- The connection-timeout signature (intermittent, 3 of 10 runs) is consistent with transient
  network conditions, host load, or an intermittent firewall rule.
- **The 2026-08-10 permission-denied signature is the most actionable new lead.** Because
  authentication itself now fails, where it previously always succeeded when the connection
  reached the host, the most likely explanations are: (a) the backup SSH key was removed or
  rotated out of the account's `authorized_keys` on the Hostinger host — possibly as part of
  the same account/shell remediation the owner may have already started in response to this
  incident; (b) the backup account itself was disabled; or (c) the `SSH_KEY` GitHub secret has
  gone stale relative to what the host will accept. This is not yet confirmed as any one of
  these — it is the narrowed set of plausible causes for the owner to check directly.
- **Unverified hypothesis, explicitly not asserted as fact:** the onset of the `/sbin/nologin`
  signature on 2026-08-01 coincides with the date of the Hostinger native-addon recovery work
  recorded in the "Resolution — 2026-08-01" section of `INC-2026-07-31-01` (host-level access,
  Passenger restart, and associated hPanel/SSH activity on the same production host). No
  mechanism has been identified or confirmed connecting that recovery work to the backup
  account's shell configuration or to today's key rejection; this remains a candidate lead for
  the owner to check, not a conclusion.

**Recovery actions:** None taken. This entry is diagnostic only, per production-safety rules
— no SSH, credential, or host-configuration change was made from this session (no production
SSH access exists in this environment).

**Validation:** Not applicable — no corrective action has been taken yet.

**Data-loss assessment:** None identified. No evidence this affects `data/wms.db` or any live
production data; it affects only the offsite copy's freshness.

**Corrective/preventive actions (proposed, not yet performed):**

- Owner to check, via Hostinger hPanel, whether the backup SSH account's public key is still
  present in `authorized_keys` and whether the account is enabled — this is now the most
  direct lead given the 2026-08-10 permission-denied result.
- If the key was intentionally rotated or removed, generate a new key pair, install the public
  key on the host, and update the `SSH_KEY` GitHub Actions secret to match.
- Separately, still check the backup account's configured login shell (the `/sbin/nologin`
  cause) once authentication is restored, since that was the dominant failure before today.
- Once fixed, trigger a manual workflow run to confirm a successful backup before relying on
  the next scheduled run.
- Consider whether `DEC-008`'s 7-set local retention window needs a temporary extension while
  offsite backups are down — 10 missed cycles already well exceeds that window.

**Owner / next step:** Open. Owner (repository owner, with Hostinger hPanel and GitHub secrets
access) to verify the backup SSH key/account state on the host first (2026-08-10 finding),
then the login shell, then update the `SSH_KEY` secret if needed, then re-run the workflow
manually to confirm recovery. No AI agent in this environment has production SSH access or
GitHub secrets access to perform any of this directly.

**Related:** GitHub Actions workflow `production-backup.yml`, runs #16–#25 (run #16 id
`30686266957`, run #17 id `30734539240`, run #18 id `30788579089`, run #19 id `30880841578`,
run #20 id `30978213492`, run #21 id `31074388681`, run #22 id `31147905259`, run #23 id
`31238049884`, run #24 id `31293504581`, run #25 id `31354732571`); `DEC-008` (backup
retention policy); "Resolution — 2026-08-01" section of `INC-2026-07-31-01` below (candidate
correlated event, unconfirmed).

**Resolution — 2026-08-11 (Reported by the operator, who had direct Hostinger hPanel/SSH
access; this session had none and directed the diagnosis and fixes remotely):**

Two independent problems were found and fixed, in sequence — fixing the first uncovered the
second.

1. **SSH authentication (the original `Permission denied` cause).** The operator confirmed via
   hPanel that the account's `authorized_keys` and directory permissions were already correct
   (`~/.ssh` `700`, `authorized_keys` `600`); an early regenerated key turned out to have been
   saved as an empty file (0 meaningful bytes) and was discarded. A clean key pair
   (`wms-gha-backup-final-2026-08-11`, ED25519, confirmed 432 bytes) was generated, its public
   half added both directly to `authorized_keys` and through hPanel's own SSH-key-management UI
   (hPanel appears to manage this list independently of direct file edits), and a manual
   external `ssh -vvv` test from the operator's own session confirmed
   `Authentication succeeded (publickey)` against host `185.97.145.102:65002` as user
   `u716763642` — independently proving the key, host, port, and username were all correct
   before touching GitHub. The corresponding private key was then set as the
   `HOSTINGER_SSH_PRIVATE_KEY` GitHub Actions secret.
2. **Host-key verification (`Host key verification failed`, surfaced only once the key problem
   above was fixed).** The `HOSTINGER_KNOWN_HOSTS` secret was stale relative to the host's
   current key set. Refreshed via `ssh-keyscan -p 65002 185.97.145.102`; the resulting
   `ecdsa-sha2-nistp256` line's fingerprint (`SHA256:rFk+GudhBB0JkP03NibGoh+hCfSIVdc1SidDLeA9BXI`)
   was independently cross-checked against the fingerprint shown during the operator's own
   manual login moments earlier — an exact match, not blind trust-on-first-use. All three host
   key lines (`ssh-rsa`, `ecdsa-sha2-nistp256`, `ssh-ed25519`) from the scan were set as the new
   `HOSTINGER_KNOWN_HOSTS` secret value.
3. **A second, independent bug, surfaced only once 1–2 were fixed:** the backup step then
   failed with `Backup failed: /lib64/libm.so.6: version 'GLIBC_2.29' not found`, the same
   error signature as `INC-2026-07-31-01`. Read-only checksum comparison
   (`sha256sum` on `better_sqlite3.node`) showed the workflow's `REMOTE_APP_DIR`
   (`~/domains/wms.kynox.io/nodejs`, the legacy persistent path) still holds the old,
   GLIBC-2.29-requiring addon (`e8f767df39a9a934b3705d0fffc401a12932bf94d650aae2d27733311f7ff842`),
   while the actual live release Passenger serves —
   `~/domains/wms.kynox.io/.builds/current` → `.builds/versions/manual-20260801T202313Z-1bd15f12`
   — has the correct, GLIBC-2.28-compatible addon
   (`a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4`, matching the known-good
   checksum from the Aug 1 recovery exactly). **This confirms production itself never
   regressed** — `DEC-013`'s warning not to infer deployed identity from the persistent
   `nodejs/` directory applies exactly here. The bug was purely that
   `production-backup.yml`'s `REMOTE_APP_DIR` predated the Aug 1 release-based layout and was
   never updated. Fixed in a follow-up PR by pointing `REMOTE_APP_DIR` at
   `~/domains/wms.kynox.io/.builds/current/nodejs` (the symlink, so it stays correct across
   future deploys) instead of the legacy path.

**Evidence-class note:** all hPanel/SSH/checksum evidence above is **Reported by the
operator** (per `DEC-010`) — this session had no Hostinger or production access and directed
the diagnosis via chat, verifying only the public, non-sensitive artifacts the operator chose
to share (host key fingerprints, checksums, public key fingerprints) and the GitHub Actions
run logs directly.

**Security note:** during troubleshooting, the operator inadvertently pasted the full private
key content for `wms-gha-backup-final-2026-08-11` into this chat session. That key is treated
as exposed and scheduled for rotation as a follow-up hygiene action (generate a fresh key,
install only the public half via hPanel and `authorized_keys`, update the GitHub secret
directly without the private key passing through chat again, then remove the exposed key from
`authorized_keys`/hPanel). This does not affect the resolution above, since the exposed key
still requires host access held only by the operator, but should not be left unrotated
indefinitely.

**Validation:** GitHub Actions run #36 (`31532235669`) progressed through SSH authentication
and host-key verification successfully — both original blockers are confirmed fixed. The
`REMOTE_APP_DIR` fix has not yet been validated by a full green run; that is the immediate
next step once the workflow-file fix is merged.

**This incident remains open, narrowed to one remaining step:** merge the `REMOTE_APP_DIR` fix
and confirm a fully successful (`conclusion: success`) run before closing.

---

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
