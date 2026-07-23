#!/usr/bin/env python3
"""Round-3 regressions for workflow visibility, inventory controls and shipping."""
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

def raw_get(path, token):
    req = urllib.request.Request(B + path)
    req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def require(name, code, payload, expected):
    ok = code == expected
    check(name, ok, (code, payload))
    return ok

def login(email, pw):
    c, p = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return p.get('token')

admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
whop = login('whoperator@example.com', 'Passw0rd!')
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

# 1. Requester details visible at every step
_, p = call('POST', '/api/requests', requester, {'purpose': 'r3 visibility', 'cost_center': 'CC-1000',
    'plant': 'P100', 'department': 'PROD', 'wbs_element': 'WBS-R3', 'required_date': '2026-08-01',
    'lines': [{'material_id': BOLT, 'requested_quantity': 3}]})
rid = p['id']
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
c, q = call('GET', '/api/erp-operator', erp)
row = next((r for r in q['requests'] if r['id'] == rid), {})
check('ERP queue shows department/project/cost center/required date',
      row.get('department') == 'PROD' and row.get('project') == 'WBS-R3'
      and row.get('cost_center') == 'CC-1000' and row.get('required_date') == '2026-08-01', row)
call('PATCH', f'/api/erp-operator/{rid}', erp, {'erp_reservation_number': f'RES-R3-{rid}', 'movement_type': '201',
    'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
c, q = call('GET', '/api/warehouse/queue', supervisor)
row = next((r for r in q['requests'] if r['id'] == rid), {})
check('warehouse queue shows requester details',
      row.get('requester_name') and row.get('department') == 'PROD' and row.get('project') == 'WBS-R3', row)
call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
_, pk = call('GET', '/api/warehouse/pickers', supervisor)
_, p = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': pk['pickers'][0]['id']})
tid = p['task_id']
c, q = call('GET', '/api/picking/tasks', picker)
row = next((t for t in q['tasks'] if t['id'] == tid), {})
check('picking task list shows requester details', row.get('requester_name') and row.get('department') == 'PROD', row)
call('POST', f'/api/picking/tasks/{tid}/accept', picker)
call('POST', f'/api/picking/tasks/{tid}/start', picker)
_, task = call('GET', f'/api/picking/tasks/{tid}', picker)
for a in task['allocations']:
    if a['status'] == 'PROPOSED':
        call('POST', f"/api/picking/allocations/{a['id']}/scan", admin, {'skip': True})
for line in task['lines']:
    call('POST', f"/api/picking/lines/{line['id']}/confirm", picker, {'picked_quantity': line['reserved_quantity']})
call('POST', f'/api/picking/tasks/{tid}/complete', picker)
c, q = call('GET', '/api/gi', whop)
row = next((r for r in q['requests'] if r['id'] == rid), {})
check('GI queue shows requester details', row.get('requester_name') and row.get('department') == 'PROD', row)
c, r = call('POST', f'/api/gi/{rid}/post', whop, {'gi_document_number': f'49R3{rid}'})
check('GI posted for shipping test', c == 200, (c, r))

# 2. Material master live stock
c, r = call('GET', f'/api/materials?search=MAT-0001', admin)
before = r['materials'][0]['total_stock']
call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 7,
    'warehouse_code': 'WH01', 'po_number': 'PO-R3-STOCK'})
c, r = call('GET', f'/api/materials?search=MAT-0001', admin)
after = r['materials'][0]['total_stock']
check('material master stock updates automatically after GR', after == before + 7, (before, after))
check('materials list exposes available/reserved stock',
      'available_stock' in r['materials'][0] and 'reserved_stock' in r['materials'][0], r['materials'][0].keys())

# 3. Sort + filters
c, r = call('GET', '/api/materials?sort=total_stock&dir=desc&limit=100', admin)
stocks = [x['total_stock'] for x in r['materials']]
check('materials sortable by stock (desc)', c == 200 and stocks == sorted(stocks, reverse=True), stocks[:5])
check('materials filter values provided', 'filters' in r and 'groups' in r['filters'], r.get('filters'))
c, r = call('GET', '/api/materials?stock=out&limit=100', admin)
check('stock filter works (out of stock)', c == 200 and all(x['total_stock'] <= 0 for x in r['materials']), c)

