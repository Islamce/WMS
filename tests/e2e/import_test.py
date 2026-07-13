#!/usr/bin/env python3
"""Import Center + locations-from-bins tests:
 1. /api/import/meta lists importable entities for the user.
 2. Bulk import materials, warehouses, bins, movement types (create + update).
 3. Opening-stock import creates a batch and shows up in locations overview.
 4. All Locations overview is sourced from bin_locations + batches.
 5. Import permission is enforced (picker cannot import materials).
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

# ===== 1. meta =====
c, r = call('GET', '/api/import/meta', admin)
keys = [e['key'] for e in r.get('entities', [])]
check('meta lists entities for admin', c == 200 and 'materials' in keys and 'stock' in keys, keys)

# ===== 2. import materials (create then update) =====
c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code': 'IMP-001', 'description': 'Imported bolt', 'unit': 'EA', 'material_group': 'FASTENERS'},
    {'item_code': 'IMP-002', 'description': 'Imported oil', 'unit': 'L'},
    {'description': 'missing code'},  # error row
]})
check('materials import: 2 created, 1 error', c == 200 and r['created'] == 2 and r['errors'] == 1, r)
c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code': 'IMP-001', 'description': 'Imported bolt v2', 'unit': 'EA'},
]})
check('materials import: re-upload updates', c == 200 and r['updated'] == 1, r)

# ===== 3. warehouses + bins =====
c, r = call('POST', '/api/import/warehouses', admin, {'rows': [
    {'warehouse_code': 'WH-IMP', 'warehouse_name': 'Imported WH', 'plant': 'P100'},
]})
check('warehouses import created', c == 200 and r['created'] == 1, r)
c, r = call('POST', '/api/import/bins', admin, {'rows': [
    {'warehouse_code': 'WH-IMP', 'bin_code': 'A-01', 'full_bin_location': 'WH-IMP-A-01', 'capacity': '100'},
    {'warehouse_code': 'NOPE', 'bin_code': 'X'},  # unknown warehouse -> error
]})
check('bins import: 1 created, 1 error', c == 200 and r['created'] == 1 and r['errors'] == 1, r)

# ===== 4. movement types =====
c, r = call('POST', '/api/import/movement-types', admin, {'rows': [
    {'code': '999', 'description': 'Import test mvt', 'direction': 'ISSUE'},
    {'code': '998', 'description': 'bad dir', 'direction': 'SIDEWAYS'},  # error
]})
check('movement-types import: 1 created, 1 error', c == 200 and r['created'] == 1 and r['errors'] == 1, r)

# ===== 5. opening stock -> batch -> locations overview =====
c, r = call('POST', '/api/import/stock', admin, {'rows': [
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'batch_number': 'OPEN-IMP-001',
     'quantity': '250', 'bin_location': 'WH-IMP-A-01', 'quality_status': 'RELEASED'},
]})
check('opening stock import created batch', c == 200 and r['created'] == 1, r)
# batch visible in batch tracking
c, r = call('GET', '/api/master/batches?search=IMP-001', admin)
check('imported batch appears in batch tracking', c == 200 and any(b['batch_number'] == 'OPEN-IMP-001' for b in r['batches']), r)

# ===== 6. locations overview sourced from bins + batches =====
c, r = call('GET', '/api/locations/overview', admin)
locs = r.get('locations', [])
imp_bin = next((l for l in locs if l['code'] == 'WH-IMP-A-01'), None)
check('locations overview lists master bin', imp_bin is not None, [l['code'] for l in locs][:10])
check('locations overview shows materials in bin',
      imp_bin and imp_bin['materials_count'] >= 1 and any(m['item_code'] == 'IMP-001' for m in imp_bin['materials']), imp_bin)
check('locations overview carries warehouse', imp_bin and imp_bin.get('warehouse_code') == 'WH-IMP', imp_bin)

# ===== 7. permission enforcement =====
c, r = call('POST', '/api/import/materials', picker, {'rows': [{'item_code': 'X', 'description': 'y'}]})
check('picker cannot import materials (403)', c == 403, (c, r))
c, r = call('GET', '/api/import/meta', picker)
check('picker meta excludes materials', 'materials' not in [e['key'] for e in r.get('entities', [])], r)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
