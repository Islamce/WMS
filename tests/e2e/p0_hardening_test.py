#!/usr/bin/env python3
"""P0 hardening tests:
 1. Seeded admin is flagged must_change_password; changing it clears the flag.
 2. Reservation-timeout sweep releases stale reservations and puts the request
    On Hold, returning stock to available.
 3. The backup script produces a valid SQLite snapshot.
This test restores the admin password so later suites keep working.
"""
import json, urllib.request, urllib.error, os, sys, subprocess, tempfile, glob

B = "http://localhost:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
    return r

# ===== 1. Forced admin password change =====
r = login('admin@example.com', 'Admin@123456')
admin = r.get('token')
check('admin login flagged must_change_password', r['user'].get('must_change_password') is True, r['user'])
c, me = call('GET', '/api/auth/me', admin)
check('/auth/me exposes the flag', me['user'].get('must_change_password') in (1, True), me['user'])
# change it -> flag clears
c, r = call('PATCH', '/api/auth/password', admin, {'current_password': 'Admin@123456', 'new_password': 'TempPass123'})
check('admin can change password', c == 200, r)
r2 = login('admin@example.com', 'TempPass123')
check('flag cleared after change', r2['user'].get('must_change_password') is False, r2['user'])
# restore original password so the rest of the suite works
call('PATCH', '/api/auth/password', r2['token'], {'current_password': 'TempPass123', 'new_password': 'Admin@123456'})
admin = login('admin@example.com', 'Admin@123456')['token']

# ===== 2. Reservation-timeout sweep =====
requester = login('requester@example.com', 'Passw0rd!')['token']
manager = login('manager@example.com', 'Passw0rd!')['token']
erp = login('erp@example.com', 'Passw0rd!')['token']
supervisor = login('supervisor@example.com', 'Passw0rd!')['token']
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

def bolt_reserved():
    _, r = call('GET', '/api/master/batches?search=MAT-0001', admin)
    return sum(b['reserved_quantity'] for b in r['batches'])

base = bolt_reserved()
_, r = call('POST', '/api/requests', requester, {'purpose': 'ttl', 'lines': [{'material_id': BOLT, 'requested_quantity': 12}]})
rid = r['id']
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{rid}', erp, {'erp_reservation_number': 'RES-TTL', 'movement_type': '201', 'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
after_alloc = bolt_reserved()
check('reservation held after allocate', after_alloc - base >= 12 - 0.001, (base, after_alloc))
_, det0 = call('GET', f'/api/requests/{rid}', requester)
req_no = det0['request']['request_number']
# sweep with the clock fast-forwarded 25h (releases all stale reservations)
c, r = call('POST', '/api/warehouse/sweep-reservations', supervisor, {'testMinutes': 1500})
check('sweep released our request', c == 200 and any(x['request'] == req_no for x in r['released']), r)
# our 12 units returned to available (peak dropped by at least our reservation)
check('reservation returned to available', after_alloc - bolt_reserved() >= 12 - 0.001, (after_alloc, bolt_reserved()))
_, det = call('GET', f'/api/requests/{rid}', requester)
check('request moved to On Hold', det['request']['request_status'] == 'On Hold', det['request']['request_status'])
# a user without bin_batch_assignment (manager) cannot run the sweep
c, r = call('POST', '/api/warehouse/sweep-reservations', manager, {'testMinutes': 1500})
check('sweep requires permission (403)', c == 403, c)

# ===== 3. Backup script =====
dest = tempfile.mkdtemp(prefix='wms-bak-')
p = subprocess.run(['node', 'scripts/backup.js', dest], cwd=ROOT, capture_output=True, text=True)
check('backup script exits 0', p.returncode == 0, p.stderr[:200])
files = glob.glob(os.path.join(dest, 'wms-*.db'))
check('backup file created', len(files) == 1, files)
if files:
    with open(files[0], 'rb') as fh:
        magic = fh.read(16)
    check('backup is a valid SQLite file', magic.startswith(b'SQLite format 3'), magic)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
