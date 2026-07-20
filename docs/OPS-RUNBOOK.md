# WMS V1.0 — Operations Runbook

Production operations for the WMS backend (Node/Express + SQLite) on a Hostinger
VPS under PM2, plus the Android APK. Covers monitoring (OPS-1), backup & DR
(OPS-2 / DB-2), and deployment & rollback (OPS-3). No secrets are stored in this
file — every credential is an environment variable or an operator-held value.

---

## 1. Monitoring & alerting (OPS-1)

### 1.1 Health endpoint
`GET /healthz` → `200 {"status":"ok","service":"wms"}` (unauthenticated). This is
the single source of truth for "is the app up".

### 1.2 External uptime monitor (configure once)
Use any external monitor (UptimeRobot free tier, Hetzner, BetterStack, a cron on
a second host). Configure:
- **URL**: `https://wms.kynox.io/healthz`
- **Interval**: 1–5 min
- **Up condition**: HTTP 200 AND body contains `"status":"ok"`
- **Alert after**: 2 consecutive failures (avoids single-blip noise)
- **Alert recipients**: set on the monitor side; mirror them in `ALERT_EMAIL`
  (see 1.4) so in-app/log-based alerts reach the same people.

### 1.3 PM2 process + log rotation
```bash
pm2 start index.js --name wms          # or your ecosystem file
pm2 install pm2-logrotate              # rotate logs so disk never fills
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 startup && pm2 save                # survive reboots
```
Watch for a **restart loop**: `pm2 describe wms` → `restarts` climbing fast means
a crash loop — check `pm2 logs wms --lines 200`.

### 1.4 What to alert on and how
| Signal | Source | How to detect |
|---|---|---|
| Downtime | `/healthz` | external monitor (1.2) |
| Restart loop | PM2 | `pm2 jlist` → `pm2_env.restart_time` delta; alert if >5/5min |
| HTTP 5xx spike | request log | `grep ' 5[0-9][0-9] ' <pm2 log>` rate; the app logs one line per request (LOG_REQUESTS=1) |
| Disk-space risk | OS | `df -P /` free% < 15% |
| Backup failure | cron | non-zero exit of `npm run backup` / `npm run verify-backup` |

Set alert recipients via environment (never hardcode):
```bash
ALERT_EMAIL=ops@yourco.com          # consumed by your cron/monitor wrappers
```

### 1.5 Test-fire an alert (verification procedure)
1. **Downtime**: `pm2 stop wms` → monitor should alert within its interval → `pm2 start wms`.
2. **Backup failure**: `BACKUP_DIR=/nonexistent-ro npm run backup` → non-zero exit → cron alert.
3. **5xx**: hit a deliberately bad internal route in staging and confirm the log/alert rule matches.
Document the timestamp and who received each test alert.

---

## 2. Backup & Disaster Recovery (OPS-2 / DB-2)

**Targets:** RPO = 24 h (at most one day of data lost), RTO = 4 h (restored and
serving within four hours of a declared incident).

### 2.1 What a backup set contains
`npm run backup` (or `node scripts/backup.js [dir]`) writes, per run:
- `wms-<stamp>.db` — consistent online SQLite snapshot (`.backup()`, no downtime)
- `attachments-<stamp>/` — copy of `data/attachments/` (uploaded files)
- `wms-<stamp>.manifest.json` — `created_at`, `app_version`, byte size, **SHA-256
  of the DB**, attachment count and **combined attachments SHA-256**

Retention: sets older than `BACKUP_RETENTION_DAYS` (default 14) are pruned.

### 2.2 Schedule it
Either the in-process daily backup (set `BACKUP_DIR` in the server env) or cron:
```bash
0 2 * * *  cd /path/to/WMS && BACKUP_DIR=/var/backups/wms npm run backup && \
           BACKUP_DIR=/var/backups/wms npm run verify-backup || \
           echo "WMS backup/verify FAILED" | mail -s alert "$ALERT_EMAIL"
```

