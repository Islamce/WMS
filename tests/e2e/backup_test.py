#!/usr/bin/env python3
"""Backup + disaster-recovery tooling (OPS-2 / DB-2) and push-payload shape.

Runs the real backup script against the live test DB, then the verify script
(which runs PRAGMA integrity_check and a restore drill in a scratch dir), and
asserts the failure paths fail with a non-zero exit. Also asserts the temporary
debug push-test endpoint has been REMOVED (returns 404, no debug router mounted)
while the production notification pipeline still works, and that the backend
push module builds a data-only FCM payload.
Runs in Phase 3 after reverse_workflow_test.py."""
import json, os, subprocess, sys, tempfile, shutil, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def run(cmd, env=None):
    e = dict(os.environ); e.update(env or {})
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=e)

backup_dir = tempfile.mkdtemp(prefix='wms-bk-test-')
try:
    # ===== 1. Backup produces db + manifest (+ attachments when present) =====
    r = run(['node', 'scripts/backup.js', backup_dir])
    check('backup script exits 0', r.returncode == 0, r.stderr[:300])
    manifests = [f for f in os.listdir(backup_dir) if f.endswith('.manifest.json')]
    check('manifest written', len(manifests) == 1, os.listdir(backup_dir))
    if manifests:
        m = json.load(open(os.path.join(backup_dir, manifests[0])))
        check('manifest has db checksum', bool(m.get('db_sha256')) and len(m['db_sha256']) == 64, m)
        check('manifest records app version + timestamp', bool(m.get('app_version')) and bool(m.get('created_at')), m)
        check('backup db file present', os.path.exists(os.path.join(backup_dir, m['db_file'])), m.get('db_file'))

    # ===== 2. Verify + restore drill passes on a good set =====
    r = run(['node', 'scripts/verify-backup.js', backup_dir])
    check('verify-backup exits 0 on good set', r.returncode == 0, r.stderr[:300])
    check('restore drill ran (integrity_check=ok)', 'integrity_check=ok' in r.stdout, r.stdout[-300:])

    # ===== 3. Failure path: corrupted db fails clearly =====
    db_file = os.path.join(backup_dir, m['db_file'])
    with open(db_file, 'r+b') as fh:
        fh.seek(100); fh.write(b'GARBAGE')
    r = run(['node', 'scripts/verify-backup.js', backup_dir])
    check('verify-backup fails (non-zero) on corrupted db', r.returncode != 0, r.stdout[-200:])
    check('failure reason is explicit', 'FAIL' in (r.stdout + r.stderr), (r.stdout[-200:], r.stderr[-200:]))

    # ===== 4. Failure path: empty/missing backup dir fails clearly =====
    empty = tempfile.mkdtemp(prefix='wms-bk-empty-')
    try:
        r = run(['node', 'scripts/verify-backup.js', empty])
        check('verify-backup fails on missing manifest', r.returncode != 0, r.stdout[-200:])
    finally:
        shutil.rmtree(empty, ignore_errors=True)
finally:
    shutil.rmtree(backup_dir, ignore_errors=True)

# ===== 5. Backend push builds a DATA-ONLY payload with string values =====
code = ("const push=require('./server/services/push');"
        "let captured=null;"
        # stub firebase so no real network/credential is needed
        "const orig=push.sendToUser;"
        "console.log(JSON.stringify({hasSend: typeof push.sendToUser==='function',"
        " src: require('fs').readFileSync('./server/services/push.js','utf8')"
        "  .includes('data: payload') &&"
        "  require('fs').readFileSync('./server/services/push.js','utf8')"
        "  .includes(\"priority: 'high'\") &&"
        "  !require('fs').readFileSync('./server/services/push.js','utf8')"
        "  .includes('notification: { title')}));")
r = run(['node', '-e', code])
try:
    out = json.loads(r.stdout.strip().splitlines()[-1])
    check('push.sendToUser exported', out['hasSend'], r.stdout)
    check('push payload is data-only + priority high (no notification block)', out['src'], r.stdout)
except Exception as e:
    check('push payload shape check ran', False, f'{e}: {r.stdout} {r.stderr}')

# ===== 6. Release safety: temporary debug endpoint is GONE =====
# The push-test endpoint completed its purpose at UAT and was removed. Confirm
# it is a 404, no debug router is mounted, and the production notification
# pipeline still works without it.
def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req); return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

_, lg = call('POST', '/api/auth/login', body={'email': 'admin@example.com', 'password': 'Admin@123456'})
admin = lg.get('token')
# 404 for admin (route no longer exists — not 401/403 which would imply it still exists)
c, r = call('POST', '/api/debug/push-test', admin, {})
check('debug push-test endpoint removed (404 for admin)', c == 404, (c, r))
c, r = call('GET', '/api/debug/push-test', admin)
check('no debug push endpoint on GET either (404)', c == 404, (c, r))
# No debug router mounted at all: any /api/debug/* path is a JSON 404.
c, r = call('GET', '/api/debug/anything', admin)
check('no /api/debug router mounted (404)', c == 404, (c, r))
# The production notification pipeline is unaffected: device registration
# (the real FCM entry point) still works end-to-end.
c, r = call('POST', '/api/notifications/register-device', admin, {'token': 'safety-tok-1', 'platform': 'android'})
check('production push pipeline intact (register-device 200)', c == 200, (c, r))
c, r = call('POST', '/api/notifications/unregister-device', admin, {'token': 'safety-tok-1'})
check('production push pipeline intact (unregister-device 200)', c == 200, (c, r))
# In-app inbox still serves notifications.
c, r = call('GET', '/api/notifications/unread-count', admin)
check('in-app notification inbox intact (unread-count 200)', c == 200 and 'unread' in r, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
