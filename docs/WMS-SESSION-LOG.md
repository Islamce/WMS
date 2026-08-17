# WMS Session Log

This is the chronological operational memory for the project. It records durable summaries of conversations and work, not secrets or necessarily verbatim transcripts.

## 2026-08-11 — Preserve-first corrective reconciliation

**Starting state:** The uncommitted 2026-08-03 corrective implementation was
still present at `065736c` on `fix/workflow-context-analytics-integrity` with 28
modified tracked files and two substantive untracked files. Disposable package
and Python caches were not part of the work. Remote main was verified at
`3350d2b`; Draft PR #59 remained clean/green and touched only `CLAUDE.md`.

**Preservation and reconciliation:** The complete substantive state was
checkpointed at `a97f07f` on
`recovery/workflow-context-analytics-20260803`. A separate worktree and branch,
`fix/workflow-context-analytics-integrity-v2`, were created from current main.
Newer backup/native-recovery records were retained while the corrective patch
was reconciled.

**Integrity refinement:** Sparse operator-declared ranges no longer establish
global movement completeness; only ISSUE evidence contributes imported coverage
and only continuous operational-ledger evidence can enable global `DEAD`
classification. Import periods are validated and contain their rows; future
posting dates and document dates after posting are rejected; continuation
chunks cannot change provenance/configuration. Dedupe now uses additional cost,
actor, unit, description, and filename discriminators, and cross-ledger matching
requires exact references rather than substrings.

**Validation:** Changed JavaScript files passed `node --check` with bundled Node
v24.14.0; changed Python tests passed compilation; `git diff --check` passed.
Runtime/e2e execution remains pending because this clean worktree has no
installed dependencies and the bundled runtime exposes no npm executable.

**Production state:** Unchanged. No deployment, migration, import, database
mutation, Passenger restart, PR merge, or production credential operation was
performed.

## 2026-08-11 (cont'd) — INC-2026-08-06-01 closed: offsite backup fully restored

