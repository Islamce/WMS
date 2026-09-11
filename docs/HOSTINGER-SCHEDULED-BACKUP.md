# WMS Production — Scheduled Offsite Backup (GitHub Actions)

Automated daily offsite backup of the WMS production database, implemented as a
GitHub Actions workflow (`.github/workflows/production-backup.yml`). Retargeted
from the retired shared-hosting/Passenger deployment to the VPS Docker deployment
on 2026-09-06 and verified end to end by run `34047172529`.

## 1. Confirmed production architecture
- **Hosting:** Hostinger VPS, Docker Compose, central Caddy reverse proxy.
- **Host app path:** `/opt/apps/wms`.
- **Container:** Compose service `wms`; Node 20 and its matching
  `better-sqlite3` build come from the production image.
- **Live database:** host `/opt/apps/wms/data/wms.db`, mounted at
  `/app/data/wms.db` in the container.
- **Local backup dir:** host `/opt/apps/wms/backups`, mounted at
  `/app/backups` in the container.
- The workflow never modifies the checkout, rebuilds the image, migrates the
  database, or restarts the service.

## 2. Why not Hostinger cron
The workflow originated because the retired shared-hosting plan exposed no
working scheduler. It remains the offsite scheduler on the VPS because it also
provides independent runner verification, encrypted S3-compatible upload,
object verification, retention, and heartbeat monitoring. No HTTP backup
endpoint is added, and backups never run inside web requests.

## 3. Schedule
`cron: "30 2 * * *"` = **02:30 UTC daily = 05:30 Asia/Riyadh (UTC+3)**. Also
runnable on demand via **workflow_dispatch**. `concurrency` allows one backup at
a time and never cancels an in-flight run.

## 4. Required GitHub Actions secrets
Set under **Settings → Secrets and variables → Actions → New repository secret**.
Never commit these; the workflow never prints them.

| Secret | Purpose |
|---|---|
| `HOSTINGER_HOST` | SSH host (e.g. the server hostname/IP) |
| `HOSTINGER_USERNAME` | VPS SSH user (`root`, as currently configured) |
| `HOSTINGER_PORT` | SSH port |
| `HOSTINGER_SSH_PRIVATE_KEY` | Private key for the backup-only key pair (§6) |
| `HOSTINGER_KNOWN_HOSTS` | Pinned host key line(s) for the server (§7) |
| `BACKUP_STORAGE_ACCESS_KEY` | S3-compatible access key |
| `BACKUP_STORAGE_SECRET_KEY` | S3-compatible secret key |
| `BACKUP_STORAGE_BUCKET` | Destination bucket name |
| `BACKUP_STORAGE_ENDPOINT` | S3-compatible endpoint URL (e.g. `https://s3.<region>.backblazeb2.com`) |
| `BACKUP_STORAGE_REGION` | Region for the endpoint |

Paths (`REMOTE_APP_DIR`, `REMOTE_BACKUP_DIR`, `CONTAINER_BACKUP_DIR`, `REMOTE_DB_PATH`, `KEEP_SETS`) are set
as non-secret `env:` in the workflow and match the verified production paths;
change them there if the hosting layout changes.

## 5. S3-compatible provider setup
Any S3-compatible object store works (Backblaze B2, Wasabi, Cloudflare R2, AWS
S3). Create a **private** bucket, an application key **scoped to that bucket**
with put/list/get, and note the endpoint + region. Enable **default encryption
at rest** on the bucket; the upload also requests `--sse AES256` (honored where
supported). Transit is HTTPS.

## 6. Secure SSH key creation & installation
On a trusted machine (not committed anywhere):
```bash
ssh-keygen -t ed25519 -f wms_backup_key -C "wms-gha-backup" -N ""
# Install the PUBLIC key in the VPS user's ~/.ssh/authorized_keys.
cat wms_backup_key.pub
# Put the PRIVATE key contents into the HOSTINGER_SSH_PRIVATE_KEY secret:
cat wms_backup_key
```
Use a dedicated key for this workflow only, so it can be rotated independently.

## 7. SSH host-key (fingerprint) verification
Host-key checking stays **on**; we pin the key rather than disabling it.
```bash
ssh-keyscan -p <PORT> -t ed25519,rsa <HOSTINGER_HOST> > known_hosts.candidate
ssh-keygen -lf known_hosts.candidate          # prints the fingerprints
```
**Verify** the printed fingerprint against a trusted source (compare with the
fingerprint shown when you SSH in interactively and accept the host, or via
Hostinger support). Once verified, paste the contents of `known_hosts.candidate`
into the `HOSTINGER_KNOWN_HOSTS` secret. If the server key ever changes
legitimately, re-run and update the secret.

## 8. What the workflow does (phases, all fail-fast)
1. Checkout + `npm ci` on the runner (runner's own `better-sqlite3` for the
   independent integrity check — never touches production `node_modules`).
2. Write the SSH key + pinned `known_hosts`; `StrictHostKeyChecking yes`.
3. Snapshot existing remote manifests (the "before" set).
4. **Remote backup + verify** — from `/opt/apps/wms`, exactly the tested pattern:
   ```bash
   docker compose exec -T -e BACKUP_DIR=/app/backups \
     -e DB_PATH=/app/data/wms.db wms node scripts/backup.js
   docker compose exec -T -e BACKUP_DIR=/app/backups \
     wms node scripts/verify-backup.js
   ```
   Any failure aborts the job. No npm, migrations, restarts, installs, or git.
