#!/usr/bin/env python3
"""Password management tests:
 1. A user can change their own password (current password required).
 2. Wrong current password is rejected; too-short new password is rejected.
 3. Admin can reset another user's password; non-admin cannot.
"""
import json, urllib.request, urllib.error, os, sys

B = "http://localhost:3000"
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
    _, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return r.get('token')

admin = login('admin@example.com', 'Admin@123456')
picker = login('picker@example.com', 'Passw0rd!')

# ===== 1/2. Self change-password =====
c, r = call('PATCH', '/api/auth/password', picker, {'current_password': 'wrong', 'new_password': 'NewPass123'})
check('self change rejects wrong current password', c == 400, (c, r))
c, r = call('PATCH', '/api/auth/password', picker, {'current_password': 'Passw0rd!', 'new_password': 'short'})
check('self change rejects short new password', c == 400, (c, r))
c, r = call('PATCH', '/api/auth/password', picker, {'current_password': 'Passw0rd!', 'new_password': 'NewPass123'})
check('self change succeeds', c == 200, (c, r))
check('old password no longer works', login('picker@example.com', 'Passw0rd!') is None)
check('new password works', login('picker@example.com', 'NewPass123') is not None)

# ===== 3. Admin reset =====
# find the picker's user id
_, users = call('GET', '/api/users', admin)
picker_id = next(u['id'] for u in users['users'] if u['email'] == 'picker@example.com')
c, r = call('PATCH', f'/api/users/{picker_id}/password', admin, {'new_password': 'Reset9999'})
check('admin reset succeeds', c == 200, (c, r))
check('reset password works', login('picker@example.com', 'Reset9999') is not None)
# non-admin (a fresh picker token) cannot reset anyone
ptok = login('picker@example.com', 'Reset9999')
c, r = call('PATCH', f'/api/users/{picker_id}/password', ptok, {'new_password': 'Nope12345'})
check('non-admin cannot reset (403)', c == 403, (c, r))
# too-short reset rejected
c, r = call('PATCH', f'/api/users/{picker_id}/password', admin, {'new_password': 'x'})
check('admin reset rejects short password', c == 400, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
