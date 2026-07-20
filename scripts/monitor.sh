#!/usr/bin/env bash
# WMS production monitor — a dependency-free health/observability probe for the
# Hostinger VPS. Run it from cron every few minutes; it alerts (email via the
# system `mail`, if configured) when any signal is unhealthy. No credentials are
# hardcoded — everything comes from environment variables.
#
#   Cron example (every 5 min):
#   */5 * * * * ALERT_EMAIL=ops@yourco.com /path/to/WMS/scripts/monitor.sh >> /var/log/wms-monitor.log 2>&1
#
# Environment (all optional except where noted):
#   HEALTH_URL          health endpoint (default http://127.0.0.1:3000/healthz)
#   ALERT_EMAIL         recipient for alerts; if unset, alerts only go to stdout/log
#   PM2_APP             pm2 app name (default wms)
#   DISK_MIN_FREE_PCT   alert if free% on the app disk drops below this (default 15)
#   RESTART_MAX         alert if pm2 restarts exceed this since last check (default 5)
#   LOG_5XX_FILE        request log to scan for 5xx (default: pm2 stdout log)
#   LOG_5XX_MAX         alert if 5xx lines in the recent window exceed this (default 20)
#   BACKUP_DIR          if set, alert when the newest backup is older than 26h
#   STATE_DIR           where to persist counters between runs (default /tmp/wms-monitor)

set -uo pipefail
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
PM2_APP="${PM2_APP:-wms}"
DISK_MIN_FREE_PCT="${DISK_MIN_FREE_PCT:-15}"
RESTART_MAX="${RESTART_MAX:-5}"
LOG_5XX_MAX="${LOG_5XX_MAX:-20}"
STATE_DIR="${STATE_DIR:-/tmp/wms-monitor}"
mkdir -p "$STATE_DIR"
ALERTS=()

alert() { ALERTS+=("$1"); echo "[ALERT] $1"; }
info()  { echo "[ok] $1"; }

# 1) Health endpoint returns 200 + status ok
body=$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null)
if [ $? -ne 0 ] || ! echo "$body" | grep -q '"status":"ok"'; then
  alert "Health check FAILED at $HEALTH_URL"
else
  info "health ok"
fi

# 2) PM2 restart-loop visibility (needs pm2 + jq; skipped cleanly if absent)
if command -v pm2 >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  restarts=$(pm2 jlist 2>/dev/null | jq -r --arg n "$PM2_APP" '.[] | select(.name==$n) | .pm2_env.restart_time' | head -1)
  restarts="${restarts:-0}"
  prev=$(cat "$STATE_DIR/restarts" 2>/dev/null || echo "$restarts")
  echo "$restarts" > "$STATE_DIR/restarts"
  delta=$(( restarts - prev ))
  if [ "$delta" -ge "$RESTART_MAX" ]; then
    alert "PM2 '$PM2_APP' restarted $delta times since last check (possible crash loop)"
  else
    info "pm2 restarts delta=$delta"
  fi
else
  info "pm2/jq not available — restart check skipped"
fi

# 3) Disk-space risk on the app's filesystem
free_pct=$(df -P . | awk 'NR==2 {gsub(/%/,"",$5); print 100-$5}')
if [ -n "$free_pct" ] && [ "$free_pct" -lt "$DISK_MIN_FREE_PCT" ]; then
  alert "Low disk space: ${free_pct}% free (< ${DISK_MIN_FREE_PCT}%)"
else
  info "disk free=${free_pct}%"
fi

# 4) HTTP 5xx spike (scan recent request-log lines; app logs one line per request)
log5xx="${LOG_5XX_FILE:-$(pm2 jlist 2>/dev/null | jq -r --arg n "$PM2_APP" '.[] | select(.name==$n) | .pm2_env.pm_out_log_path' 2>/dev/null | head -1)}"
if [ -n "${log5xx:-}" ] && [ -f "$log5xx" ]; then
  n5xx=$(tail -n 2000 "$log5xx" | grep -cE ' 5[0-9][0-9] [0-9]+ms ' || true)
  if [ "$n5xx" -ge "$LOG_5XX_MAX" ]; then
    alert "HTTP 5xx spike: $n5xx server errors in the last 2000 log lines"
  else
    info "5xx count=$n5xx"
  fi
else
  info "request log not found — 5xx check skipped"
fi

# 5) Backup freshness (alert if newest backup older than ~26h → RPO 24h breached)
if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
  newest=$(find "$BACKUP_DIR" -name 'wms-*.db' -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
  if [ -z "$newest" ]; then
    alert "No backups found in $BACKUP_DIR"
  else
    age_h=$(( ( $(date +%s) - ${newest%.*} ) / 3600 ))
    if [ "$age_h" -gt 26 ]; then alert "Newest backup is ${age_h}h old (RPO 24h at risk)"; else info "backup age=${age_h}h"; fi
  fi
fi

# Dispatch alerts (email if ALERT_EMAIL + mail are available; always to stdout/log)
if [ "${#ALERTS[@]}" -gt 0 ]; then
  msg=$(printf 'WMS monitor detected %d issue(s) on %s:\n\n%s\n' "${#ALERTS[@]}" "$(hostname)" "$(printf '  - %s\n' "${ALERTS[@]}")")
  if [ -n "${ALERT_EMAIL:-}" ] && command -v mail >/dev/null 2>&1; then
    echo "$msg" | mail -s "[WMS ALERT] ${#ALERTS[@]} issue(s) on $(hostname)" "$ALERT_EMAIL"
  fi
  exit 1
fi
info "all checks passed"
exit 0
