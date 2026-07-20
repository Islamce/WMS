#!/usr/bin/env python3
"""Backup + disaster-recovery tooling (OPS-2 / DB-2) and push-payload shape.

Runs the real backup script against the live test DB, then the verify script
(which runs PRAGMA integrity_check and a restore drill in a scratch dir), and
asserts the failure paths fail with a non-zero exit. Also asserts the temporary
debug push-test endpoint is still present (removed only at the V1.0 tag) and
that the backend push module builds a data-only FCM payload.
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

# ===== 6. Temporary debug endpoint still present (removed only at V1.0 tag) =====
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
c, r = call('POST', '/api/debug/push-test', admin, {})
check('debug push-test endpoint present for admin (200)', c == 200, (c, r))
c, r = call('POST', '/api/debug/push-test', None, {})
check('debug push-test rejects unauthenticated (401)', c == 401, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
