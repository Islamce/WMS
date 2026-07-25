#!/usr/bin/env python3
"""Import Center and opening-stock regression tests."""
import json, urllib.request, urllib.error, os, sys, sqlite3

B = "http://localhost:3000"
DB = "data/wms.db"
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

def scalar(sql, params=()):
    with sqlite3.connect(DB) as conn:
        return conn.execute(sql, params).fetchone()[0]

admin = login('admin@example.com', 'Admin@123456')
picker = login('picker@example.com', 'Passw0rd!')

# Meta and supporting master data.
c, r = call('GET', '/api/import/meta', admin)
keys = [e['key'] for e in r.get('entities', [])]
check('meta lists entities for admin', c == 200 and 'materials' in keys and 'stock' in keys, keys)

c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code': 'IMP-001', 'description': 'Imported bolt', 'unit': 'EA', 'material_group': 'FASTENERS'},
    {'item_code': 'IMP-002', 'description': 'Imported oil', 'unit': 'L'},
    {'description': 'missing code'},
]})
check('materials import: 2 created, 1 error', c == 200 and r['created'] == 2 and r['errors'] == 1, r)

c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code': 'IMP-001', 'description': 'Imported bolt v2', 'unit': 'EA'},
]})
check('materials import: re-upload updates', c == 200 and r['updated'] == 1, r)

c, r = call('POST', '/api/import/warehouses', admin, {'rows': [
    {'warehouse_code': 'WH-IMP', 'warehouse_name': 'Imported WH', 'plant': 'P100'},
    {'warehouse_code': 'WH-OTHER', 'warehouse_name': 'Other WH', 'plant': 'P100'},
]})
check('warehouses import created', c == 200 and r['created'] == 2, r)

c, r = call('POST', '/api/import/bins', admin, {'rows': [
    {'warehouse_code': 'WH-IMP', 'bin_code': 'A-01', 'full_bin_location': 'WH-IMP-A-01', 'capacity': '100'},
    {'warehouse_code': 'WH-IMP', 'bin_code': 'A-02', 'full_bin_location': 'WH-IMP-A-02', 'capacity': '100'},
    {'warehouse_code': 'WH-OTHER', 'bin_code': 'B-01', 'full_bin_location': 'WH-OTHER-B-01', 'capacity': '100'},
    {'warehouse_code': 'NOPE', 'bin_code': 'X'},
]})
check('bins import: 3 created, 1 error', c == 200 and r['created'] == 3 and r['errors'] == 1, r)