5. **Deterministic new-set identification** — set-difference of manifest lists
   (not mtime); require exactly one new manifest; parse it on the remote (node 20)
   and confirm the referenced `db_file`/`attachments_dir` exist and share its stamp.
6. Download **only** that set to the runner.
7. **Independent runner verification** — `backup-select.js` (structure), non-empty
   DB, then `verify-backup.js` (recompute SHA-256 vs manifest, `PRAGMA
   integrity_check`, restore drill in scratch).
8. **Offsite upload** to `wms-production/YYYY/MM/DD/<run-id>/` (manifest, db,
   attachments `.tar.gz` when present, plus a small non-sensitive summary).
9. **Offsite verification** — `head-object` each key; confirm size matches local.
10. **Local retention** — only after verified upload; keep newest 7 sets; run via
    a temp copy of `backup-retention.js` (never added to the deployed checkout).
    Retention problems warn but do not invalidate the offsite backup.

The workflow never uploads `.env`, source, keys, logs, or the whole backup dir,
and never prints secrets or database rows.

## 9. Manual `workflow_dispatch` test
Actions → **Production Offsite Backup** → **Run workflow** (optionally tick
*dry-run retention* the first time). Expected success output:
- "Existing manifests: N"
- Remote step prints the tested backup + `verify-backup` PASS lines ending
  `✅ Backup verified and restore drill passed.`
- "New manifest: wms-<stamp>.manifest.json"
- Runner verification prints `SELECTED set …` + `✅ Backup verified …`
- Upload + "confirmed <key> (<bytes> bytes)" for each object
- Job summary shows the stamp and offsite prefix.

## 10. Confirm offsite objects
```bash
aws s3 ls "s3://<BUCKET>/wms-production/$(date -u +%Y/%m/%d)/" \
  --endpoint-url "<ENDPOINT>" --recursive
```

## 11. Full restore to a scratch location (never over production)
```bash
mkdir -p /tmp/wms-restore && cd /tmp/wms-restore
aws s3 cp "s3://<BUCKET>/wms-production/<YYYY/MM/DD>/<run-id>/" . --recursive --endpoint-url "<ENDPOINT>"
# Verify the downloaded set independently (needs a Node 20 + better-sqlite3 env):
node /path/to/WMS/scripts/backup-select.js . --manifest wms-<stamp>.manifest.json --json
node /path/to/WMS/scripts/verify-backup.js .
# Restored DB is at ./wms-<stamp>.db ; attachments in ./attachments-<stamp>/ (untar if archived).
```
**Production restore approval:** restoring onto production is a controlled,
approved operation (see `docs/OPS-RUNBOOK.md §2.5`): coordinate a maintenance
window, create a final backup, stop the WMS container, replace the host-side
`/opt/apps/wms/data/wms.db` (and handle WAL/SHM as one SQLite state), restart,
and confirm `/healthz`. Requires sign-off from the recovery owner (below).

## 12. Retention
- **Local (Hostinger):** newest **7** verified sets (this workflow).
- **Offsite (provider lifecycle — configure on the bucket):** daily **14 days**,
  weekly **8 weeks**, monthly **12 months**. A single daily path does **not** by
  itself create weekly/monthly preservation — use bucket **lifecycle rules** (or
  a separate, deterministic, tested job) to transition/retain. Example lifecycle
  intent: expire objects under `wms-production/` after 14 days, but copy/retain
  one set per week and per month under `wms-weekly/` and `wms-monthly/` prefixes
  via provider lifecycle or a documented promotion job. Prefer provider-native
  lifecycle over deletion logic in the workflow.

## 13. Troubleshooting
| Symptom | Likely cause / action |
|---|---|
| SSH fails at host-key step | `HOSTINGER_KNOWN_HOSTS` wrong/rotated — re-run §7 |
| Remote backup fails | Container unavailable, bind mount missing, or image/runtime mismatch — inspect `docker compose ps/logs`; do not rebuild as part of backup |
| "Expected exactly 1 new manifest" | A prior partial run or another backup racing — check `concurrency`; inspect the backup dir |
| Runner integrity check fails | Corrupt transfer — re-run; if persistent, the source set is bad |
| Upload/verify size mismatch | Provider/endpoint issue — check bucket/endpoint/region secrets |
| Retention warning | A set had an invalid manifest relationship — inspect manually; offsite copy is still valid |

## 14. Credential rotation
- **SSH key:** generate a new pair (§6), install the new public key, update
  `HOSTINGER_SSH_PRIVATE_KEY`, then remove the old public key from the server.
- **Storage keys:** create a new application key on the provider, update
  `BACKUP_STORAGE_ACCESS_KEY`/`SECRET_KEY`, then revoke the old key.
- **Host key change:** update `HOSTINGER_KNOWN_HOSTS` after re-verifying (§7).

## 15. Recovery ownership & responsibilities
- **Backup operation owner:** repository maintainer (workflow + secrets).
- **Restore/DR decision owner:** the operator/business owner authorizes any
  production restore and the maintenance window.
- **RPO 24h / RTO 4h** targets per `docs/OPS-RUNBOOK.md`.

## 16. Related follow-ups (not part of this workflow)
- **External uptime monitor** on `https://wms.kynox.io/healthz` (see OPS-RUNBOOK §1 / operator steps).
- **CSP verification:** the public root currently shows only
  `content-security-policy: upgrade-insecure-requests`, which may be proxy-added
  and may not reflect the app's full Helmet CSP. Tracked as a separate follow-up;
  not changed here.
