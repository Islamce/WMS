#!/usr/bin/env python3
"""P0 regression tests:
 1. Re-allocation must NOT double-count batch reservations.
 2. Cancelling a request must release its batch reservations.
 3. Login brute-force protection (429 after repeated failures).
 4. JWT_SECRET production guard (server refuses to boot without a real secret).
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
requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')

def bolt_reserved():
    """Total reserved_quantity across MAT-0001 batches."""
    _, r = call('GET', '/api/master/batches?search=MAT-0001', admin)
    return sum(b['reserved_quantity'] for b in r['batches'])

def make_allocated_request(qty):
    """Create request -> approve -> ERP -> send to warehouse -> allocate."""
    _, r = call('POST', '/api/requests', requester,
                {'purpose': 'p0 regression', 'lines': [{'material_id': BOLT, 'requested_quantity': qty}]})
    rid = r['id']
    call('POST', f'/api/requests/{rid}/submit', requester)
    call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
    call('PATCH', f'/api/erp-operator/{rid}', erp, {
        'erp_reservation_number': 'RES-P0', 'movement_type': '201', 'plant': 'P100',
        'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
    call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
    c, r = call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
    return rid, c

_, r = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = r['materials'][0]['id']

# ===== 1. Re-allocation must not double-reserve =====
base = bolt_reserved()
rid, c = make_allocated_request(20)
check('P0-1 allocation succeeded', c == 200, c)
after_first = bolt_reserved()
check('P0-1 first allocation reserves 20', abs(after_first - base - 20) < 0.001, (base, after_first))

# re-run allocation (status allows it) — reserved total must stay the same
c, r = call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
check('P0-1 re-allocation succeeded', c == 200, r)
after_second = bolt_reserved()
check('P0-1 re-allocation does NOT double-reserve', abs(after_second - after_first) < 0.001,
      (after_first, after_second))

# ===== 2. Cancel must release reservations =====
c, r = call('POST', f'/api/requests/{rid}/cancel', requester, {'reason': 'p0 test'})
check('P0-2 cancel succeeded', c == 200, r)
check('P0-2 cancel released reservations', abs(bolt_reserved() - base) < 0.001,
      (base, bolt_reserved()))

# ===== 3. Login brute-force protection =====
for i in range(10):
    call('POST', '/api/auth/login', body={'email': 'bruteforce@example.com', 'password': 'wrong'})
c, r = call('POST', '/api/auth/login', body={'email': 'bruteforce@example.com', 'password': 'wrong'})
check('P0-3 11th failed attempt rate-limited (429)', c == 429, (c, r))
# other accounts unaffected
check('P0-3 other accounts unaffected', login('admin@example.com', 'Admin@123456') is not None)

# ===== 4. JWT production guard =====
env = dict(os.environ, NODE_ENV='production')
env.pop('JWT_SECRET', None)
p = subprocess.run(['node', '-e', "require('./server/config')"], env=env,
                   capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
check('P0-4 production boot blocked without JWT_SECRET', p.returncode != 0 and 'JWT_SECRET' in p.stderr, p.returncode)
env['JWT_SECRET'] = 'x' * 48
p = subprocess.run(['node', '-e', "require('./server/config')"], env=env,
                   capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
check('P0-4 production boot allowed with real JWT_SECRET', p.returncode == 0, p.stderr[:200])

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
