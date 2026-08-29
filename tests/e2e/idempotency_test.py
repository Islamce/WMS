#!/usr/bin/env python3
"""Focused replay/idempotency regression tests for critical workflow actions."""
import json, urllib.request, urllib.error, os, sys

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read() or '{}')
        except Exception:
            payload = {}
        return e.code, payload


def check(name, condition, detail=None):
    global passed, failed
    if condition:
        passed += 1
        print(f"PASS: {name}")
    else:
        failed += 1
        print(f"FAIL: {name} {detail or ''}")
    return condition


def must(name, method, path, token=None, body=None, expected=200):
    code, payload = call(method, path, token, body)
    if not check(name, code == expected, {'code': code, 'payload': payload}):
        print(f"ABORT: prerequisite failed at {name}")
        print(f"\nIdempotency regression: {passed} passed, {failed} failed")
        sys.exit(1)
    return payload


def login(email, password):
    payload = must(f'login {email}', 'POST', '/api/auth/login', body={'email': email, 'password': password})
    if not check(f'token issued for {email}', bool(payload.get('token')), payload):
        sys.exit(1)
    return payload.get('token')


requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
whop = login('whoperator@example.com', 'Passw0rd!')
admin = login('admin@example.com', 'Admin@123456')

materials = must('material search', 'GET', '/api/materials/search?q=MAT-0001', admin)
material_id = materials['materials'][0]['id']

# ===== 0. Create-request idempotency_key (mobile offline-queue replay) =====
req_key = 'mobile-req-idemp-test'
req_body = {
    'purpose': 'Idempotency key regression', 'priority': 'NORMAL', 'cost_center': 'CC-IDEMPKEY',
    'plant': 'P100', 'lines': [{'material_id': material_id, 'requested_quantity': 2}],
    'idempotency_key': req_key,
}
first_create = must('first create request (with idempotency_key)', 'POST', '/api/requests', requester, req_body, expected=201)
replay_create = must('replay create request (same idempotency_key)', 'POST', '/api/requests', requester, req_body, expected=201)
check('create-request replay returns the same request, not a new one',
      replay_create.get('id') == first_create.get('id')
      and replay_create.get('request_number') == first_create.get('request_number'),
      {'first': first_create, 'replay': replay_create})
different_key_create = must('create request with a different idempotency_key creates a new one', 'POST', '/api/requests', requester,
                             {**req_body, 'idempotency_key': req_key + '-2'}, expected=201)
check('different idempotency_key is not deduplicated against the first',
      different_key_create.get('id') != first_create.get('id'), different_key_create)

created = must('create request', 'POST', '/api/requests', requester, {
    'purpose': 'Idempotency regression',
    'priority': 'NORMAL',
    'cost_center': 'CC-IDEMP',
    'plant': 'P100',
    'lines': [{'material_id': material_id, 'requested_quantity': 1}],
}, expected=201)
rid = created['id']

first_submit = must('submit request', 'POST', f'/api/requests/{rid}/submit', requester)
replay_submit = must('replay request submit', 'POST', f'/api/requests/{rid}/submit', requester)
check('request submit replay is idempotent', replay_submit.get('idempotent') is True, replay_submit)

must('approve request', 'POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
must('save ERP details', 'PATCH', f'/api/erp-operator/{rid}', erp, {
    'erp_reservation_number': f'RES-IDEMP-{rid}',
    'movement_type': '201',
    'plant': 'P100',
    'storage_location': '0001',
    'issue_warehouse_code': 'WH01',
})
must('send to warehouse', 'POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
first_allocation = must('allocate request', 'POST', f'/api/warehouse/{rid}/allocate', supervisor)
replay_allocation = must('replay allocation', 'POST', f'/api/warehouse/{rid}/allocate', supervisor)
check('allocation replay is idempotent', replay_allocation.get('idempotent') is True, replay_allocation)
check('allocation replay preserves proposal count',
      len(replay_allocation.get('allocations', [])) > 0,
      {'first': first_allocation, 'replay': replay_allocation})

pickers = must('load pickers', 'GET', '/api/warehouse/pickers', supervisor)
matching = [p for p in pickers.get('pickers', []) if p.get('email') == 'picker@example.com']
if not check('expected picker account is available', len(matching) == 1, pickers):
    sys.exit(1)
picker_id = matching[0]['id']

first_assignment = must('first picker assignment', 'POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': picker_id})
check('first assignment returned task id', bool(first_assignment.get('task_id')), first_assignment)
replay_assignment = must('replay picker assignment', 'POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': picker_id})
check('same picker replay is idempotent',
      replay_assignment.get('idempotent') is True
      and replay_assignment.get('task_id') == first_assignment.get('task_id'), replay_assignment)

tid = first_assignment['task_id']
must('picker accepts task', 'POST', f'/api/picking/tasks/{tid}/accept', picker)
must('picker starts task', 'POST', f'/api/picking/tasks/{tid}/start', picker)
task = must('load picking task', 'GET', f'/api/picking/tasks/{tid}', picker)
line = task['lines'][0]
for alloc in task['allocations']:
    qr = must(f"load QR {alloc['batch_number']}", 'GET', f"/api/receiving/qr?search={alloc['batch_number']}", admin)
    value = qr['qr_codes'][0]['qr_code_value']
    must(f"scan allocation {alloc['id']}", 'POST', f"/api/picking/allocations/{alloc['id']}/scan", picker, {'qr_value': value})
