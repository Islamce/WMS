#!/usr/bin/env bash
# WMS end-to-end test runner (used by `npm test` and CI).
#
# Phase 1 (fresh DB): 25-scenario workflow regression + UI-refinement suite
#                     + P0 regression (reservation leaks, rate limit, JWT guard).
# Phase 2 (fresh DB): feature suite (AI analytics, PDF labels, mass upload,
#                     quality step) — needs its own clean dataset.
set -u
cd "$(dirname "$0")/.."
export no_proxy=localhost NO_PROXY=localhost
PY=${PYTHON:-python3}
FAILED=0
SERVER_PID=""

fresh_db() {
  rm -f data/wms.db data/wms.db-shm data/wms.db-wal
  node server/db/migrate.js >/dev/null && node server/db/seed.js >/dev/null
}

start_server() {
  node index.js > /tmp/wms-test-server.log 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "Server failed to start:"; tail -20 /tmp/wms-test-server.log
  return 1
}

stop_server() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
}
trap stop_server EXIT

run_suite() {
  echo ""
  echo "========== $1 =========="
  if ! "$PY" "tests/e2e/$1"; then FAILED=1; fi
}

echo "=== Phase 1: workflow + refinements + P0 regression ==="
fresh_db || exit 1
start_server || exit 1
run_suite workflow_test.py
run_suite refinements_test.py
run_suite p0_regression_test.py
run_suite p1_regression_test.py
run_suite password_test.py
run_suite reports_test.py
run_suite p0_hardening_test.py
run_suite p1_hardening_test.py
run_suite quickwins_test.py
stop_server

echo ""
echo "=== Phase 2: feature suite (clean dataset) ==="
fresh_db || exit 1
start_server || exit 1
run_suite features_test.py
run_suite import_test.py
stop_server

echo ""
echo "=== Phase 3: P2/P3 enterprise suite (clean dataset) ==="
fresh_db || exit 1
start_server || exit 1
run_suite p2_test.py
run_suite p3_test.py
run_suite uat_test.py
run_suite r3_test.py
run_suite uat2_test.py   # keep LAST — it factory-resets the database
stop_server

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL TEST SUITES PASSED"
else
  echo "❌ TEST FAILURES — see output above"
fi
exit $FAILED