**Objective:** Close out `INC-2026-08-06-01` after merging the fifth and final fix
(PR #65, retention-directory error handling).

**Starting state:** PR #65 merged. Triggered `production-backup.yml` directly via the GitHub
API for the final validation run.

**Actions:** Run #39 completed with `conclusion: success` across all 15 job steps, including
"Prune old LOCAL sets" — the first fully clean end-to-end run since 2026-07-31 (11 days of
failures, 5 distinct bugs found and fixed in one continuous working session with the
operator). Updated `INC-2026-08-06-01`'s status to Resolved/Closed with this run cited as
final validation evidence, and `docs/WMS-CURRENT-STATUS.md`'s "Known remaining work" to mark
the backup-restoration item done, adding a separate, explicitly non-blocking item for the
still-open SSH-key-rotation hygiene follow-up.

**Evidence:** Run #39 (`31535041998`) job step list — all 15 steps `success`, confirmed via
`list_workflow_jobs` rather than inferring from the run-level conclusion alone.

**Decisions:** Kept the exposed-SSH-key rotation as a separate tracked item rather than
folding it into this incident's closure criteria, since it's a hygiene concern (the key still
requires host access only the operator holds) and not a defect that caused any of the five
bugs fixed today.

**Risks/incidents:** `INC-2026-08-06-01` closed. No open incidents remain from today's work.
The SSH-key rotation remains outstanding as a tracked, non-blocking follow-up.

**Files/PRs/commits changed:** `docs/WMS-INCIDENT-LOG.md` (`INC-2026-08-06-01` closed),
`docs/WMS-CURRENT-STATUS.md`, `docs/WMS-SESSION-LOG.md` (this entry), on branch
`docs/close-offsite-backup-incident-2026-08-11`, opened as a draft PR against `main`.

**Production state:** Unchanged beyond the successful backups/offsite uploads the validation
runs themselves produced (their entire purpose). No application, database schema, or
credential change was made by this session at any point across the whole incident — all
SSH/hPanel/GitHub-secret actions were performed directly by the operator, guided remotely.

**Remaining work:** Rotate the exposed SSH key (tracked in `WMS-CURRENT-STATUS.md`, item 12).
Otherwise, `production-backup.yml` needs no further attention — back on its normal 02:30 UTC
daily schedule.

**Exact next step:** Merge this documentation PR once CI passes.

## 2026-08-11 (cont'd) — Offsite backup: core path confirmed working; fifth bug (retention dir) found and fixed

**Objective:** Continue closing `INC-2026-08-06-01` after merging the `DB_PATH` fix (PR #64).

**Starting state:** PR #64 merged. Triggered `production-backup.yml` directly via the GitHub
API again to validate.

**Actions:** Run #38 showed the actual backup succeeded completely for the first time since
2026-07-31: written, verified, restore-drilled (`integrity_check=ok, users=9, audit_rows=96`),
downloaded, independently re-verified on the runner, and uploaded offsite with all three
objects size-confirmed against the bucket. This is the disaster-recovery-critical part of the
workflow, now proven working end-to-end. The job still failed, but only on local retention
pruning: `scp` failed because `/home/u716763642/.logs/wms/` doesn't exist on the host. Reading
the step's own code found a real design bug alongside it: the step's comment claims retention
failures must not fail the job, but the `scp` command ran as a bare statement before the
`|| echo warning` fallback (which only covered the subsequent `ssh` call), so `set -e` killed
the whole step on the `scp` failure before that fallback was ever reached — contradicting the
step's own stated intent. Fixed by creating the temp directory first and chaining all three
remote operations under one shared `|| echo warning` fallback.

**Evidence:** Run #38 (`31533906731`) log — full backup/verify/upload success block, then the
`scp` failure. Workflow source read to identify the `set -e`/fallback-ordering bug.

**Decisions:** Kept the fix minimal and mechanical (directory creation + fallback-chain
reordering) rather than restructuring the retention step further, since the actual bug was
narrow and well understood.

**Risks/incidents:** `INC-2026-08-06-01` updated with this fifth finding — importantly, also
updated to record that the core backup/offsite-upload path is now confirmed working, which is
the actual disaster-recovery-relevant fact; the remaining bug only affects local set pruning,
not data safety.

**Files/PRs/commits changed:** `.github/workflows/production-backup.yml` (retention-step
`mkdir -p` + fallback-chain fix), `docs/WMS-INCIDENT-LOG.md`, `docs/WMS-SESSION-LOG.md` (this
entry), on branch `fix/backup-workflow-retention-dir-2026-08-11`, opened as a draft PR against
`main`.

**Production state:** Unchanged, other than the new backup set and offsite copy the successful
run #38 itself produced (its whole purpose) — no application, database schema, or credential
change.

**Remaining work:** Merge this PR, trigger once more, confirm full `conclusion: success`
(including the retention step), then close `INC-2026-08-06-01`.

**Exact next step:** Wait for CI, merge on explicit instruction, trigger, verify.

## 2026-08-11 (cont'd) — Offsite backup: fourth bug found (DB_PATH), fixed in code

**Objective:** Continue closing `INC-2026-08-06-01` after merging the `REMOTE_APP_DIR` fix
(PR #63).

**Starting state:** PR #63 merged. Triggered `production-backup.yml` directly via the GitHub
API (`workflow_dispatch`) rather than waiting on the operator, since this is the same
non-destructive, read-mostly backup action already run manually many times today.

**Actions:** Run #37 confirmed the GLIBC addon problem was fully fixed (no more `GLIBC_2.29`
error), but failed at a new step: `Cannot open database because the directory does not exist`.
Traced through `scripts/backup.js` → `server/config.js`: `config.dbPath` reads `DB_PATH` from
the environment, falling back to a path relative to the script's own directory when unset. The
workflow's remote SSH command never set `DB_PATH` explicitly — it happened to work before only
because the old `REMOTE_APP_DIR` (the legacy persistent path) coincidentally was where the
database lived. Now that `REMOTE_APP_DIR` correctly points at the release symlink, that
fallback resolves to a path inside the release tree, which never contains the database (by
design — see `docs/WMS-PRODUCTION-RUNBOOK.md`). Fixed by adding a `REMOTE_DB_PATH` value
(matching the `DB_PATH` production invariant already on record) and passing it explicitly as
`DB_PATH` to the `scripts/backup.js` invocation.

**Evidence:** Run #37 (`31533205661`) log, `scripts/backup.js` and `server/config.js` source
inspection (both in-repo, read directly — no production access needed for this part).

**Decisions:** Did not touch `scripts/verify-backup.js`'s invocation — confirmed by reading its
source that it never touches `DB_PATH` (it verifies the already-produced backup files, not the
live database), so no equivalent fix needed there.

**Risks/incidents:** `INC-2026-08-06-01` updated with this fourth finding; still open pending
validation of this fix.

**Files/PRs/commits changed:** `.github/workflows/production-backup.yml` (`REMOTE_DB_PATH`
added, passed to the `scripts/backup.js` call), `docs/WMS-INCIDENT-LOG.md`,
`docs/WMS-SESSION-LOG.md` (this entry), on branch `fix/backup-workflow-db-path-2026-08-11`,
opened as a draft PR against `main`.

**Production state:** Unchanged. This session triggered the (read-mostly, non-destructive)
backup workflow directly via the GitHub API, which is the same action already run manually
many times today — no SSH, credential, or host-configuration access was used or required.

**Remaining work:** Merge this PR, trigger the workflow once more, confirm `conclusion:
success`, then close `INC-2026-08-06-01`.

**Exact next step:** Wait for CI, merge on explicit instruction, trigger, verify.

## 2026-08-11 — Offsite backup: SSH + host-key fixed live; app-dir bug found and fixed in code

**Objective:** Solve `INC-2026-08-06-01` completely, working live with the operator who had
direct Hostinger hPanel/SSH access (this session had none throughout).

**Starting state:** 10+ consecutive `production-backup.yml` failures, most recently
`Permission denied (publickey,password)` (run #25). No production/hPanel access available to
this session at any point.

**Actions:** Guided the operator step by step in real time: verified `authorized_keys`
permissions (already correct), diagnosed an early regenerated key as an empty file (0
meaningful bytes) and discarded it, had the operator generate a clean key
(`wms-gha-backup-final-2026-08-11`, confirmed 432 bytes), register its public half both
directly in `authorized_keys` and through hPanel's own SSH-key-management UI, and run a manual
`ssh -vvv` test that confirmed `Authentication succeeded (publickey)` against
`185.97.145.102:65002` as `u716763642` — proof independent of GitHub Actions' redacted logs.
Updated the `HOSTINGER_SSH_PRIVATE_KEY` GitHub secret to match. The next run then failed
differently (`Host key verification failed`); refreshed `HOSTINGER_KNOWN_HOSTS` via
`ssh-keyscan`, cross-checking the ECDSA fingerprint against the one shown during the operator's
manual login (exact match — not blind trust-on-first-use). The following run passed SSH auth
and host-key verification, but then failed the actual backup step with the same
`GLIBC_2.29 not found` signature as `INC-2026-07-31-01`. Directed a read-only checksum
comparison (`sha256sum` on `better_sqlite3.node`) which showed the workflow's `REMOTE_APP_DIR`
pointed at the legacy persistent path (old, incompatible addon,
`e8f767df39a9a934b3705d0fffc401a12932bf94d650aae2d27733311f7ff842`), while the actual live
release at `.builds/current` → `.builds/versions/manual-20260801T202313Z-1bd15f12` has the
correct addon (`a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4`, exact match
to the known-good Aug 1 checksum) — confirming production itself never regressed. Fixed
`REMOTE_APP_DIR` in `production-backup.yml` to follow the `.builds/current` symlink instead of
the stale legacy path.

**Evidence:** All hPanel/SSH/checksum findings are **Reported by the operator** per `DEC-010`
— this session verified only what appeared in GitHub Actions run logs and what the operator
chose to share (fingerprints, checksums). GitHub Actions run #36 (`31532235669`) is the
validation point: SSH auth and host-key verification both succeeded, only the (now-fixed)
`REMOTE_APP_DIR` bug remained.

**Decisions:** Did not attempt to touch the `better-sqlite3` addon itself anywhere — the
GLIBC-2.29 finding was resolved by fixing a workflow path, not by rebuilding, replacing, or
otherwise touching any native addon on production, keeping this outside `DEC-013`'s gated
recovery procedure entirely (correctly so, since production's own addon was never the
problem).

**Risks/incidents:** `INC-2026-08-06-01` updated in place with a full "Resolution — 2026-08-11"
section; kept open, narrowed to confirming one green run after the `REMOTE_APP_DIR` fix merges.
Flagged separately: the operator inadvertently pasted the new SSH private key's full content
into this chat session. Recorded as a follow-up rotation item — not a change to this
resolution, since exploiting it still requires host access only the operator holds, but it
should not be left unrotated.

**Files/PRs/commits changed:** `.github/workflows/production-backup.yml` (`REMOTE_APP_DIR`
fix), `docs/WMS-INCIDENT-LOG.md` (`INC-2026-08-06-01` resolution section),
`docs/WMS-CURRENT-STATUS.md`, `docs/WMS-SESSION-LOG.md` (this entry), on branch
`fix/backup-workflow-app-dir-2026-08-11`, opened as a draft PR against `main`.

**Production state:** Unchanged. All SSH/key/hPanel actions were performed directly by the
operator on their own account; this session made only the workflow-file code change, which
does not touch production until the next scheduled/manual run exercises it.

**Remaining work:** Merge this PR, trigger the workflow, confirm `conclusion: success`, then
close `INC-2026-08-06-01`. Separately: rotate the exposed SSH key as a hygiene follow-up.

**Exact next step:** Wait for CI, merge on explicit instruction as usual, then trigger
`production-backup.yml` manually and verify success before marking the incident closed.

## 2026-08-10 — Offsite backup: SSH auth now rejected (new signature, run #25)

**Objective:** User asked why offsite-backup failures were still occurring; checked latest
workflow run.

**Starting state:** `main` at `5b48688`. `INC-2026-08-06-01` described 9 consecutive failures
(#16–#24) alternating between `/sbin/nologin` and connection timeouts.

**Actions:** Listed `production-backup.yml` run history; found a 10th consecutive failure,
run #25 (2026-08-10, id `31354732571`). Pulled its job log and found a third, new error
signature: `Permission denied (publickey,password)`. Unlike the two prior signatures (both of
which required successful SSH authentication before failing later), this one fails
authentication itself — the offered SSH key is rejected by the host.

**Evidence:** Full log for run #25 confirms `ssh hostinger ...` fails at the authentication
step with `Permission denied, please try again.` (x2) then a final `publickey,password`
rejection, `##[error]Process completed with exit code 255`.

**Decisions:** Reframed the corrective-action priority: checking whether the backup account's
SSH key is still present/valid on the Hostinger host (and whether the `SSH_KEY` GitHub secret
still matches it) is now the most direct lead, ahead of the previously-dominant shell-path
issue. Also noted for the record that this SSH key is unrelated to the HTTPS/token credential
this session uses to push code to the repo, in case the timing raised that question.

**Risks/incidents:** `INC-2026-08-06-01` updated in place (not a new incident) — escalated
from 9 to 10 consecutive failures with the new auth-rejection finding. Per `DEC-008`, local
retention keeps only 7 backup sets; 10 missed cycles now well exceeds that window.

**Files/PRs/commits changed:** `docs/WMS-INCIDENT-LOG.md` (`INC-2026-08-06-01` updated with
the 08-10 finding), `docs/WMS-CURRENT-STATUS.md` (backup status line and "Known remaining
work" item updated), `docs/WMS-SESSION-LOG.md` (this entry), on branch
`docs/offsite-backup-auth-rejected-2026-08-10`, opened as a draft PR against `main`.

**Production state:** Unchanged and not accessed.

**Remaining work:** Owner to check, via Hostinger hPanel, whether the backup account's public
key is still in `authorized_keys` and the account is enabled; update the `SSH_KEY` GitHub
secret if the key was rotated; then separately check the login-shell issue once auth is
restored.

**Exact next step:** Merge this documentation PR once CI passes. Continue watching
`production-backup.yml` for the first successful run.

## 2026-08-09 — Corrected offsite-backup incident framing; now 9 consecutive failures

**Objective:** Following the merge of PR #56 (`INC-2026-08-06-01`), check for new workflow
runs and continue prior work.

**Starting state:** `main` at `8aecef3` (post PR #56 merge). `INC-2026-08-06-01` described the
failures as a clean two-phase progression: `/sbin/nologin` through 2026-08-04, then connection
timeouts from 2026-08-05 onward, across 6 runs (#16–#21).

**Actions:** Listed `production-backup.yml` run history again; found 3 more consecutive daily
failures since the last check (#22–#24, 2026-08-07 through 2026-08-09), extending the streak to
9 days. Re-pulled job logs for every one of the 9 failed runs (not just the 4 sampled
previously) to build a complete per-run table. This showed the original "Phase 1 then Phase 2"
framing was incorrect: the two error signatures **alternate intermittently** — `/sbin/nologin`
on 6 of 9 runs (08-01, 08-03, 08-04, 08-07, 08-08, 08-09) and connection timeouts on 3 of 9
(08-02, 08-05, 08-06) — rather than one signature cleanly succeeding the other.

**Evidence:** Full per-run table (date, run ID, exact error) recorded in the corrected
`INC-2026-08-06-01` entry. `/healthz` and application availability were not checked this
session but were unaffected in all prior checks — this remains a backup-delivery-only issue.

**Decisions:** Reframed the root-cause hypothesis: `/sbin/nologin` (the majority signature) is
treated as the primary, persistent cause (shell-config problem on the backup SSH account); the
connection timeouts are treated as a separate, intermittent fault (network/host-load/firewall),
not a second lasting phase. The unconfirmed correlation with the 2026-08-01 native-addon
recovery host-access work is retained, still explicitly labeled unconfirmed. No corrective
action taken — no production SSH access exists in this environment.

**Risks/incidents:** `INC-2026-08-06-01` updated in place (not a new incident). Per `DEC-008`,
local retention keeps only 7 backup sets; 9 missed offsite cycles now meets or exceeds that
window, so local DR depth may already be thinner than the missed-cycle count suggests.

**Files/PRs/commits changed:** `docs/WMS-INCIDENT-LOG.md` (`INC-2026-08-06-01` corrected),
`docs/WMS-CURRENT-STATUS.md` (backup status line and "Known remaining work" item updated),
`docs/WMS-SESSION-LOG.md` (this entry), on branch
`docs/offsite-backup-incident-correction-2026-08-09`, opened as a draft PR against `main`.

**Production state:** Unchanged and not accessed.

**Remaining work:** Same as before — owner to fix the backup SSH account's login shell via
Hostinger hPanel and investigate the intermittent timeouts, then confirm recovery with a
manual workflow run.

**Exact next step:** Merge this documentation PR once CI passes. Continue watching
`production-backup.yml` for a first successful run to confirm resolution once the owner acts.

## 2026-08-06 — Diagnosed and recorded offsite-backup workflow failure (6 consecutive days)

**Objective:** Investigate a GitHub Actions failure-notification email ("Production Offsite
Backup: All jobs have failed") and, if actionable, record it durably.

**Starting state:** `main` at `e3dec1f` (post PR #55 merge). No open incident tracked this
failure yet.

**Actions:** Listed `production-backup.yml` run history via the GitHub Actions API; found 6
consecutive failed daily runs, #16–#21 (2026-08-01 through 2026-08-06), following a successful
run #15 on 2026-07-31. Pulled job logs for runs #16, #19, #20, and #21 and found two distinct
failure signatures: `/sbin/nologin: No such file or directory` (2026-08-01 → 2026-08-04) versus
`ssh: connect to host *** port ***: Connection timed out` (2026-08-05 → 2026-08-06). Confirmed
via `git log --oneline -- .github/workflows/production-backup.yml` that the workflow file's
last change (`86363c5`) predates this entire failure window, ruling out a workflow-definition
regression as the cause.

**Evidence:** Run/job IDs and exact error strings recorded in the new incident-log entry below.
`/healthz` and application availability were not affected — this is an offsite-backup delivery
failure, not a production outage.

**Decisions:** Recorded a clearly-hedged, explicitly unconfirmed hypothesis that the onset of
Phase 1 (2026-08-01) may correlate with the native-addon recovery host-access work recorded the
same day, without asserting a causal mechanism. Took no corrective action — no SSH/production
access exists in this environment, and any account/shell/firewall fix on the Hostinger host is
an operator action.

**Risks/incidents:** New open incident `INC-2026-08-06-01` (see `docs/WMS-INCIDENT-LOG.md`).
Per `DEC-008`, local backup retention keeps only 7 sets; 6 consecutive missed offsite cycles is
a material, growing DR-risk exposure until resolved.

**Files/PRs/commits changed:** `docs/WMS-INCIDENT-LOG.md` (new `INC-2026-08-06-01` entry),
`docs/WMS-SESSION-LOG.md` (this entry), on branch
`docs/offsite-backup-ssh-incident-2026-08-06`, opened as a draft PR against `main`.

**Production state:** Unchanged and not accessed. No SSH, credential, or host-configuration
change was made.

**Remaining work:** Owner to check the backup SSH account's login-shell configuration and
SSH/firewall/account-enabled state via Hostinger hPanel, then trigger a manual workflow run to
confirm recovery before relying on the next scheduled run.

**Exact next step:** Merge this documentation PR once CI passes (docs-only change, CI is not
expected to be affected). No further AI-driven action is possible on the backup failure itself
without production SSH access.

## 2026-08-04 — Documentation reconciliation: native-recovery resolution was undocumented

**Objective:** Reconcile durable documentation after discovering that the 2026-08-01 production
native-addon recovery (Passenger restart, `INC-2026-07-31-01` resolution) had not been recorded
anywhere in git — `main` still stated PR #53 as Draft and Passenger restart as forbidden.

**Starting state:** `main` at `065736c`. `docs/WMS-CURRENT-STATUS.md` and
`docs/WMS-INCIDENT-LOG.md` both still described the native-addon recovery as open/pending,
contradicting the operator's report of a completed, evidence-gated recovery.

**Conversation/request summary:** The operator reported the completed recovery in chat with
specific evidence (deployed SHA, addon checksum, DB counts, Passenger environment, rollback
path). Separately, the operator shared 5 locally-modified (uncommitted) documentation files
from an unrelated 2026-08-03 session (`fix/workflow-context-analytics-integrity`, an ERP
execution-context and dead-stock-analytics correction) which also had not incorporated the
recovery evidence — they inherited the same staleness already present on `main`. The operator
confirmed: (1) reconcile the recovery evidence into documentation before any commit; (2) leave
the unrelated 2026-08-03 ERP/analytics work untouched and out of scope for this correction —
it is not landed anywhere in git and stays that way.

**Verification performed:** Independently confirmed `https://wms.kynox.io/healthz` returns
`200 {"status":"ok","service":"wms"}`; cross-checked the reported addon SHA-256 against the
value already on record for the independently-inspected artifact (`8822465615`/`8822626790`
— matches exactly); cross-checked the reported database counts against the last recorded
baseline (matches exactly). The remaining reported evidence (Passenger environment read-out,
database integrity/lock check, gate execution sequence) is recorded as **Reported
(production)**, not independently re-executed, per `DEC-010`.

**Changes:** Updated `docs/WMS-CURRENT-STATUS.md` (deployed-commit line, health-check line,
replaced the "OPEN, restart forbidden" native-recovery section with a "RESOLVED" section,
closed items 1–5 of "Known remaining work"), `docs/WMS-INCIDENT-LOG.md` (`INC-2026-07-31-01`
status flipped to Resolved with appended evidence), and `docs/WMS-DECISION-LOG.md` (`DEC-013`
evidence-links note that the policy was executed successfully). Added the 2026-08-01
session-log entry below documenting the recovery execution itself. Did not touch any content
related to the 2026-08-03 ERP-context/analytics correction, `DEC-014`, or migration 013 — that
work remains a separate, unlanded effort per the operator's instruction.

**Decisions:** None new.

**Risks/incidents:** None. This is a documentation-only correction; no production command was
run.

**Files/PRs/commits changed:** `docs/WMS-CURRENT-STATUS.md`, `docs/WMS-INCIDENT-LOG.md`,
`docs/WMS-DECISION-LOG.md`, `docs/WMS-SESSION-LOG.md` (this entry and the one below), on branch
`docs/native-recovery-resolved-2026-08-01`, opened as a draft PR against `main`.

**Production state:** Unchanged and not accessed during this correction.

**Remaining work:** Cross-table stock consistency audit and opening-stock reconciliation
dry-run (see the entry below). The unrelated 2026-08-03 ERP-context/analytics correction
remains unlanded and out of scope.

**Exact next step:** Merge this documentation PR once CI passes, then proceed to the
cross-table stock audit or opening-stock dry-run reconciliation, each needing separate
operator-driven production access.

---

## 2026-08-01 — Production native-addon recovery executed; Passenger restarted; INC-2026-07-31-01 resolved

**Objective:** Execute the reviewed `HOSTINGER-NATIVE-RECOVERY.md` gates against production to
resolve `INC-2026-07-31-01` (GLIBC 2.28 incompatibility) and restart Passenger on a verified
compatible `better-sqlite3` addon.

**Starting state:** PR #53 merge-readiness evidence complete (see the entries below); native
artifact `8822465615`/`8822626790` independently inspected and passed; Passenger restart still
forbidden pending execution of the four production gates in `HOSTINGER-NATIVE-RECOVERY.md`.

**Actions (per `HOSTINGER-NATIVE-RECOVERY.md`):**

- Gate 1: deployed source and effective Passenger environment verified read-only from
  `/proc/$PID/environ`.
- Gate 2: production database integrity, record counts, and initialization-lock state
  verified.
- Gate 3: staged addon provenance (checksum, manifest, GLIBC evidence) and preflight
  load/query against a read-only backup passed.
- Gate 4: existing addon preserved in a timestamped rollback directory; new addon installed by
  same-directory atomic rename; rollback path validated.
- PR #53 merged; Passenger restarted.

**Evidence (Reported (production) by the operator; independently corroborated by this AI
session on 2026-08-04 for `/healthz`, the addon SHA-256, and the database counts only):**

- Deployed source: `1bd15f12d70112a977983a96bae63e1b3c441310`.
- Addon SHA-256: `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` — matches
  the artifact independently inspected on 2026-08-01 (see the entry below).
- Database: `integrity_check = ok`; counts `9|11|35|9746|1|12|0|0`.
- Passenger environment: all 5 required variables correct.
- No initialization lock present.
- No seed, reset, or initialization command run.
- Artifact, previous addon, and a database copy retained; rollback script:
  `/home/u716763642/domains/wms.kynox.io/nodejs/backups/emergency/production-recovery-20260801T202313Z/rollback-production.sh`.
- `/healthz`: `200 {"status":"ok","service":"wms"}` — independently re-verified by this session
  on 2026-08-04.

**Decisions:** None new; execution followed `DEC-013` in full.

**Risks/incidents:** None. This entry resolves `INC-2026-07-31-01`.

**Files/PRs/commits changed:** None in this entry's own scope (production-only action).
Documentation reconciliation is recorded in the 2026-08-04 entry above.

**Production state:** **Changed.** Native addon replaced; Passenger restarted. Database not
modified.

**Remaining work:** The auto-seed and credential-hardening runtime evidence needed to close
Issue #40 is now satisfied by the confirmed Passenger environment read-out above. The
cross-table stock consistency audit (Issue #40) remains open and is now feasible since
production is confirmed healthy and accessible. Opening-stock reconciliation dry-run (PR #39
follow-up) remains open.

**Exact next step:** Proceed to the cross-table stock consistency audit and/or opening-stock
dry-run reconciliation, each requiring separate operator-driven production access.

---

## 2026-08-01 — Final merge-readiness documentation strategy

**Review result:** The complete PR #53 diff, GitHub metadata, checks, comments, review threads, native artifact, and local worktree were reviewed. Runtime/workflow/runbook changes had no code blocker; CI and native validation were green, the PR was mergeable/clean, and no unresolved review thread existed. Merge-readiness remained blocked only because the PR description and durable records contained transient artifact/quota claims that had become stale after later builds.

**Approved correction:** Durable status, incident, inventory, and session records now state the invariant: the current PR head must have green CI/native checks and an independently inspected SHA-named artifact. Exact transient SHA/run/artifact/checksum/expiry evidence belongs in the PR description after the final build, avoiding another source commit that would invalidate its own artifact identity.

**Post-commit gate:** Monitor the automatically triggered checks, inspect the new current-head artifact, and update only the PR description with its exact evidence. Keep the PR draft and unmerged until the owner separately approves a state change. No production action is part of this correction.

## 2026-08-01 — Pre-final documentation-head artifact independently inspected

**Authorization:** The owner approved downloading and inspecting artifact `8822626790` for documentation head `2afa14c655db1147ec1c601c56edaf129e7d0cdd`. No production access, Passenger restart, database operation, artifact deletion, PR state change, commit, or push was authorized or performed during that inspection.

**Evidence and result:** The artifact was downloaded to a unique temporary directory and contained exactly the four required files. Binary SHA-256 `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` matched the checksum file. The manifest matched SHA `2afa14c655db1147ec1c601c56edaf129e7d0cdd`, better-sqlite3 11.10.0, LF-normalized source lockfile SHA-256 `10ee51b4744c84eeed49076321f1dde07e97cdb92b31e7140a6284b8dfc060ae`, Node v20.19.4, ABI 115, Linux x64, GLIBC runtime/ceiling 2.28, run `30713474797`, and attempt 1. GLIBC evidence SHA-256 `e2a520c68093e094229a09a1e10689e1a046a6d5e5e643fee7f8889604ff9e03` matched; independent parsing found no symbol above GLIBC 2.28. The binary is ELF64 little-endian x86-64. Workflow module-load/query validation passed; Windows did not attempt to load the Linux addon.

**Next gate:** A final documentation correction will supersede this SHA. After that single commit, require successful CI/native checks, retain and inspect the new SHA-matched artifact, and record its transient exact identifiers in the PR description without another source commit. Any transition from Draft, merge, production access, staged Hostinger preflight, addon swap, rollback exercise, or Passenger restart requires its own explicit authorization.

## 2026-08-01 — Recovery evidence published; documentation-head checks passed

**Publication:** With owner approval, the four documentation-only changes were reviewed, staged explicitly, committed as `2afa14c655db1147ec1c601c56edaf129e7d0cdd` (`docs(ops): record native recovery evidence`), and pushed to `agent/hostinger-glibc228-native-recovery`. Local HEAD, origin branch HEAD, and Draft PR #53 head matched; the worktree was clean immediately after push.

**Automatic validation:** The push automatically triggered CI run `30713474799` and native run `30713474797`; no manual rerun was issued. Both completed successfully on exact SHA `2afa14c655db1147ec1c601c56edaf129e7d0cdd`. Native artifact `8822626790`, exact name `better-sqlite3-11.10.0-node20-abi115-el8-x64-2afa14c655db1147ec1c601c56edaf129e7d0cdd`, size 1,092,375 bytes, is retained through 2026-08-08T18:53:24Z.

**Next gate at that point:** The documentation-head artifact had not yet been downloaded or independently inspected; the later entry above records that completed inspection. Do not use the previously inspected `e57b278e` artifact for a deployment that claims agreement with a later PR head. PR #53 remained draft and unmerged.

## 2026-08-01 — Retained native artifact independently inspected locally

**Authorization and scope:** The owner approved the previously stated next step: download and locally inspect retained artifact `8822465615`. This did not authorize production access, Passenger restart, database operations, PR merge, or GitHub artifact deletion.

**Evidence:** The exact SHA-named artifact was downloaded to a unique local temporary directory. It contained exactly `better_sqlite3.node`, `better_sqlite3.node.sha256`, `native-addon-manifest.json`, and `glibc-symbols.txt`. Binary SHA-256 `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` matched its checksum file. The manifest matched source SHA `e57b278e04f8cf3ed3838a524bda3f0dbb25252f`, better-sqlite3 11.10.0, the LF-normalized source `package-lock.json` SHA-256 `10ee51b4744c84eeed49076321f1dde07e97cdb92b31e7140a6284b8dfc060ae`, Node v20.19.4, ABI 115, Linux x64, GLIBC runtime/ceiling 2.28, workflow run `30667893534`, and attempt 3. GLIBC evidence SHA-256 `e2a520c68093e094229a09a1e10689e1a046a6d5e5e643fee7f8889604ff9e03` matched, and independent parsing found no required GLIBC symbol above 2.28. The binary header is ELF64 little-endian x86-64.

**Result and remaining gate:** Local artifact validation passed. A Linux module-load/query test already passed in the workflow. The binary cannot be loaded by Windows, and this local review does not replace the mandatory staged-addon preflight on Hostinger. No production action occurred. Keep Passenger restart forbidden until source, effective environment, production database/record-count, initialization-lock, staged preflight, timestamped backup, atomic swap, and immediate rollback gates all pass in a separately approved window.

## 2026-08-01 — Native artifact upload succeeded after quota recalculation

**Authorization:** The owner authorized one additional rerun of Draft PR #53's native build at exact head SHA `e57b278e04f8cf3ed3838a524bda3f0dbb25252f`, solely to test whether the artifact-storage block had cleared.

**Result:** Run `30667893534`, attempt 3, completed successfully. Source-SHA validation, checkout verification, EL8 source build, GLIBC/addon checks, provenance-manifest generation, and `Upload verified addon` all passed. GitHub retained artifact `8822465615`, exact name `better-sqlite3-11.10.0-node20-abi115-el8-x64-e57b278e04f8cf3ed3838a524bda3f0dbb25252f`, size 1,092,375 bytes, expiring 2026-08-08T18:38:39Z. Active storage is now five artifacts totaling 289,436,683 bytes.

**Next gate:** The artifact has not been downloaded or inspected locally and no production action is authorized. Obtain separate approval to download and validate its binary, checksum, manifest, and GLIBC evidence. PR #53 remains open, draft, unmerged, and at the exact source SHA. No artifact deletion, production access, Passenger restart, database operation, commit, or push occurred.

## 2026-08-01 — Single authorized native-build rerun completed

**Authorization and identity gate:** The owner authorized exactly one rerun of Draft PR #53's native build at verified head SHA `e57b278e04f8cf3ed3838a524bda3f0dbb25252f`. Before rerun, PR #53 was confirmed open, draft, unmerged, and still at that SHA; run `30667893534` was confirmed to be the matching `Build Hostinger native addon` run.

**Result:** Attempt 2 passed requested-source validation, Rocky Linux container setup, exact checkout verification, Node setup, source build on GLIBC 2.28, native-addon validation, and provenance-manifest generation. It failed only at `Upload verified addon`: GitHub still reported `Artifact storage quota has been hit` and stated that usage is recalculated every 6–12 hours. No native artifact was created. Post-run verification found the same four active retained artifacts totaling 288,344,308 bytes and zero `better-sqlite3-*` artifacts.

**Gate:** The single authorized rerun has been consumed. Do not rerun again without new explicit authorization and evidence that quota accounting has recalculated. PR #53 remains draft and unmerged. No production access, Passenger restart, database operation, artifact deletion, commit, or push occurred.

## 2026-08-01 — Exact approved Actions artifact cleanup executed

**Authorization and scope:** The repository owner explicitly approved deletion of only the 35 exact artifact IDs in the evidence-supported cleanup pool in `docs/WMS-ACTIONS-ARTIFACT-INVENTORY-2026-08-01.md`, totaling 2,069,364,217 bytes, and explicitly protected IDs `8447368682`, `8447506723`, `8462156227`, and `8576609631`.

**Preflight and execution:** A live GitHub API preflight matched all 35 approved IDs to the inventory by exact name and byte size, confirmed the exact total, found all four protected IDs, and found no active artifact outside those two sets. The 35 approved IDs were then deleted individually through exact-ID API calls. No wildcard, age filter, workflow-wide, or repository-wide deletion was used.

**Postcondition:** A separate live API query found zero deleted IDs still present and exactly four active artifacts—the protected IDs above—totaling 288,344,308 bytes. Artifact deletion is not recoverable through GitHub. Quota recalculation may take 6–12 hours. The native workflow was not rerun, so the PR #53 native artifact remains unretained pending quota recalculation and a separately authorized rerun.

**Safety:** No production access, Passenger restart, database operation, migration, seed, reset, initialization, PR merge, or deletion outside the exact approved set occurred.

## 2026-08-01 — Read-only GitHub Actions artifact classification

**Objective:** Classify all 39 active Actions artifacts after PR #53's native build passed compilation/validation but could not upload because artifact storage was full. No deletion, workflow rerun, production access, database command, Passenger restart, or PR merge occurred.

**Evidence and result:** Joined every artifact to its workflow/run/attempt/event/branch/source SHA, commit-to-PR relationships, app version, tags, Releases and permanent Release assets, UAT records, and deployment/rollback documentation. Active storage is 2,357,708,525 bytes. Four artifacts totaling 288,344,308 bytes remain `RETAIN`; 35 totaling 2,069,364,217 bytes are demonstrably superseded or unreferenced. Exact rows, rationales, minimum and optional deletion sets, assumptions, and retention-policy recommendations are in `docs/WMS-ACTIONS-ARTIFACT-INVENTORY-2026-08-01.md`.

**Critical uncertainty:** The 2026-07-20 physical-device UAT record omitted build commit and APK checksum. Three plausible PR #25/main artifacts therefore remain retained. The account's exact billing quota could not be read without adding an unrelated OAuth scope; the minimum-set capacity calculation is explicitly conditional on a 500 MiB ceiling.

**Exact next step:** Review the inventory and request approval for exact artifact IDs and bytes. Do not delete anything until that approval is explicit.

---

## 2026-08-01 — Native workflow checkout trust correction

**Objective:** Correct PR #53 native-build run `30667043301`, which checked out the exact source SHA successfully but failed when the following Git verification command rejected the Rocky Linux container checkout as a dubious directory.

**Change:** Every Git command executed by the workflow inside the container now uses the repository-scoped form `git -c safe.directory="$GITHUB_WORKSPACE" ...`. No `safe.directory='*'`, global Git configuration, production command, database operation, Passenger restart, or artifact deletion is involved.

**Evidence:** CI passed on `41e2cde`; the native run failed at `git rev-parse HEAD` before compilation or upload and retained zero artifacts. Shell syntax, workflow assertions, and `git diff --check` are rerun before publishing this correction.

**Remaining work:** Push the focused correction, monitor both checks, and confirm whether the native artifact can be retained. Artifact storage quota remains unresolved until a run reaches upload.

---

## 2026-08-01 — Draft PR #53 merge-readiness hardening

**Objective:** Correct the Hostinger native `better-sqlite3` recovery workflow and operator runbook before Draft PR #53 can be considered merge-ready. Repository-side only; production, Passenger, the production database, and existing GitHub artifacts were not changed.

**Starting state:** local `main` and `origin/main` at `0ba56106e7e9691930ba03d659c743561ad81614`; PR #53 head available at `3672b2a0900f15b628ada4b210a85c7f023a9d83` on `agent/hostinger-glibc228-native-recovery`. GitHub Actions CI run `30662015496` passed, while native-addon run `30662015501` passed its build, GLIBC-ceiling, and module-load checks but failed at artifact upload because repository artifact storage was over quota.

**Changes:**

- The native-addon workflow now requires and checks out an explicit full source SHA, verifies the checkout, and produces a SHA-named artifact containing the binary, checksum, manifest, and GLIBC evidence. The manifest records the source SHA, exact dependency and lockfile identity, Node/ABI/platform/compiler/GLIBC evidence, and workflow run provenance.
- The Hostinger recovery runbook is now fail-closed across four gates: deployed branch/SHA and effective Passenger environment; production database identity, reviewed record counts, and initialization-lock state; staged-addon provenance and load/query preflight; then timestamped backup, same-directory atomic swap, and a validated immediate rollback command. Passenger restart remains forbidden until every gate has passed and its evidence has been reviewed.
- Current status, production runbook, incident log, and decision log were updated to make those gates and the unresolved artifact-quota condition durable.

**Validation:** extracted shell blocks from the workflow and recovery runbook pass `bash -n`; package/lockfile versions and the workflow/runbook required-field assertions pass; `git diff --check` passes. The local machine does not provide Node/npm, so the full application test suite cannot be rerun locally. A new GitHub CI run also cannot start until the branch is published.

**GitHub publication state:** local changes remain uncommitted and unpushed. The mandatory publishing workflow requires GitHub CLI authentication, but `gh` is not installed on this machine. Draft PR #53 therefore remains at its previous remote head until `gh` is installed and authenticated.

**Artifact cleanup gate:** no artifact was deleted and no deletion was attempted. Before any deletion approval request, obtain a repository-wide inventory containing artifact ID and exact name; workflow name/path; run ID and attempt; branch and source SHA; creation and expiry timestamps; size in bytes; retention purpose; release/backup references; and a per-artifact safe/unsafe rationale. The approval request must list the exact proposed artifact IDs and total bytes—never a wildcard, age-only, workflow-wide, or repository-wide deletion.

**Production state:** unchanged. No production access, Passenger restart, migration, seed, reset, initialization, or database write occurred.

**Remaining blockers:** install and authenticate `gh`; publish the reviewed commit; obtain the exact artifact inventory and separate deletion approval; free only specifically approved artifact storage; rerun the native build at the new source SHA; retain and inspect the artifact; then execute all production gates in an approved maintenance window. Passenger restart remains forbidden until those gates pass.

**Exact next step:** install GitHub CLI, run `gh auth login` followed by `gh auth status`, then rerun the final scope review before staging the eight intended files and publishing the existing PR branch.

---

## 2026-07-27 — Opening Stock import validation harness

**Objective:** De-risk the Opening Stock production import — the step where a mistake corrupts the FIFO baseline and is expensive to detect and unwind. Repository-side only; no production access, no production command.

**Starting state:** `main` at `8012b5d`, clean tree, CI green, no open PRs.

**What was built:** `scripts/validate-opening-stock.js` (`npm run validate-opening-stock`). An operator tool, not a CI test: it boots the **real** server and calls the **real** import endpoint against a copy of a real database, so what it proves is what the operator will actually get through the UI.

**Safety design.** The tool writes test data, so it must never reach a live database:

- Refuses the database this checkout is configured to use (`config.dbPath`).
- Refuses paths containing production markers (`domains/wms.kynox.io`).
- Never mutates the file passed to it — it copies to a scratch directory, works there, and deletes it afterwards.
- Creates a disposable admin and `VALIDATE-`-prefixed fixtures inside the scratch copy only, so real rows are untouched even there.

**Scenarios covered** (the eight in the V1.0 plan, plus a data-integrity check): create; identical re-import skipped; re-import with a different quantity does not overwrite; same batch in a different bin rejected; operational goods-receipt batch rejected rather than increased; comma-formatted quantities; multiple bins in one import; forced failure rolls back the whole import; pre-existing data untouched and `integrity_check` still `ok`.

The rollback scenario installs a temporary trigger that raises on a sentinel batch number, so the all-or-nothing guarantee is **proven** rather than assumed from reading `applyRows`.

**Evidence:**

- Against a seeded copy: **39 passed, 0 failed**.
- Source file SHA-256 identical before and after a full run — the harness does not modify what it is pointed at.
- Guards verified by execution: no argument → exit 2; configured live DB → exit 2; production-looking path → exit 2; valid copy → exit 0.
- ESLint clean.

**Two defects found in my own harness while building it**, both fixed: the goods-receipt fixture used lowercase `released` against a `CHECK` constraint requiring `RELEASED`, and an early exit-code check was reading `head`'s status rather than the script's. Neither was a product defect.

**Documentation:** `WMS-PRODUCTION-RUNBOOK.md` gains an "Opening Stock import — pre-flight validation" procedure, including the instruction to **re-import the same file on production afterwards** to prove idempotency on production itself, not only on a copy.

**Production state:** unchanged. Production changed: no. Database changed: no.

**Remaining work:** unchanged and still gated on deployment — production is six merges behind `main` and runs neither the auto-seed nor the credential hardening, nor the PR #43 idempotency fix.

**Exact next step:** operator returns the read-only production output; deploy `main`; then use this harness against a copy before the real Opening Stock import.

---

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

| File                         | Change                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/reset-admin.js`     | Production requires explicit email, explicit password, and the exact phrase `RESET ADMIN PASSWORD`. Built-in defaults refused. Never seeds — an empty roles table now refuses and points at read-only diagnosis. Writes an audit record. |
| `server/routes/users.js`     | Administrator reset sets `must_change_password = 1` and is audited.                                                                                                                                                                      |
| `server/routes/auth.js`      | Self-service change is audited; it remains the only path that clears the flag.                                                                                                                                                           |
| `tests/e2e/password_test.py` | Extended from 10 to 25 checks: credential lifecycle, audit presence, secret-leak assertions, and the `reset-admin` refusal matrix.                                                                                                       |

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

## 2026-07-27 — Unified AI handoff and V1.0 closure plan

**Objective:** Convert the WMS project-management report into a durable, mandatory operating prompt shared by Claude, ChatGPT, Copilot, Codex, and human maintainers, with an ordered production-stabilization and V1.0 closure plan.

**Starting state:**

- Work began from `main @ b9ec782`.
- During review, `main` advanced through PR #45 and PR #46 to `152a32f0fd0a2ec7e21e2a10c2ad55f602976678`.
- The documentation branch was reset to the latest `main` before the final files were reapplied, preventing stale authentication and auto-seed information from being reintroduced.
- Production was not accessed.

**Conversation/request summary:**

- The owner requested a WMS-only report covering completed work, current system capabilities, plan progress, and remaining work.
- The owner then requested that the report become a Claude prompt establishing unified knowledge and including the following execution steps.
- The owner instructed `UPDATE NOW`, authorizing the repository documentation update.

**Files/code inspected:**

- `CLAUDE.md`
- `docs/WMS-CURRENT-STATUS.md`
- `docs/WMS-SESSION-LOG.md`
- `docs/WMS-V1.0-EXECUTION-PLAN.md`
- production-initialization route/service code
- movement-history import tests
- PR #42 through PR #46
- Issue #37 and Issue #40

**Commands/actions:**

- Created branch `agent/unified-ai-handoff`.
- Detected that `main` had advanced by four commits and refused to open a PR from the stale base.
- Reset the documentation branch to `main @ 152a32f`.
- Added `docs/WMS-UNIFIED-AI-HANDOFF.md`, containing:
  - trust hierarchy;
  - verified versus historical baseline rules;
  - delivered capability map;
  - data-protection and production-safety rules;
  - Opening Stock, movement-history, database-recovery, lock-path, and auto-seed context;
  - ten ordered phases from read-only reconciliation through V1.0 release;
  - mandatory session close-out format;
  - a read-only first assignment for every new agent.
- Updated `CLAUDE.md` so the unified handoff is mandatory reading and so current critical context includes PR #45 authentication reconciliation and PR #46 fail-closed auto-seed hardening.
- No application code, workflow, production configuration, or database was changed.

**Evidence/results:**

- New handoff commit: `a2c162a614fb0b467ea6f85bc4c5657eeb65f31b`.
- Updated `CLAUDE.md` commit: `dc6af2aba38ecfebfa16c5e1dda9752a9b64e6f6`.
- Branch base: `152a32f0fd0a2ec7e21e2a10c2ad55f602976678`.

**Decisions:**

- The handoff defines how facts are reconciled; it does not replace read-only production verification.
- Trust order is production evidence → GitHub evidence → merged documentation → open documentation PRs → historical context → assumptions.
- Any new agent must begin with Phase 1 and must not immediately deploy or alter the production database.
- Feature expansion remains frozen until production-data stabilization and V1.0 closure, except for verified P0/P1 defects.

**Risks/incidents:** None. Documentation-only repository changes; production was not accessed or changed.

**Files/PRs/commits changed:**

- Added `docs/WMS-UNIFIED-AI-HANDOFF.md`.
- Updated `CLAUDE.md`.
- Updated `docs/WMS-SESSION-LOG.md`.

**Production state:** Unchanged and not inspected during this session.

**Remaining work:**

- Open a draft PR from `agent/unified-ai-handoff` to `main`.
- Review the documentation-only diff.
- After approval and merge, use the handoff's Phase 1 prompt for read-only production reconciliation.

**Exact next step:** Open the draft documentation PR, verify that only the three intended documentation files changed, and keep it unmerged until the shared baseline is reviewed.

> **Follow-up (later the same day):** this branch was rebased onto `main @ e5b79ee` to pick up PR #48 (credential hardening, `DEC-012`), and the handoff's trust hierarchy was amended — see the rebase note in the entry above this one.

---

## 2026-07-27 — Auto-seed hazard reproduced and fixed (P0 code hardening)

**Objective:** Close the auto-seed hazard identified in the Phase 1 review before any deployment or restart of production. Repository-side only; no production access and no production command.

**Starting state:** `main` at `690302d`, clean tree, CI green. The hazard was recorded as a code-verified hypothesis.

**What was proven:**

The mechanism was reproduced, so it is no longer a hypothesis. Booting the real server against a migrated-but-userless database with `NODE_ENV` unset caused it to **seed demo data and a default administrator** with `must_change_password = 1`.

Method: the new suite was run against the **previous** `server/index.js`, where it failed exactly two end-to-end cases — "does NOT seed with no opt-in" and "does NOT seed when `NODE_ENV=development`" — and passed 19/19 against the new implementation. The test therefore catches the real defect rather than restating the new code.

**Root cause:** the guard was opt-out and keyed on `NODE_ENV`, so it failed **open**. Safety depended on a variable being _present_. Any runtime that does not export `NODE_ENV` — plausible under managed Node.js/Passenger — reached the seed branch.

**Changes:**

| File                               | Change                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/services/firstRunSeed.js`  | New. Pure, testable policy: auto-seed requires explicit `ALLOW_AUTO_SEED=1`; `SKIP_AUTO_SEED=1` overrides it. Absence of configuration means refuse. Carries the operator warning text. |
| `server/index.js`                  | Uses the policy instead of the inline `NODE_ENV` guard. Adds a per-boot database identity line (`[db] path=… size=… users=… migrations=…`), an explicit ask in Issue #40.               |
| `tests/e2e/autoseed_guard_test.py` | New. Policy truth table plus end-to-end boots against throwaway databases on isolated ports.                                                                                            |
| `tests/run.sh`                     | Suite wired into Phase 1.                                                                                                                                                               |
| `DEPLOY-HOSTINGER.md`              | First-run bootstrap documented as opt-in, with the reason.                                                                                                                              |

**Evidence:**

- New suite standalone: **19 passed, 0 failed**.
- Same suite against the old guard: **17 passed, 2 failed** (the two end-to-end cases).
- Full suite (`npm test`): **ALL TEST SUITES PASSED**.
- ESLint on changed files: clean.

**Compatibility:** nothing depended on the implicit path — the devcontainer runs `npm run setup`, `docker-compose` documents `npm run seed`, and CI seeds explicitly. A genuine first install now starts once with `ALLOW_AUTO_SEED=1` or runs `npm run seed`.

**Decisions:** `DEC-011` — destructive-by-omission operations must be opt-in and fail closed; safety may not depend on a variable being present to trigger a guard; such guards require a test that fails against the unsafe version.

**Production state:** unchanged. Production changed: no. Database changed: no. **Production still runs the old fail-open guard until this is deployed.**

**Remaining work:**

- Read the Passenger **runtime** environment. This is now needed as _evidence for Issue #40_ — whether the auto-seed path actually fired in production — rather than as a safety gate, since the deployed fix makes an unset environment fail safe.
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

| Fact                         | Value                                                               | Method                           |
| ---------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `origin/main`                | `b9ec782dddfd3e57dbb3448f9906b340427bb2f4`                          | `git rev-parse origin/main`      |
| Migrations in code           | 12, latest `012_opening_stock_batch_registry`                       | `server/db/migrations.js`        |
| PR #43 fix present on `main` | yes (`server/routes/import.js`)                                     | source inspection                |
| Temporary debug endpoint     | absent                                                              | repository search                |
| E2E inventory                | 21 suites, 397 assertions                                           | `tests/run.sh`, `tests/e2e/*.py` |
| CI on `main`                 | run #155 on `b9ec782`, success                                      | Actions API                      |
| Latest offsite backup        | run #11, `2026-07-27T06:03:54Z`, success                            | Actions API                      |
| Backup history               | 8 consecutive successes (#4–#11); #2 failed 2026-07-20, fixed by #3 | Actions API                      |

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

## 2026-08-17 — KYNOX WMS experience redesign baseline and first implementation wave

**Objective:** Execute the attached KYNOX WMS experience redesign program from repository truth, reconcile open PRs, establish the target UX architecture, and implement the first controlled presentation wave without merge, deployment, or production access.

**Starting state:** `main` was verified at `22b4a16`. Open PRs #68 and #69 were verified, with #69 based on the complete #68 stack. PRs #67 and #59 were also open but unrelated to the initial redesign surface.

**Actions:** Cloned `Islamce/WMS`, read the repository-required operating documents, inspected the web shell, route/page inventory, Flutter navigation and screens, canonical workflow states, shared workflow-context service, existing V2 transformation artifacts, and representative Command Center/request/picking surfaces. Created `feat/wms-experience-redesign-execution` from `origin/feat/d02-execution-cards` so the redesign extends the complete #68 → #69 stack. Produced the baseline, screen inventory, market benchmark, and architecture documents under `docs/WMS-REDESIGN-*.md`.

**Implementation:** Added a reusable presentation-only operational object header to `public/js/ui.js`, applied it to `public/js/pages/requestDetail.js`, and added responsive object/exception styles to `public/css/kynox-v2.css`. No workflow transition, API contract, permission, schema, database, ERP, audit, SoD, allocation, picking, or production behavior was changed.

**Validation:** `node --check` for changed JavaScript and `git diff --check` passed. `npm run lint` completed with 0 errors and the repository's existing warnings. After local `npm ci --ignore-scripts` and `npm rebuild better-sqlite3`, `npm test` passed all suites. `npm run test:smoke` passed 6/6 base smoke, 10/10 request-line visibility, and 11/11 design-foundation checks after installing the local Playwright Chromium runtime. The local environment is Node v22.13.0 while the repository declares Node 20.x; this compatibility caveat remains recorded.

**Production state:** Unchanged. No Hostinger access, deployment, migration, Passenger restart, live database access, import, seed/reset, environment-variable change, or PR merge occurred.

**Next step:** Complete the remaining implementation waves for Command Center queue continuity, inventory/exception surfaces, and Flutter task-first presentation only where existing contracts support them; capture visual evidence; run the full applicable regression matrix; push the branch and open a Draft PR.

## 2026-08-17 — Controlled manual-release pipeline first run

**Objective:** Merge and execute the manually dispatched CI/CD release path for the current `main` commit while preserving the WMS production safeguards.
**Starting state:** PR #71 had merged the first release workflow. GitHub Actions environment reviewer and wait-timer rules were unavailable on the repository plan, and the user explicitly approved the reduced-control, manual-dispatch model.
**Actions:** Created the minimal `production` environment without unsupported protection rules. Merged PR #72, which aligns the workflow with the active Hostinger release symlink and the existing `HOSTINGER_*` repository credential convention. Dispatched run `32018477290` for SHA `754d1e8482bbc1768011844138bc158944214644`.
**Evidence/results:** The reusable CI validation passed. The deployment job authenticated using pinned SSH configuration and executed the remote pre-deployment backup. The new backup manifest passed checksum validation, SQLite `integrity_check`, and a read-only restore drill (`users=10`, `audit_rows=130`). The release stopped before any code update, migration, Passenger restart, or public health check because the active Hostinger checkout cannot authenticate to GitHub over HTTPS (`fatal: could not read Username for 'https://github.com'`).
**Decisions:** Treat the remote Git credential failure as a hard deployment stop. Do not add a production Git credential or bypass the check. Replace the remote-pull assumption with a runner-originated source-bundle and atomic candidate-release procedure, retaining the existing verified SSH path and dependency/native-addon guardrails.
**Risks/incidents:** Production code and schema were not changed by the failed run. A verified fresh backup exists in the protected remote backup directory. The initial workflow must not be re-run until the source-bundle revision is reviewed and merged.
**Files/PRs/commits changed:** PR #72 merged at `754d1e8482bbc1768011844138bc158944214644`; follow-up workflow revision pending.
**Production state:** Live WMS was not restarted or migrated. Backup-only state changed as intended.
**Exact next step:** Implement, validate, merge, and retest the runner-originated source-bundle release workflow.
