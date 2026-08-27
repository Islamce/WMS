#!/usr/bin/env python3
"""Password management tests:
 1. A user can change their own password (current password required).
 2. Wrong current password is rejected; too-short new password is rejected.
 3. Admin can reset another user's password; non-admin cannot.
"""
import json, urllib.request, urllib.error, os, subprocess, sys

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

# ===== 4. Credential lifecycle + audit (issue #40) =====
# An admin knows the interim password, so the account is not solely the user's
# until they change it. The force-change flag is what makes that true.
c, r = call('PATCH', f'/api/users/{picker_id}/password', admin, {'new_password': 'Interim777'})
check('admin reset succeeds (lifecycle)', c == 200, (c, r))
_, me = call('POST', '/api/auth/login', body={'email': 'picker@example.com', 'password': 'Interim777'})
check('admin reset forces a password change',
      me.get('user', {}).get('must_change_password') is True, me)

# The self-service change is what clears it.
ptok = me.get('token')
c, r = call('PATCH', '/api/auth/password', ptok, {'current_password': 'Interim777', 'new_password': 'Mine55555'})
check('self change after admin reset succeeds', c == 200, (c, r))
_, me2 = call('POST', '/api/auth/login', body={'email': 'picker@example.com', 'password': 'Mine55555'})
check('self change clears the force-change flag',
      me2.get('user', {}).get('must_change_password') is False, me2)

# ===== 4B. Self-service display-name update (PATCH /api/auth/me) =====
ptok2 = me2.get('token')
c, r = call('PATCH', '/api/auth/me', ptok2, {'name': 'Pat the Picker'})
check('self profile update succeeds', c == 200 and r.get('user', {}).get('name') == 'Pat the Picker', (c, r))
_, refreshed = call('GET', '/api/auth/me', ptok2)
check('updated name persists on /auth/me', refreshed.get('user', {}).get('name') == 'Pat the Picker', refreshed)
c, r = call('PATCH', '/api/auth/me', ptok2, {'name': '  '})
check('blank name is rejected (400)', c == 400, (c, r))
c, r = call('PATCH', '/api/auth/me', None, {'name': 'Nobody'})
check('profile update requires auth (401)', c == 401, (c, r))
c, r = call('PATCH', '/api/auth/me', ptok2, {'email': 'picker-new@example.com'})
check('email is not accepted for self-service update (400, name still required)', c == 400, (c, r))

# Both events are audited, and neither stores the password or its hash.
_, aud = call('GET', '/api/master/audit?limit=100&entity_type=User', admin)
rows = aud.get('audit') or []
actions = [x.get('action') for x in rows]
check('admin reset is audited', 'PASSWORD_RESET_BY_ADMIN' in actions, actions[:12])
check('self change is audited', 'PASSWORD_CHANGED_BY_SELF' in actions, actions[:12])
check('self profile update is audited', 'PROFILE_UPDATED_BY_SELF' in actions, actions[:12])
blob = json.dumps(rows)
for secret in ('Interim777', 'Mine55555', '$2a$', '$2b$'):
    check(f'audit trail does not contain {secret!r}', secret not in blob)

# ===== 5. reset-admin refuses unsafe production use (issue #40) =====
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def reset_admin(args, production=True):
    env = dict(os.environ)
    env['NODE_ENV'] = 'production' if production else 'development'
    env.setdefault('JWT_SECRET', 'x' * 48)
    return subprocess.run(['node', 'scripts/reset-admin.js', *args], cwd=ROOT,
                          capture_output=True, text=True, env=env)

r = reset_admin([])
check('reset-admin refuses bare invocation in production', r.returncode != 0, r.stdout[-200:])
r = reset_admin(['admin@example.com', 'Str0ngPass1', 'RESET ADMIN PASSWORD'])
check('reset-admin refuses the default email in production', r.returncode != 0, r.stdout[-200:])
r = reset_admin(['real@corp.com', 'Admin@123456', 'RESET ADMIN PASSWORD'])
check('reset-admin refuses the default password in production', r.returncode != 0, r.stdout[-200:])
r = reset_admin(['real@corp.com', 'Str0ngPass1'])
check('reset-admin refuses without typed confirmation', r.returncode != 0, r.stdout[-200:])
r = reset_admin(['real@corp.com', 'Str0ngPass1', 'reset admin password'])
check('reset-admin confirmation is case-sensitive', r.returncode != 0, r.stdout[-200:])
check('refusal never prints the supplied password',
      'Str0ngPass1' not in (r.stdout + r.stderr))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
