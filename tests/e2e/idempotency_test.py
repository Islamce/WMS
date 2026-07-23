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

created = must('create request', 'POST', '/api/requests', requester, {
    'purpose': 'Idempotency regression',
    'priority': 'NORMAL',
    'cost_center': 'CC-IDEMP',
    'plant': 'P100',
    'lines': [{'material_id': material_id, 'requested_quantity': 1}],
}, expected=201)
rid = created['id']

must('submit request', 'POST', f'/api/requests/{rid}/submit', requester)
must('approve request', 'POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
must('save ERP details', 'PATCH', f'/api/erp-operator/{rid}', erp, {
    'erp_reservation_number': f'RES-IDEMP-{rid}',
    'movement_type': '201',
    'plant': 'P100',
    'storage_location': '0001',
    'issue_warehouse_code': 'WH01',
})
must('send to warehouse', 'POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
must('allocate request', 'POST', f'/api/warehouse/{rid}/allocate', supervisor)

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
must('complete picking task', 'POST', f'/api/picking/tasks/{tid}/complete', picker)

body = {'gi_document_number': f'49{rid:08d}', 'fiscal_year': '2026'}
first_gi = must('first GI posting', 'POST', f'/api/gi/{rid}/post', whop, body)
check('first GI completed request', first_gi.get('status') == 'Completed', first_gi)
replay_gi = must('replay GI posting', 'POST', f'/api/gi/{rid}/post', whop, body)
check('GI replay returns existing posting',
      replay_gi.get('idempotent') is True
      and replay_gi.get('gi', {}).get('giDocumentNumber') == first_gi.get('gi', {}).get('giDocumentNumber'), replay_gi)

print(f"\nIdempotency regression: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