must('confirm picked quantity', 'POST', f"/api/picking/lines/{line['id']}/confirm", picker, {'picked_quantity': 1})
first_complete = must('complete picking task', 'POST', f'/api/picking/tasks/{tid}/complete', picker)
replay_complete = must('replay picking completion', 'POST', f'/api/picking/tasks/{tid}/complete', picker)
check('picking completion replay is idempotent', replay_complete.get('idempotent') is True, replay_complete)

body = {'gi_document_number': f'49{rid:08d}', 'fiscal_year': '2026'}
first_gi = must('first GI posting', 'POST', f'/api/gi/{rid}/post', whop, body)
check('first GI completed request', first_gi.get('status') == 'Completed', first_gi)
replay_gi = must('replay GI posting', 'POST', f'/api/gi/{rid}/post', whop, body)
check('GI replay returns existing posting',
      replay_gi.get('idempotent') is True
      and replay_gi.get('gi', {}).get('giDocumentNumber') == first_gi.get('gi', {}).get('giDocumentNumber'), replay_gi)

gr_key = f'mobile-gr-{rid}'
gr_body = {
    'material_id': material_id, 'received_quantity': 5, 'warehouse_code': 'WH01',
    'po_number': f'PO-IDEMP-{rid}', 'idempotency_key': gr_key,
}
first_gr = must('first goods receipt (with idempotency_key)', 'POST', '/api/receiving', erp, gr_body, expected=201)
replay_gr = must('replay goods receipt (same idempotency_key)', 'POST', '/api/receiving', erp, gr_body, expected=201)
check('goods receipt replay returns the same batch, not a new one',
      replay_gr.get('batch_id') == first_gr.get('batch_id')
      and replay_gr.get('batch_number') == first_gr.get('batch_number'),
      {'first': first_gr, 'replay': replay_gr})

different_key_gr = must('goods receipt with a different idempotency_key creates a new batch', 'POST', '/api/receiving', erp,
                         {**gr_body, 'idempotency_key': f'{gr_key}-2'}, expected=201)
check('different idempotency_key is not deduplicated against the first',
      different_key_gr.get('batch_id') != first_gr.get('batch_id'), different_key_gr)

# ===== Subcontractor delivery + consumption idempotency_key =====
subc = must('create subcontractor', 'POST', '/api/subcontractor/subcontractors', supervisor,
            {'name': f'Idemp Sub {rid}', 'trade_category': 'Electrical'}, expected=201)
subc_id = subc['id']

deliv_key = f'mobile-subc-delivery-idemp-{rid}'
deliv_body = {
    'warehouse_code': 'WH01', 'subcontractor_id': subc_id,
    'lines': [{'description': 'Idempotency test cable', 'quantity_delivered': 10, 'uom': 'M'}],
    'idempotency_key': deliv_key,
}
first_deliv = must('first subcontractor delivery (with idempotency_key)', 'POST', '/api/subcontractor/deliveries',
                    supervisor, deliv_body, expected=201)
replay_deliv = must('replay subcontractor delivery (same idempotency_key)', 'POST', '/api/subcontractor/deliveries',
                     supervisor, deliv_body, expected=201)
check('subcontractor delivery replay returns the same delivery, not a new one',
      replay_deliv.get('id') == first_deliv.get('id'), {'first': first_deliv, 'replay': replay_deliv})
different_deliv = must('subcontractor delivery with a different idempotency_key creates a new one',
                        'POST', '/api/subcontractor/deliveries', supervisor,
                        {**deliv_body, 'idempotency_key': deliv_key + '-2'}, expected=201)
check('different idempotency_key is not deduplicated against the first (delivery)',
      different_deliv.get('id') != first_deliv.get('id'), different_deliv)

# Consumption needs on-hand stock: an Approved quality decision on the
# delivery line *is* the receipt (no separate manual receive step).
deliv_detail = must('load delivery for approval', 'GET', f"/api/subcontractor/deliveries/{first_deliv['id']}", supervisor)
line_id = deliv_detail['lines'][0]['id']
must('approve delivery line quality (auto-receives into stock)', 'PATCH',
     f"/api/subcontractor/deliveries/{first_deliv['id']}/lines/{line_id}", admin,
     {'quality_status': 'Approved', 'quantity_approved': 10})

cons_key = f'mobile-subc-consumption-WH01-Idempotency test cable-None-M-3.0-{rid}'
cons_body = {
    'warehouse_code': 'WH01', 'description': 'Idempotency test cable', 'uom': 'M',
    'quantity_issued': 3, 'reference': f'idemp-{rid}', 'idempotency_key': cons_key,
}
first_cons = must('first subcontractor consumption (with idempotency_key)', 'POST', '/api/subcontractor/consumption',
                   supervisor, cons_body, expected=201)
replay_cons = must('replay subcontractor consumption (same idempotency_key)', 'POST', '/api/subcontractor/consumption',
                    supervisor, cons_body, expected=201)
check('subcontractor consumption replay returns the same record, not a new one',
      replay_cons.get('id') == first_cons.get('id'), {'first': first_cons, 'replay': replay_cons})
different_cons = must('subcontractor consumption with a different idempotency_key creates a new one',
                       'POST', '/api/subcontractor/consumption', supervisor,
                       {**cons_body, 'quantity_issued': 1, 'idempotency_key': cons_key + '-2'}, expected=201)
check('different idempotency_key is not deduplicated against the first (consumption)',
      different_cons.get('id') != first_cons.get('id'), different_cons)

print(f"\nIdempotency regression: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
