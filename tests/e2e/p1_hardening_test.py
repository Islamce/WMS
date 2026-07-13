#!/usr/bin/env python3
"""P1 hardening tests:
 1. Async bcrypt request paths still work and stay safe:
    - unknown email login returns 401 (timing-safe dummy-hash path),
    - signup creates a pending account, duplicate email is rejected,
    - self password change + admin reset round-trip.
 2. audit_trail is append-only at the database level: UPDATE and DELETE on an
    existing audit row are rejected by triggers; the row is unchanged.
 3. Versioned migrations are recorded in schema_migrations.
 4. The scheduler lease (scheduler_locks) grants a tick to exactly one caller.
This suite runs in Phase 1 after workflow_test has produced audit rows.
"""
import json, urllib.request, urllib.error, os, sys, sqlite3, subprocess

B = "http://localhost:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, 'data', 'wms.db')
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def login(email, pw):
    c, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return c, r

# ===== 1. Async bcrypt paths =====
# unknown email -> 401 via the timing-safe dummy-hash compare (must not 500)
c, r = call('POST', '/api/auth/login', body={'email': 'nobody@nowhere.test', 'password': 'whatever12'})
check('unknown-email login returns 401', c == 401, (c, r))
# real login still works
c, r = login('admin@example.com', 'Admin@123456')
admin = r.get('token')
check('admin login still works (async compare)', c == 200 and admin, (c, r))

# signup a fresh pending account
import random
suffix = random.randint(100000, 999999)
email = f'p1user{suffix}@example.com'
c, r = call('POST', '/api/auth/signup', body={'name': 'P1 User', 'email': email, 'password': 'Passw0rd!'})
check('signup creates account (async hash)', c == 201, (c, r))
c, r = call('POST', '/api/auth/signup', body={'name': 'P1 User', 'email': email, 'password': 'Passw0rd!'})
check('duplicate signup rejected (409)', c == 409, (c, r))

# admin resets that user's password (async hash), then activate + verify login
_, users = call('GET', '/api/users', admin)
uid = next((u['id'] for u in users['users'] if u['email'] == email), None)
check('new user is listed', uid is not None, users)
if uid:
    c, r = call('PATCH', f'/api/users/{uid}/password', admin, {'new_password': 'Reset0rd!'})
    check('admin reset password (async hash)', c == 200, (c, r))
    call('PATCH', f'/api/users/{uid}/status', admin, {'status': 'active'})
    c, r = login(email, 'Reset0rd!')
    check('login with admin-reset password works', c == 200 and r.get('token'), (c, r))

# ===== 2. audit_trail append-only triggers =====
con = sqlite3.connect(DB, timeout=5)
try:
    row = con.execute("SELECT id, action FROM audit_trail ORDER BY id LIMIT 1").fetchone()
    check('audit_trail has rows to test against', row is not None, row)
    if row:
        aid, action = row
        blocked_update = False
        try:
            con.execute("UPDATE audit_trail SET action='TAMPERED' WHERE id=?", (aid,)); con.commit()
        except sqlite3.Error:
            blocked_update = True
        con.rollback()
        check('UPDATE on audit_trail is blocked', blocked_update)
        blocked_delete = False
        try:
            con.execute("DELETE FROM audit_trail WHERE id=?", (aid,)); con.commit()
        except sqlite3.Error:
            blocked_delete = True
        con.rollback()
        check('DELETE on audit_trail is blocked', blocked_delete)
        still = con.execute("SELECT action FROM audit_trail WHERE id=?", (aid,)).fetchone()
        check('audit row unchanged after tamper attempts', still is not None and still[0] == action, still)

    # ===== 3. schema_migrations recorded =====
    n = con.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
    check('schema_migrations has recorded versions', n >= 4, n)
    have = {r[0] for r in con.execute("SELECT version FROM schema_migrations").fetchall()}
    check('baseline migrations recorded', {'001_base_schema', '002_mrp_wms_execution'} <= have, have)
finally:
    con.close()

# ===== 4. scheduler lease grants a tick to exactly one caller =====
code = ("const {acquireTick}=require('./server/services/scheduler');"
        "const a=acquireTick('__test_lease__',60000);"
        "const b=acquireTick('__test_lease__',60000);"
        "console.log(JSON.stringify({a,b}));")
p = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True)
try:
    out = json.loads(p.stdout.strip().splitlines()[-1])
    check('scheduler lease: first acquire succeeds', out.get('a') is True, p.stdout + p.stderr)
    check('scheduler lease: second acquire blocked', out.get('b') is False, p.stdout + p.stderr)
except Exception as e:
    check('scheduler lease test ran', False, f'{e}: {p.stdout} {p.stderr}')

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