# 4. Analytics
c, r = call('GET', '/api/analytics', admin)
item = r['items'][0] if r.get('items') else {}
check('analytics has ABC/XYZ/FSN classes', all(k in item for k in ('abc_class', 'xyz_class', 'fsn_class')), item.keys())
check('analytics has EOQ + overstock/understock flags', 'eoq' in item and 'overstock' in item, item.keys())
check('analytics has ABC-XYZ matrix (9 cells)', len(r.get('abc_xyz_matrix', {})) == 9, r.get('abc_xyz_matrix', {}).keys())

# 5. Governed reallocation
c, r = call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 10,
    'warehouse_code': 'WH01', 'po_number': 'PO-R3-REALLOC', 'bin_location': 'R-01-01-05'})
ra_batch = r.get('batch_id')
check('reallocation setup batch created', c == 201 and ra_batch, (c, r))
c, r = call('POST', '/api/reallocation', requester, {'batch_id': ra_batch, 'quantity': 1,
    'to_warehouse': 'WH02', 'reason': 'permission test'})
check('reallocation blocked without permission (403)', c == 403, (c, r))
c, r = call('POST', '/api/reallocation', supervisor, {'batch_id': ra_batch, 'quantity': 999,
    'to_warehouse': 'WH02', 'reason': 'over quantity'})
check('reallocation of more than movable rejected (400)', c == 400, (c, r))
c, r = call('POST', '/api/reallocation', supervisor,
            {'batch_id': ra_batch, 'quantity': 4, 'to_warehouse': 'WH02', 'to_bin': 'R-01-01-01',
             'to_project': 'PRJ-R3', 'reason': 'r3 test split'})
move_id = r.get('id')
check('partial reallocation submitted for approval', c == 201 and move_id and r.get('status') == 'PENDING_APPROVAL', (c, r))
c, r = call('POST', f'/api/reallocation/{move_id}/approve', supervisor)
check('requester cannot approve own reallocation (SoD)', c == 403, (c, r))
c, r = call('POST', f'/api/reallocation/{move_id}/approve', admin)
check('independent approver approves reallocation', c == 200 and r.get('status') == 'APPROVED', (c, r))
c, r = call('POST', f'/api/reallocation/{move_id}/approve', admin)
check('approval replay is idempotent', c == 200 and r.get('idempotent') is True, (c, r))
c, r = call('POST', f'/api/reallocation/{move_id}/execute', admin)
new_batch = r.get('new_batch_id')
check('approved partial reallocation executes and splits batch', c == 200 and new_batch, (c, r))
c, replay = call('POST', f'/api/reallocation/{move_id}/execute', admin)
check('execution replay is idempotent', c == 200 and replay.get('idempotent') is True
      and replay.get('new_batch_id') == new_batch, (c, replay))
c, r = call('GET', f'/api/master/batches?search=PO-R3-REALLOC', admin)
src = next((b for b in r.get('batches', []) if b['id'] == ra_batch), {})
dst = next((b for b in r.get('batches', []) if b['id'] == new_batch), {})
check('source batch reduced to 6', src.get('remaining_quantity') == 6, src.get('remaining_quantity'))
check('split batch holds 4 in WH02 with bin + project',
      dst.get('remaining_quantity') == 4 and dst.get('warehouse_code') == 'WH02'
      and dst.get('bin_location') == 'R-01-01-01', dst)
c, r = call('GET', '/api/reallocation?search=RA-', supervisor)
check('reallocation history recorded', c == 200 and r.get('total', 0) >= 1
      and any(mv.get('to_project') == 'PRJ-R3' for mv in r.get('moves', [])), (c, r.get('total')))

# 6. Physical inventory
c, r = call('POST', '/api/inventory', supervisor, {'session_type': 'ANNUAL', 'warehouse_code': 'WH02',
    'blind': True, 'freeze_stock': True, 'notes': 'r3 annual count'})
sid = r.get('id')
check('annual inventory session opened', c == 201 and sid and r.get('lines', 0) >= 1, (c, r))
c, r = call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 5,
    'warehouse_code': 'WH02', 'po_number': 'PO-R3-FROZEN'})
