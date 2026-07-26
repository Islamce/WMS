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
stock_meta = next((e for e in r.get('entities', []) if e['key'] == 'stock'), {})
check('opening stock meta includes receiving_date', 'receiving_date' in stock_meta.get('columns', []), stock_meta)
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

# Historical receipt used by opening-stock date resolution.
c, r = call('POST', '/api/import/movements/chunk', admin, {
    'movement_type':'RECEIPT', 'source_filename':'stock-in.csv', 'finalize':True,
    'rows':[{'id':'REC-1','material_code':'IMP-001','warehouse_code':'WH-IMP',
             'bin_location':'WH-IMP-A-01','quantity':'250','movement_date':'15/01/2023'}]})
check('historical receipt imported', c == 200 and r.get('inserted') == 1, r)

# New opening stock derives its date from historical Stock In.
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-A',
    'quantity':'250','bin_location':'WH-IMP-A-01','quality_status':'RELEASED'}]})
check('new opening stock created', c == 200 and r['created'] == 1 and r['errors'] == 0, r)
check('new batch quantity created', scalar("SELECT remaining_quantity FROM batches WHERE batch_number='OPEN-IMP-001-A'") == 250)
check('historical receiving date applied', scalar("SELECT receiving_date FROM batches WHERE batch_number='OPEN-IMP-001-A'") == '2023-01-15')
check('historical date source recorded', scalar("SELECT receiving_date_source FROM batches WHERE batch_number='OPEN-IMP-001-A'") == 'HISTORICAL_BIN')
check('opening batch permanently registered', scalar("SELECT COUNT(*) FROM opening_stock_batch_registry r JOIN batches b ON b.id=r.batch_id WHERE b.batch_number='OPEN-IMP-001-A'") == 1)
check('bin stock balance created', scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 250)
check('IN transaction uses same bin location', scalar('''SELECT COUNT(*) FROM stock_transactions st
 JOIN materials m ON m.id=st.material_id JOIN locations l ON l.id=st.location_id
 WHERE m.item_code=? AND l.code=? AND st.transaction_type='IN' AND st.quantity=250''', ('IMP-001','WH-IMP-A-01')) == 1)

# Repeated opening-stock import is idempotent and creates no side effects.
before_transactions = scalar("""SELECT COUNT(*) FROM stock_transactions st
 JOIN materials m ON m.id=st.material_id
 WHERE m.item_code='IMP-001'""")
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-A',
    'quantity':'50','bin_location':'WH-IMP-A-01'}]})
check('repeated opening stock is skipped', c == 200 and r['skipped'] == 1 and r['updated'] == 0 and r['errors'] == 0, r)
check('repeated opening stock preserves batch quantity', scalar("SELECT remaining_quantity FROM batches WHERE batch_number='OPEN-IMP-001-A'") == 250)
check('repeated opening stock preserves bin balance', scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-01')) == 250)
check('repeated opening stock creates no transaction', scalar("""SELECT COUNT(*) FROM stock_transactions st
 JOIN materials m ON m.id=st.material_id
 WHERE m.item_code='IMP-001'""") == before_transactions)

# Multiple bins, comma-formatted quantity and explicit date precedence.
c, r = call('POST', '/api/import/stock', admin, {'rows':[{
    'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'OPEN-IMP-001-B',
    'quantity':'1,250.50','bin_location':'WH-IMP-A-02','receiving_date':'01/12/2022'}]})
check('comma-formatted quantity accepted', c == 200 and r['created'] == 1, r)
check('explicit receiving date applied', scalar("SELECT receiving_date FROM batches WHERE batch_number='OPEN-IMP-001-B'") == '2022-12-01')
check('explicit date source recorded', scalar("SELECT receiving_date_source FROM batches WHERE batch_number='OPEN-IMP-001-B'") == 'EXPLICIT')
check('second bin has independent balance', abs(scalar('''SELECT mls.quantity FROM material_location_stock mls
 JOIN materials m ON m.id=mls.material_id JOIN locations l ON l.id=mls.location_id
 WHERE m.item_code=? AND l.code=?''', ('IMP-001','WH-IMP-A-02')) - 1250.5) < 0.0001)

# Reconciliation scans only permanently registered opening-stock batches.
c, r = call('POST', '/api/import/stock/reconcile-dates', admin, {'apply':False})
registered_open = scalar('''SELECT COUNT(*) FROM opening_stock_batch_registry r
 JOIN batches b ON b.id=r.batch_id WHERE b.remaining_quantity>0''')
check('date reconciliation defaults to dry run', c == 200 and r.get('mode') == 'DRY_RUN', r)
check('ordinary GR batches are excluded from reconciliation', r.get('registered_batches_scanned') == registered_open, r)

# Same batch number in different material/bin scopes must not cross-update.
c, r = call('POST', '/api/import/movements/chunk', admin, {
    'movement_type':'RECEIPT', 'source_filename':'duplicate-scope.csv', 'finalize':True,
    'rows':[
      {'id':'REC-DUP-1','material_code':'IMP-001','warehouse_code':'WH-IMP','bin_location':'WH-IMP-A-02','quantity':'1','movement_date':'01/05/2021'},
      {'id':'REC-DUP-2','material_code':'IMP-002','warehouse_code':'WH-IMP','bin_location':'WH-IMP-A-01','quantity':'1','movement_date':'01/06/2020'}]})
check('duplicate-scope historical receipts imported', c == 200 and r.get('inserted') == 2, r)
c, r = call('POST', '/api/import/stock', admin, {'rows':[
    {'material_code':'IMP-001','warehouse_code':'WH-IMP','batch_number':'DUP-BATCH','quantity':'1','bin_location':'WH-IMP-A-02','receiving_date':'01/01/2026'},
    {'material_code':'IMP-002','warehouse_code':'WH-IMP','batch_number':'DUP-BATCH','quantity':'1','bin_location':'WH-IMP-A-01','receiving_date':'01/01/2026'}]})
check('duplicate batch number accepted in separate scopes', c == 200 and r.get('created') == 2, r)
with sqlite3.connect(DB) as conn:
    conn.execute("UPDATE batches SET receiving_date='2026-01-01',fifo_date='2026-01-01',receiving_date_source='ESTIMATED_IMPORT_DATE' WHERE batch_number='DUP-BATCH'")
c, r = call('POST', '/api/import/stock/reconcile-dates', admin, {'apply':True})
check('scoped reconciliation applies', c == 200 and r.get('mode') == 'APPLIED', r)
check('first duplicate batch gets its own date', scalar('''SELECT b.receiving_date FROM batches b JOIN materials m ON m.id=b.material_id
 WHERE b.batch_number='DUP-BATCH' AND m.item_code='IMP-001' AND b.bin_location='WH-IMP-A-02' ''') == '2021-05-01')
check('second duplicate batch gets its own date', scalar('''SELECT b.receiving_date FROM batches b JOIN materials m ON m.id=b.material_id
 WHERE b.batch_number='DUP-BATCH' AND m.item_code='IMP-002' AND b.bin_location='WH-IMP-A-01' ''') == '2020-06-01')

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
