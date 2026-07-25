#!/usr/bin/env python3
"""Import Center and opening-stock regression tests."""
import json, urllib.request, urllib.error, os, sys, sqlite3

B, DB = "http://localhost:3000", "data/wms.db"
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
    if cond: passed += 1; print('PASS:', name)
    else: failed += 1; fails.append(name); print('FAIL:', name, detail)

def login(email, pw):
    return call('POST', '/api/auth/login', body={'email': email, 'password': pw})[1].get('token')

def scalar(sql, params=()):
    with sqlite3.connect(DB) as conn:
        return conn.execute(sql, params).fetchone()[0]

admin = login('admin@example.com', 'Admin@123456')
picker = login('picker@example.com', 'Passw0rd!')

# Meta, master-data imports, and existing row-level behavior.
c, r = call('GET', '/api/import/meta', admin)
check('meta lists materials and stock', c == 200 and {'materials','stock'}.issubset({e['key'] for e in r.get('entities', [])}), r)
c, r = call('POST', '/api/import/materials', admin, {'rows': [
    {'item_code':'IMP-001','description':'Imported bolt','unit':'EA'},
    {'item_code':'IMP-002','description':'Imported oil','unit':'L'},
    {'description':'missing code'}]})
check('materials import preserves row errors', c == 200 and r['created'] == 2 and r['errors'] == 1, r)
c, r = call('POST', '/api/import/materials', admin, {'rows':[{'item_code':'IMP-001','description':'Imported bolt v2'}]})
check('materials re-upload updates', c == 200 and r['updated'] == 1, r)
c, r = call('POST', '/api/import/warehouses', admin, {'rows':[
    {'warehouse_code':'WH-IMP','warehouse_name':'Imported WH'},
    {'warehouse_code':'WH-OTHER','warehouse_name':'Other WH'}]})
check('warehouses created', c == 200 and r['created'] == 2, r)
c, r = call('POST', '/api/import/bins', admin, {'rows':[
    {'warehouse_code':'WH-IMP','bin_code':'A-01','full_bin_location':'WH-IMP-A-01','capacity':'100'},
    {'warehouse_code':'WH-IMP','bin_code':'A-02','full_bin_location':'WH-IMP-A-02','capacity':'100'},
    {'warehouse_code':'WH-OTHER','bin_code':'B-01','full_bin_location':'WH-OTHER-B-01','capacity':'100'},
    {'warehouse_code':'NOPE','bin_code':'X'}]})
check('bins import validates warehouse', c == 200 and r['created'] == 3 and r['errors'] == 1, r)

# New opening stock.
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-A',
    'quantity':'250','bin_location':'WH-IMP-A-01','quality_status':'RELEASED'}]})
check('new opening stock created', c == 200 and r['created'] == 1 and r['errors'] == 0, r)
check('new batch quantity created', scalar("SELECT remaining_quantity FROM batches WHERE batch_number='OPEN-IMP-001-A'") == 250)
check('bin stock balance created', scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 250)
check('IN transaction uses same bin location', scalar('''SELECT COUNT(*) FROM stock_transactions st
 JOIN materials m ON m.id=st.material_id JOIN locations l ON l.id=st.location_id
 WHERE m.item_code=? AND l.code=? AND st.transaction_type='IN' AND st.quantity=250''', ('IMP-001','WH-IMP-A-01')) == 1)

# Repeated import/update is additive and remains atomic.
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-A',
    'quantity':'50','bin_location':'WH-IMP-A-01'}]})
check('repeated import updates batch', c == 200 and r['updated'] == 1, r)
check('repeated import updates batch quantity', scalar("SELECT remaining_quantity FROM batches WHERE batch_number='OPEN-IMP-001-A'") == 300)
check('repeated import updates bin balance', scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 300)

# Multiple bins and comma-formatted quantity.
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-B',
    'quantity':'1,250.50','bin_location':'WH-IMP-A-02'}]})