### 2.3 Offsite copy (configurable, no secrets in repo)
After each backup, sync the directory offsite with an operator-configured method
(pick one; store credentials in the OS keychain / rclone config, never in Git):
```bash
rclone sync /var/backups/wms remote:wms-backups        # rclone (S3/B2/Drive/…)
# or: rsync -az /var/backups/wms/ backup-host:/wms/     # scp/rsync to a second host
```

### 2.4 Verify integrity (DB-2)
`npm run verify-backup` checks the latest set and **exits non-zero with a clear
reason** when: the manifest/DB is missing, the DB SHA-256 mismatches, SQLite
`PRAGMA integrity_check` is not `ok`, attachments are missing or their checksum
mismatches, or the restore drill can't open the copy. It performs a **restore
drill** into a scratch temp dir (never touching production) and confirms the
restored DB is queryable (`users`, `audit_trail` counts). Covered by
`tests/e2e/backup_test.py` in CI.

### 2.5 Restore procedure (RTO 4 h)
1. Stop the app: `pm2 stop wms`.
2. Pick the newest verified set; confirm: `BACKUP_DIR=<dir> npm run verify-backup`.
3. Restore DB: `cp <dir>/wms-<stamp>.db "$DB_PATH"` (back up the current file first
   as `$DB_PATH.pre-restore` — **never delete it blindly**).
4. Restore attachments: `rsync -a <dir>/attachments-<stamp>/ data/attachments/`.
5. Start: `pm2 start wms` → `curl -fsS https://wms.kynox.io/healthz`.
6. Smoke test (section 3.4). Record RPO actually achieved (age of the set used).

> The restore **test/drill** never overwrites production — it runs in a scratch
> dir via `verify-backup`. Only the real **restore procedure** above touches
> `$DB_PATH`, and only after backing the current file up.

---

## 3. Deployment & rollback (OPS-3)

### 3.1 Pre-deployment checks
- [ ] CI green on the commit being deployed (test + build-apk)
- [ ] `npm run verify-backup` passes (a good restore point exists)
- [ ] Note the currently deployed tag/commit for rollback
- [ ] Maintenance window / low-traffic time confirmed

### 3.2 Deploy
```bash
cd /path/to/WMS
BACKUP_DIR=/var/backups/wms npm run backup      # 1. fresh backup first
git fetch origin && git checkout <tag-or-sha>   # 2. exact revision
npm ci --omit=dev                               # 3. deps
npm run migrate                                 # 4. idempotent schema migrations
pm2 restart wms                                 # 5. restart
curl -fsS https://wms.kynox.io/healthz          # 6. health check
```
Tag the release: `git tag v1.0.0 && git push origin v1.0.0`.

### 3.3 APK validation
Install `app-arm64-v8a-release.apk` (or universal `app-release.apk`) from the
GitHub Release; confirm the SHA-256 matches the CI "APK checksums" step output.

### 3.4 Smoke test (post-deploy)
- `/healthz` 200 · login as admin · open a request list · open a request detail ·
  open the dashboard. (Automated equivalent: `npm run test:smoke` against staging.)

### 3.5 Rollback
```bash
pm2 stop wms
git checkout <previous-tag>
npm ci --omit=dev
# Schema: migrations are forward-only. If the bad deploy added a migration,
# do NOT auto-downgrade — restore the pre-deploy DB backup (section 2.5) instead.
pm2 start wms && curl -fsS https://wms.kynox.io/healthz
```
**DB rollback limitation:** there is no down-migration path. Roll back data only
by restoring the pre-deploy backup. This is why 3.2 step 1 (backup first) is
mandatory.

### 3.6 Secret rotation
- `JWT_SECRET`: generate `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
  set in env, `pm2 restart wms`. **Effect:** all existing sessions are invalidated
  (users re-login) — rotate during a quiet window.
- `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICES_JSON` (CI secret): rotate in
  the Firebase console, update env + GitHub secret, rebuild APK.

### 3.7 Incident escalation & recovery after a failed deploy
1. Health check fails after restart → check `pm2 logs wms --lines 200`.
2. If not fixable in minutes → **rollback (3.5)**; restore DB if a migration ran.
3. Escalate to the on-call owner (`ALERT_EMAIL`); record a short timeline.
4. After recovery, verify a fresh backup and file a follow-up for the root cause.
