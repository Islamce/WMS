#!/usr/bin/env python3
"""Round-4 regressions:
 1. Mobile create-request now collects cost center, project/WBS and required
    date (previously blank downstream at every step, incl. ERP operator).
 2. Generic "reverse one step" workflow action at every stage (approval, ERP,
    allocation, picker-assignment, picking-before-pick, GI), with per-stage
    permission enforcement and a safety block once lines are actually picked.
 3. Device token registration for real push notifications (Firebase).
Runs in Phase 3 after r3_test.py."""
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
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
whop = login('whoperator@example.com', 'Passw0rd!')

_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

def status(rid, token=None):
    _, r = call('GET', f'/api/requests/{rid}', token or admin)
    return r['request']['request_status']

def new_request(qty=2, **extra):
    body = {'purpose': 'r4-test', 'cost_center': 'CC-1000', 'plant': 'P100',
             'lines': [{'material_id': BOLT, 'requested_quantity': qty}]}
    body.update(extra)
    _, p = call('POST', '/api/requests', requester, body)
    return p['id']

def approve_erp_allocate(rid, erp_token=erp):
    call('POST', f'/api/requests/{rid}/submit', requester)
    call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
    call('PATCH', f'/api/erp-operator/{rid}', erp_token, {'erp_reservation_number': f'RES-{rid}',
        'erp_reference_number': f'ERP-REF-{rid}', 'movement_type': '201',
        'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})

def context_ok(row, rid):
    ctx = row.get('execution_context', {})
    return (ctx.get('erp_reservation_number') == f'RES-{rid}' and
            ctx.get('erp_reference_number') == f'ERP-REF-{rid}' and
            ctx.get('movement_type') == '201' and ctx.get('plant') == 'P100' and
            ctx.get('issue_warehouse_code') == 'WH01' and ctx.get('storage_location') == '0001' and
            ctx.get('cost_center') == 'CC-1000')

# ===== 1. Create-request field parity (server accepts + persists the fields
# the mobile form now collects, matching the web form) =====
rid = new_request(required_date='2026-09-01', wbs_element='WBS-R4')
_, det = call('GET', f'/api/requests/{rid}', admin)
h = det['request']
check('required_date persisted', h.get('required_date') == '2026-09-01', h.get('required_date'))
check('wbs_element (project) persisted', h.get('wbs_element') == 'WBS-R4', h.get('wbs_element'))
check('cost_center persisted', h.get('cost_center') == 'CC-1000', h.get('cost_center'))

# ===== 2. Reverse one step: Approval -> Draft =====
rid1 = new_request()
call('POST', f'/api/requests/{rid1}/submit', requester)
check('rid1 in approval', status(rid1) == 'Pending Manager Approval', status(rid1))
c, r = call('POST', f'/api/requests/{rid1}/reverse', requester, {'reason': 'x'})
check('wrong role blocked from reversing approval stage (403)', c == 403, (c, r))
c, r = call('POST', f'/api/requests/{rid1}/reverse', manager, {'reason': 'undo submit'})
check('approval stage reverses to Draft', c == 200 and status(rid1) == 'Draft', (c, r, status(rid1)))

# ===== 3. Reverse one step: ERP -> Approval, reservation cleared =====
rid2 = new_request()
approve_erp_allocate(rid2)
check('rid2 in ERP queue', status(rid2) == 'Movement Type Assigned', status(rid2))
c, r = call('POST', f'/api/requests/{rid2}/reverse', erp, {'reason': 'undo erp'})
_, det2 = call('GET', f'/api/requests/{rid2}', admin)
check('ERP stage reverses to Pending Manager Approval', c == 200 and status(rid2) == 'Pending Manager Approval', (c, r))
check('ERP reservation cleared on reverse', det2['request']['erp_reservation_number'] is None, det2['request'].get('erp_reservation_number'))

# ===== 4. Reverse one step: allocation (post-allocate) -> Bin & Batch Assignment queue =====
rid3 = new_request()
approve_erp_allocate(rid3)
call('POST', f'/api/erp-operator/{rid3}/send-to-warehouse', erp)
call('POST', f'/api/warehouse/{rid3}/allocate', supervisor)
check('rid3 in picker-assignment queue', status(rid3) == 'Pending Picker Assignment', status(rid3))
c, r = call('POST', f'/api/requests/{rid3}/reverse', supervisor, {'reason': 'undo allocation'})
check('allocation reverses to Pending Bin Location Assignment', c == 200 and status(rid3) == 'Pending Bin Location Assignment', (c, r))

# ===== 5. Reverse one step: before allocate runs -> ERP queue =====
rid4 = new_request()
approve_erp_allocate(rid4)
call('POST', f'/api/erp-operator/{rid4}/send-to-warehouse', erp)
check('rid4 pending bin assignment (no allocate yet)', status(rid4) == 'Pending Bin Location Assignment', status(rid4))
c, r = call('POST', f'/api/requests/{rid4}/reverse', supervisor, {'reason': 'undo send-to-warehouse'})
check('pre-allocate stage reverses to ERP Operator queue', c == 200 and status(rid4) == 'Movement Type Assigned', (c, r))

# ===== 6. Reverse one step: picker-assignment (no picks yet) -> Picker Assignment =====
rid5 = new_request()
approve_erp_allocate(rid5)
call('POST', f'/api/erp-operator/{rid5}/send-to-warehouse', erp)
_, queue = call('GET', '/api/warehouse/queue', supervisor)
warehouse_row = next((row for row in queue.get('requests', []) if row['id'] == rid5), {})
check('canonical ERP context reaches warehouse allocation queue', context_ok(warehouse_row, rid5), warehouse_row)
call('POST', f'/api/warehouse/{rid5}/allocate', supervisor)
_, queue = call('GET', '/api/warehouse/queue', supervisor)
assignment_row = next((row for row in queue.get('requests', []) if row['id'] == rid5), {})
check('canonical ERP context reaches picker assignment queue', context_ok(assignment_row, rid5), assignment_row)
_, pk = call('GET', '/api/warehouse/pickers', supervisor)
_, assigned = call('POST', f'/api/warehouse/{rid5}/assign-picker', supervisor, {'picker_id': pk['pickers'][0]['id']})
check('rid5 assigned to picker', status(rid5) == 'Pending Picker Acceptance', status(rid5))
_, inbox = call('GET', '/api/picking/tasks', picker)
inbox_row = next((row for row in inbox.get('tasks', []) if row['id'] == assigned.get('task_id')), {})
check('canonical ERP context reaches picker inbox', context_ok(inbox_row, rid5), inbox_row)
c, r = call('POST', f'/api/requests/{rid5}/reverse', supervisor, {'reason': 'undo picker assignment'})
check('picking stage (no picks) reverses to Pending Picker Assignment', c == 200 and status(rid5) == 'Pending Picker Assignment', (c, r))
_, reversed_detail = call('GET', f'/api/requests/{rid5}', admin)
check('downstream reversal preserves ERP execution context', context_ok(reversed_detail['request'], rid5), reversed_detail['request'])

# ===== 7. Safety: reverse blocked once lines are actually picked =====
rid6 = new_request()
approve_erp_allocate(rid6)
call('POST', f'/api/erp-operator/{rid6}/send-to-warehouse', erp)
call('POST', f'/api/warehouse/{rid6}/allocate', supervisor)
_, pk = call('GET', '/api/warehouse/pickers', supervisor)
_, assign = call('POST', f'/api/warehouse/{rid6}/assign-picker', supervisor, {'picker_id': pk['pickers'][0]['id']})
tid = assign['task_id']
call('POST', f'/api/picking/tasks/{tid}/accept', picker)
call('POST', f'/api/picking/tasks/{tid}/start', picker)
_, task = call('GET', f'/api/picking/tasks/{tid}', picker)
check('canonical ERP context reaches picker task detail', context_ok(task['request'], rid6), task['request'])
for a in task['allocations']:
    if a['status'] == 'PROPOSED':
        call('POST', f"/api/picking/allocations/{a['id']}/scan", admin, {'skip': True})
for line in task['lines']:
    call('POST', f"/api/picking/lines/{line['id']}/confirm", picker, {'picked_quantity': line['reserved_quantity']})
c, r = call('POST', f'/api/requests/{rid6}/reverse', supervisor, {'reason': 'should be blocked'})
check('reverse blocked once lines are picked (400)', c == 400, (c, r))

# ===== 8. GI stage reverse == return-to-picker =====
call('POST', f'/api/picking/tasks/{tid}/complete', picker)
check('rid6 in GI queue', status(rid6) == 'Pending ERP GI', status(rid6))
_, gi_queue = call('GET', '/api/gi', whop)
gi_row = next((row for row in gi_queue.get('requests', []) if row['id'] == rid6), {})
check('canonical ERP context reaches GI queue', context_ok(gi_row, rid6), gi_row)
_, gi_detail = call('GET', f'/api/gi/{rid6}', whop)
check('canonical ERP context reaches GI detail', context_ok(gi_detail['request'], rid6), gi_detail['request'])
c, r = call('POST', f'/api/requests/{rid6}/reverse', whop, {'reason': 'return for repick'})
check('GI stage reverses to Picking in Progress', c == 200 and status(rid6) == 'Picking in Progress', (c, r))
_, after_gi_reverse = call('GET', f'/api/requests/{rid6}', admin)
check('GI return-to-picker preserves ERP execution context', context_ok(after_gi_reverse['request'], rid6), after_gi_reverse['request'])

# ===== 9. Closed/Draft requests cannot be reversed =====
c, r = call('POST', f'/api/requests/{rid1}/reverse', manager, {'reason': 'x'})
check('Draft cannot be reversed (400)', c == 400, (c, r))

# ===== 10. Device registration for real push notifications =====
c, r = call('POST', '/api/notifications/register-device', requester, {'token': 'test-fcm-token-r4', 'platform': 'android'})
check('device registration accepted', c == 200, (c, r))
c, r = call('POST', '/api/notifications/register-device', requester, {})
check('device registration requires a token (400)', c == 400, (c, r))
c, r = call('POST', '/api/notifications/unregister-device', requester, {'token': 'test-fcm-token-r4'})
check('device unregistration accepted', c == 200, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