check('freeze blocks goods receipt into counted warehouse (400)', c == 400 and 'frozen' in r.get('error', '').lower(), (c, r))
c, r = call('GET', f'/api/inventory/{sid}', supervisor)
lines_masked = r.get('lines', []) if c == 200 else []
masked = [l for l in lines_masked if l.get('system_quantity') is None]
check('blind session hides system quantities from counters', c == 200 and len(masked) == len(lines_masked), (c, len(masked), len(lines_masked)))
c, r = call('GET', f'/api/inventory/{sid}', admin)
lines = r.get('lines', []) if c == 200 else []
check('admin sees system quantities', c == 200 and lines and all(l.get('system_quantity') is not None for l in lines), (c, len(lines)))
target = next((l for l in lines if l.get('batch_id') == new_batch), lines[0] if lines else None)
if target:
    for l in lines:
        qty = l['system_quantity'] + (2 if l['id'] == target['id'] else 0)
        call('POST', f"/api/inventory/lines/{l['id']}/count", supervisor, {'counted_quantity': qty})
    c, r = call('POST', f'/api/inventory/{sid}/post', supervisor)
    check('posting blocked while variance unapproved (400)', c == 400, (c, r))
    c, r = call('POST', f"/api/inventory/lines/{target['id']}/approve", supervisor)
    check('own variance approval blocked (four-eyes, 403)', c == 403, (c, r))
    c, r = call('POST', f"/api/inventory/lines/{target['id']}/approve", admin)
    check('variance approved by second person', c == 200, (c, r))
    c, r = call('POST', f'/api/inventory/{sid}/post', supervisor)
    check('inventory session posted with adjustments', c == 200 and r.get('adjusted', 0) >= 1, (c, r))
else:
    check('inventory target batch available', False, lines)

c, r = call('POST', '/api/receiving', supervisor, {'material_id': BOLT, 'received_quantity': 5,
    'warehouse_code': 'WH02', 'po_number': 'PO-R3-UNFROZEN'})
check('warehouse unfrozen after posting', c == 201, (c, r))

# 7. Shipping and outbound
c, r = call('GET', '/api/shipping/eligible', whop)
elig = next((x for x in r.get('requests', []) if x['id'] == rid), None)
check('GI-posted request is shipping-eligible', c == 200 and elig is not None, (c, [x.get('id') for x in r.get('requests', [])]))
c, r = call('GET', '/api/shipping', requester)
check('shipping blocked without permission (403)', c == 403, c)
c, r = call('POST', '/api/shipping', supervisor, {'request_id': rid, 'ship_to': 'Site A — Gate 3',
    'carrier': 'ACME Logistics', 'vehicle': 'TRK-42', 'driver': 'D. River', 'packages': 2})
check('shipment created with QR value', c == 201 and r.get('qr_code_value', '').startswith('SHP|'), (c, r))
shp = r.get('id')
c, r = call('POST', '/api/shipping', supervisor, {'request_id': rid, 'ship_to': 'dup'})
check('duplicate shipment for the same request rejected (409)', c == 409, (c, r))
c, r = call('POST', f'/api/shipping/{shp}/dispatch', supervisor)
check('dispatch before pack rejected (400)', c == 400, (c, r))
for step in ('pack', 'load', 'dispatch'):
    c, r = call('POST', f'/api/shipping/{shp}/{step}', supervisor)
    check(f'shipment {step} ok', c == 200, (c, r))
c, r = call('POST', f'/api/shipping/{shp}/deliver', supervisor, {'delivered_to': 'R. Receiver', 'pod_note': 'signed DN-77'})
check('delivery confirmed with POD', c == 200, (c, r))
c, r = call('GET', f'/api/shipping/{shp}', supervisor)
check('shipment shows POD + issued lines', r.get('shipment', {}).get('delivered_to') == 'R. Receiver'
      and len(r.get('lines', [])) >= 1, (c, r.get('shipment', {}).get('delivered_to')))
code, body = raw_get(f'/api/shipping/{shp}/label', supervisor)
check('shipment QR label PDF renders', code == 200 and body.startswith(b'%PDF'), (code, body[:10]))

# 8. Notifications
c, r = call('GET', '/api/notifications/unread-count', requester)
check('unread-count endpoint works', c == 200 and 'unread' in r, (c, r))
c, r = call('GET', '/api/notifications', requester)
delivered = any(n.get('notification_type') == 'SHIPMENT_DELIVERED' for n in r.get('notifications', []))
check('requester notified of delivery', c == 200 and delivered,
      [n.get('notification_type') for n in r.get('notifications', [])[:5]])

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