# Opening stock: new row, bin-level balance, ledger, dashboard and occupied bin.
c, r = call('POST', '/api/import/stock', admin, {'rows': [
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'batch_number': 'OPEN-IMP-001-A',
     'quantity': '250', 'bin_location': 'WH-IMP-A-01', 'quality_status': 'RELEASED'},
]})
check('new opening stock created', c == 200 and r['created'] == 1 and r['errors'] == 0, r)
check('material_location_stock created for imported bin', scalar('''SELECT COALESCE(SUM(mls.quantity),0)
    FROM material_location_stock mls JOIN materials m ON m.id=mls.material_id
    JOIN locations l ON l.id=mls.location_id WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 250)
check('stock transaction uses imported bin', scalar('''SELECT COUNT(*) FROM stock_transactions st
    JOIN materials m ON m.id=st.material_id JOIN locations l ON l.id=st.location_id
    WHERE m.item_code=? AND l.code=? AND st.transaction_type='IN' AND st.quantity=250''', ('IMP-001','WH-IMP-A-01')) == 1)

# Repeated import is additive and updates the existing bin-specific batch.
c, r = call('POST', '/api/import/stock', admin, {'rows': [
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'batch_number': 'OPEN-IMP-001-A',
     'quantity': '50', 'bin_location': 'WH-IMP-A-01'},
]})
check('repeated opening stock updates existing batch', c == 200 and r['updated'] == 1, r)
check('repeated import updates location stock', scalar('''SELECT mls.quantity FROM material_location_stock mls
    JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
    WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 300)

# Multiple bins and comma-formatted quantity.
c, r = call('POST', '/api/import/stock', admin, {'rows': [
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'batch_number': 'OPEN-IMP-001-B',
     'quantity': '1,250.50', 'bin_location': 'WH-IMP-A-02'},
]})
check('comma-formatted quantity imported', c == 200 and r['created'] == 1, r)
check('multiple bins maintain separate balances', abs(scalar('''SELECT mls.quantity FROM material_location_stock mls
    JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
    WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-02')) - 1250.5) < 0.0001)

# Row-level validation errors do not block valid rows.
c, r = call('POST', '/api/import/stock', admin, {'rows': [
    {'material_code': 'UNKNOWN', 'warehouse_code': 'WH-IMP', 'quantity': '1', 'bin_location': 'WH-IMP-A-01'},
    {'material_code': 'IMP-001', 'warehouse_code': 'UNKNOWN', 'quantity': '1', 'bin_location': 'WH-IMP-A-01'},
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'quantity': '1', 'bin_location': 'UNKNOWN-BIN'},
    {'material_code': 'IMP-001', 'warehouse_code': 'WH-IMP', 'quantity': '1', 'bin_location': 'WH-OTHER-B-01'},
    {'material_code': 'IMP-002', 'warehouse_code': 'WH-IMP', 'quantity': '10', 'bin_location': 'WH-IMP-A-01'},
]})
messages = [x.get('message','') for x in r.get('results', []) if x.get('status') == 'error']
check('invalid stock rows preserved as row-level errors', c == 200 and r['created'] == 1 and r['errors'] == 4, r)
check('unknown material validation', any('unknown material' in x for x in messages), messages)
check('unknown warehouse validation', any('unknown warehouse' in x for x in messages), messages)
check('unknown bin validation', any('unknown bin' in x for x in messages), messages)
check('cross-warehouse bin validation', any('does not belong' in x for x in messages), messages)

# Dashboard totals and occupied bins reflect the imports.
c, r = call('GET', '/api/dashboard', admin)
check('dashboard stock total after import', c == 200 and abs(r['kpis']['total_stock'] - 1560.5) < 0.0001, r.get('kpis'))
check('dashboard occupied-bin count after import', c == 200 and r['kpis']['occupied_locations'] >= 2, r.get('kpis'))
c, r = call('GET', '/api/dashboard/bins?status=occupied', admin)
occupied = {b['full_bin_location'] for b in r.get('bins', [])}
check('occupied-bin drilldown includes imported bins', {'WH-IMP-A-01','WH-IMP-A-02'}.issubset(occupied), occupied)

# Unexpected DB failure must roll back batch, balance and transaction together.
before_batches = scalar("SELECT COUNT(*) FROM batches WHERE batch_number='ROLLBACK-BATCH'")
before_stock = scalar('''SELECT COALESCE(SUM(mls.quantity),0) FROM material_location_stock mls
    JOIN materials m ON m.id=mls.material_id WHERE m.item_code='IMP-002' ''')
before_tx = scalar('''SELECT COUNT(*) FROM stock_transactions st JOIN materials m ON m.id=st.material_id
    WHERE m.item_code='IMP-002' ''')
with sqlite3.connect(DB) as conn:
    conn.execute("CREATE TRIGGER fail_opening_stock_tx BEFORE INSERT ON stock_transactions BEGIN SELECT RAISE(ABORT, 'forced opening stock failure'); END")
try:
    c, r = call('POST', '/api/import/stock', admin, {'rows': [
        {'material_code': 'IMP-002', 'warehouse_code': 'WH-IMP', 'batch_number': 'ROLLBACK-BATCH',
         'quantity': '99', 'bin_location': 'WH-IMP-A-02'},
    ]})
    check('database failure returns server error', c == 500 and 'forced opening stock failure' in r.get('error',''), (c, r))
finally:
    with sqlite3.connect(DB) as conn:
        conn.execute('DROP TRIGGER IF EXISTS fail_opening_stock_tx')
check('database failure rolls back batch', scalar("SELECT COUNT(*) FROM batches WHERE batch_number='ROLLBACK-BATCH'") == before_batches)
check('database failure rolls back location stock', scalar('''SELECT COALESCE(SUM(mls.quantity),0) FROM material_location_stock mls
    JOIN materials m ON m.id=mls.material_id WHERE m.item_code='IMP-002' ''') == before_stock)
check('database failure rolls back transaction', scalar('''SELECT COUNT(*) FROM stock_transactions st JOIN materials m ON m.id=st.material_id
    WHERE m.item_code='IMP-002' ''') == before_tx)

# Existing coverage: batch tracking, locations overview and permissions.
c, r = call('GET', '/api/master/batches?search=IMP-001', admin)
check('imported batch appears in batch tracking', c == 200 and any(b['batch_number'] == 'OPEN-IMP-001-A' for b in r['batches']), r)
c, r = call('GET', '/api/locations/overview', admin)
locs = r.get('locations', [])
imp_bin = next((l for l in locs if l['code'] == 'WH-IMP-A-01'), None)
check('locations overview lists master bin', imp_bin is not None, [l['code'] for l in locs][:10])
check('locations overview shows materials in bin', imp_bin and imp_bin['materials_count'] >= 1 and any(m['item_code'] == 'IMP-001' for m in imp_bin['materials']), imp_bin)

c, r = call('POST', '/api/import/materials', picker, {'rows': [{'item_code': 'X', 'description': 'y'}]})
check('picker cannot import materials (403)', c == 403, (c, r))
c, r = call('GET', '/api/import/meta', picker)
check('picker meta excludes materials', 'materials' not in [e['key'] for e in r.get('entities', [])], r)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