check('comma-formatted quantity accepted', c == 200 and r['created'] == 1, r)
check('second bin has independent balance', abs(scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-02')) - 1250.5) < 0.0001)

# Required validation cases plus one valid row in the same request.
c, r = call('POST', '/api/import/stock', admin, {'rows':[
    {'material_code':'UNKNOWN','warehouse_code':'WH-IMP','quantity':'1','bin_location':'WH-IMP-A-01'},
    {'material_code':'IMP-001','warehouse_code':'UNKNOWN','quantity':'1','bin_location':'WH-IMP-A-01'},
    {'material_code':'IMP-001','warehouse_code':'WH-IMP','quantity':'1','bin_location':'UNKNOWN-BIN'},
    {'material_code':'IMP-001','warehouse_code':'WH-IMP','quantity':'1','bin_location':'WH-OTHER-B-01'},
    {'material_code':'IMP-002','warehouse_code':'WH-IMP','quantity':'10','bin_location':'WH-IMP-A-01'}]})
messages = [x.get('message','') for x in r.get('results',[]) if x.get('status') == 'error']
check('invalid rows preserved while valid row commits', c == 200 and r['created'] == 1 and r['errors'] == 4, r)
check('unknown material error', any('unknown material' in x for x in messages), messages)
check('unknown warehouse error', any('unknown warehouse' in x for x in messages), messages)
check('unknown bin error', any('unknown bin' in x for x in messages), messages)
check('bin in another warehouse error', any('does not belong' in x for x in messages), messages)

# Dashboard values must reconcile to persisted operational stock.
c, dashboard = call('GET', '/api/dashboard', admin)
db_total = scalar('SELECT COALESCE(SUM(remaining_quantity),0) FROM batches')
db_occupied = scalar('''SELECT COUNT(*) FROM bin_locations bl WHERE bl.is_active=1 AND EXISTS (
 SELECT 1 FROM batches b WHERE b.warehouse_code=bl.warehouse_code
 AND b.bin_location IN (bl.bin_code,bl.full_bin_location) AND b.remaining_quantity>0)''')
check('dashboard stock total reconciles after import', c == 200 and abs(dashboard['kpis']['total_stock'] - db_total) < 0.0001, dashboard.get('kpis'))
check('dashboard occupied-bin count reconciles after import', c == 200 and dashboard['kpis']['occupied_locations'] == db_occupied, dashboard.get('kpis'))
c, r = call('GET', '/api/dashboard/bins?status=occupied', admin)
occupied = {b['full_bin_location'] for b in r.get('bins',[])}
check('occupied bins include both imported bins', {'WH-IMP-A-01','WH-IMP-A-02'}.issubset(occupied), occupied)

# Force a DB failure at the final ledger insert; all preceding writes must roll back.
before_batch = scalar("SELECT COUNT(*) FROM batches WHERE batch_number='ROLLBACK-BATCH'")
before_stock = scalar("SELECT COALESCE(SUM(mls.quantity),0) FROM material_location_stock mls JOIN materials m ON m.id=mls.material_id WHERE m.item_code='IMP-002'")
before_tx = scalar("SELECT COUNT(*) FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.item_code='IMP-002'")
with sqlite3.connect(DB) as conn:
    conn.execute("CREATE TRIGGER fail_opening_stock_tx BEFORE INSERT ON stock_transactions BEGIN SELECT RAISE(ABORT, 'forced opening stock failure'); END")
try:
    c, r = call('POST', '/api/import/stock', admin, {'rows':[{
        'material_code':'IMP-002','warehouse_code':'WH-IMP','batch_number':'ROLLBACK-BATCH',
        'quantity':'99','bin_location':'WH-IMP-A-02'}]})
    check('unexpected DB failure returns 500', c == 500 and 'forced opening stock failure' in r.get('error',''), (c,r))
finally:
    with sqlite3.connect(DB) as conn: conn.execute('DROP TRIGGER IF EXISTS fail_opening_stock_tx')
check('rollback removes batch write', scalar("SELECT COUNT(*) FROM batches WHERE batch_number='ROLLBACK-BATCH'") == before_batch)
check('rollback removes stock-balance write', scalar("SELECT COALESCE(SUM(mls.quantity),0) FROM material_location_stock mls JOIN materials m ON m.id=mls.material_id WHERE m.item_code='IMP-002'") == before_stock)
check('rollback removes transaction write', scalar("SELECT COUNT(*) FROM stock_transactions st JOIN materials m ON m.id=st.material_id WHERE m.item_code='IMP-002'") == before_tx)

# Existing permissions remain enforced.
c, r = call('POST', '/api/import/materials', picker, {'rows':[{'item_code':'X','description':'y'}]})
check('picker cannot import materials', c == 403, (c,r))

print(f'\n===== RESULT: {passed} passed, {failed} failed =====')
if fails: print('Failed:', fails)
sys.exit(1 if failed else 0)
