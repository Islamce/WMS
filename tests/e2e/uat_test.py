#!/usr/bin/env python3
"""UAT feedback regressions:
 1. Non-stock items cannot receive an ERP reservation (stock items still can).
 2. Admin can skip the QR scan (picker cannot).
 3. Scanning the bin-location code passes; scanning a different bin fails.
 4. Goods receipt accepts an optional bin location (validated) and returns it.
 5. QR label list is reachable with goods_receipt permission; requester is not.
 6. reset-admin script creates a working admin login.
Runs in Phase 3 on the shared fresh dataset (after p2/p3 suites).
"""
import json, urllib.request, urllib.error, os, sys, subprocess

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
    c, p = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return p.get('token')

admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

def full_to_picking(qty=5):
    """Create -> approve -> ERP -> allocate -> assign -> accept -> start; returns allocations."""
    _, p = call('POST', '/api/requests', requester, {'purpose': 'uat', 'cost_center': 'CC-1000', 'plant': 'P100',
        'lines': [{'material_id': BOLT, 'requested_quantity': qty}]})
    rid = p['id']
    call('POST', f'/api/requests/{rid}/submit', requester)
    call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
    call('PATCH', f'/api/erp-operator/{rid}', erp, {'erp_reservation_number': f'RES-UAT-{rid}', 'movement_type': '201',
        'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
    call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
    call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
    _, pk = call('GET', '/api/warehouse/pickers', supervisor)
    _, p = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': pk['pickers'][0]['id']})
    tid = p['task_id']
    call('POST', f'/api/picking/tasks/{tid}/accept', picker)
    call('POST', f'/api/picking/tasks/{tid}/start', picker)
    _, task = call('GET', f'/api/picking/tasks/{tid}', picker)
    return rid, tid, task['allocations']

# ===== 1. Non-stock items cannot be reserved =====
c, r = call('POST', '/api/materials', admin, {'item_code': 'SVC-0001', 'description': 'Calibration Service',
    'unit': 'EA', 'price': 50, 'is_stock_item': 0})
check('non-stock material created', c == 201, (c, r))
_, p = call('POST', '/api/requests', requester, {'purpose': 'service', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': r.get('id'), 'requested_quantity': 1}]})
ns_rid = p.get('id')
call('POST', f'/api/requests/{ns_rid}/submit', requester)
call('POST', f'/api/approvals/{ns_rid}/decision', manager, {'decision': 'approve'})
c, r2 = call('PATCH', f'/api/erp-operator/{ns_rid}', erp, {'erp_reservation_number': 'RES-NS-1'})
check('reservation blocked for non-stock item (400)', c == 400 and 'SVC-0001' in r2.get('error', ''), (c, r2))
# a normal stock item still reserves fine
_, p = call('POST', '/api/requests', requester, {'purpose': 'stock ok', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 2}]})
ok_rid = p['id']
call('POST', f'/api/requests/{ok_rid}/submit', requester)
call('POST', f'/api/approvals/{ok_rid}/decision', manager, {'decision': 'approve'})
c, r2 = call('PATCH', f'/api/erp-operator/{ok_rid}', erp, {'erp_reservation_number': 'RES-OK-2'})
check('stock item still reservable', c == 200, (c, r2))

# ===== 2 + 3. Skip scan (admin only) and bin-QR scan =====
rid1, tid1, allocs1 = full_to_picking(4)
a = allocs1[0]
c, r = call('POST', f"/api/picking/allocations/{a['id']}/scan", picker, {'skip': True})
check('picker cannot skip scan (403)', c == 403, (c, r))
# 'R-01-01-09' is a real WH01 bin in the master, but not the allocation's bin
c, r = call('POST', f"/api/picking/allocations/{a['id']}/scan", picker, {'qr_value': 'R-01-01-09'})
check('scanning a DIFFERENT bin fails (WRONG_BIN)', c == 400 and r.get('code') == 'WRONG_BIN', (c, r))
c, r = call('POST', f"/api/picking/allocations/{a['id']}/scan", picker, {'qr_value': a['bin_location']})
check('scanning the correct bin location passes', c == 200 and r.get('ok'), (c, r))

rid2, tid2, allocs2 = full_to_picking(3)
b = allocs2[0]
c, r = call('POST', f"/api/picking/allocations/{b['id']}/scan", admin, {'skip': True})
check('admin skip-scan works', c == 200 and r.get('skipped'), (c, r))
# the skip is recorded in the audit trail
c, r = call('GET', f'/api/master/audit?request_number=&action=QR_SCAN_SKIPPED&limit=5', admin)
check('skip recorded in audit trail', c == 200 and (r.get('total', 0) >= 1 or len(r.get('audit', [])) >= 1), (c, r))

# ===== 4. Goods receipt with bin location =====
c, r = call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 5,
    'warehouse_code': 'WH01', 'po_number': 'PO-UAT-1', 'bin_location': 'R-01-01-05'})
check('receive with bin location', c == 201 and r.get('bin_location') == 'R-01-01-05', (c, r))
c, r = call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 5,
    'warehouse_code': 'WH01', 'po_number': 'PO-UAT-2', 'bin_location': 'NO-SUCH-BIN'})
check('receive with unknown bin rejected (400)', c == 400, (c, r))

# ===== 5. QR list reachable with goods_receipt =====
c, r = call('GET', '/api/receiving/qr', supervisor)
check('QR label list reachable (supervisor)', c == 200 and 'qr_codes' in r, (c, r))
c, r = call('GET', '/api/receiving/qr', requester)
check('QR label list blocked for requester (403)', c == 403, (c, r))

# ===== 6. reset-admin script =====
p = subprocess.run(['node', 'scripts/reset-admin.js', 'resetme@example.com', 'ResetPass9'],
                   cwd=ROOT, capture_output=True, text=True)
check('reset-admin script exits 0', p.returncode == 0, p.stderr[:200])
tok = login('resetme@example.com', 'ResetPass9')
check('reset-admin login works', bool(tok))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
