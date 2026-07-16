#!/usr/bin/env python3
"""UAT round-2 regressions (MUST run last — it factory-resets the database):
 1. Cycle-count post is blocked when the counted qty is below reserved stock.
 2. Factory reset: admin-only, typed confirmation; clears transactional +
    sample master data; keeps users/roles/permissions/movement types; records
    DATA_RESET in the fresh audit trail; imports then accept new data.
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
    c, p = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return p.get('token')

admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')

# ===== 1. Cycle-count guard: counted below reserved is rejected =====
_, r = call('GET', '/api/master/batches?search=MAT-0001', admin)
reserved_batches = [b for b in r['batches'] if (b.get('reserved_quantity') or 0) > 0]
check('found a batch with open reservations', len(reserved_batches) >= 1,
      [(b['batch_number'], b['reserved_quantity']) for b in r['batches']])
if reserved_batches:
    b = reserved_batches[0]
    c, cc = call('POST', '/api/cycle-count', supervisor, {'batch_id': b['id']})
    check('cycle count opened on reserved batch', c == 201, (c, cc))
    call('POST', f"/api/cycle-count/{cc['id']}/count", supervisor, {'counted_quantity': 0})
    c, r2 = call('POST', f"/api/cycle-count/{cc['id']}/post", supervisor)
    check('post below reserved is blocked (400)', c == 400 and 'reserved' in r2.get('error', '').lower(), (c, r2))
    # a sane count (>= reserved) still posts
    c, cc2 = call('POST', '/api/cycle-count', supervisor, {'batch_id': b['id']})
    call('POST', f"/api/cycle-count/{cc2['id']}/count", supervisor, {'counted_quantity': b['remaining_quantity']})
    c, r2 = call('POST', f"/api/cycle-count/{cc2['id']}/post", supervisor)
    check('post at/above reserved succeeds', c == 200, (c, r2))

# ===== 2. Factory reset =====
c, r = call('POST', '/api/admin/factory-reset', requester, {'confirm': 'RESET'})
check('factory reset blocked for non-admin (403)', c == 403, (c, r))
c, r = call('POST', '/api/admin/factory-reset', admin, {'confirm': 'nope'})
check('factory reset requires typed RESET (400)', c == 400, (c, r))
c, r = call('POST', '/api/admin/factory-reset', admin, {'confirm': 'RESET'})
check('factory reset succeeds for admin', c == 200 and r.get('cleared'), (c, r))

c, r = call('GET', '/api/materials?page=1', admin)
check('materials cleared', c == 200 and (r.get('total') == 0 or len(r.get('materials', [])) == 0), (c, r))
c, r = call('GET', '/api/master/batches', admin)
check('batches cleared', c == 200 and len(r.get('batches', [])) == 0, (c, r))
c, r = call('GET', '/api/requests?page=1', admin)
check('requests cleared', c == 200 and r.get('total') == 0, (c, r))
c, r = call('GET', '/api/master/movement-types', admin)
check('movement types (config) kept', c == 200 and len(r.get('movement_types', [])) >= 5, (c, r))
tok = login('supervisor@example.com', 'Passw0rd!')
check('users kept — supervisor still logs in', bool(tok))
c, r = call('GET', '/api/master/audit?action=DATA_RESET', admin)
check('DATA_RESET recorded in fresh audit trail', c == 200 and len(r.get('audit', [])) >= 1, (c, r))

# system now accepts the new (real) database via the Import Center
c, r = call('POST', '/api/import/warehouses', admin, {'rows': [
    {'warehouse_code': 'RW01', 'warehouse_name': 'Real Warehouse 1', 'plant': 'P900', 'storage_location': '0001'}]})
check('import warehouses into clean DB', c == 200 and r.get('created') == 1, (c, r))
c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code': 'REAL-0001', 'description': 'Real material', 'unit': 'EA', 'price': 1.5}]})
check('import materials into clean DB', c == 200 and r.get('created') == 1, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
