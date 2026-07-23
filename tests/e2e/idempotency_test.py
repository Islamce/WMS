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


def login(email, password):
    code, payload = call('POST', '/api/auth/login', body={'email': email, 'password': password})
    check(f'login {email}', code == 200 and bool(payload.get('token')), payload)
    return payload.get('token')


requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
whop = login('whoperator@example.com', 'Passw0rd!')
admin = login('admin@example.com', 'Admin@123456')

code, payload = call('GET', '/api/materials/search?q=MAT-0001', admin)
material_id = payload['materials'][0]['id']

code, payload = call('POST', '/api/requests', requester, {
    'purpose': 'Idempotency regression',
    'priority': 'NORMAL',
    'cost_center': 'CC-IDEMP',
    'plant': 'P100',
    'lines': [{'material_id': material_id, 'requested_quantity': 1}],
})
check('create request', code == 201, payload)
rid = payload['id']
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{rid}', erp, {
    'erp_reservation_number': f'RES-IDEMP-{rid}',
    'movement_type': '201',
    'plant': 'P100',
    'storage_location': '0001',
    'issue_warehouse_code': 'WH01',
})
call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
code, payload = call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
check('allocate', code == 200, payload)

code, pickers = call('GET', '/api/warehouse/pickers', supervisor)
picker_id = pickers['pickers'][0]['id']
code, first_assignment = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': picker_id})
check('first picker assignment', code == 200 and first_assignment.get('task_id'), first_assignment)
code, replay_assignment = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': picker_id})
check('same picker replay is idempotent',
      code == 200 and replay_assignment.get('idempotent') is True
      and replay_assignment.get('task_id') == first_assignment.get('task_id'), replay_assignment)

tid = first_assignment['task_id']
call('POST', f'/api/picking/tasks/{tid}/accept', picker)
call('POST', f'/api/picking/tasks/{tid}/start', picker)
code, task = call('GET', f'/api/picking/tasks/{tid}', picker)
line = task['lines'][0]
for alloc in task['allocations']:
    code, qr = call('GET', f"/api/receiving/qr?search={alloc['batch_number']}", admin)
    value = qr['qr_codes'][0]['qr_code_value']
    call('POST', f"/api/picking/allocations/{alloc['id']}/scan", picker, {'qr_value': value})
call('POST', f"/api/picking/lines/{line['id']}/confirm", picker, {'picked_quantity': 1})
call('POST', f'/api/picking/tasks/{tid}/complete', picker)

body = {'gi_document_number': f'49{rid:08d}', 'fiscal_year': '2026'}
code, first_gi = call('POST', f'/api/gi/{rid}/post', whop, body)
check('first GI posting', code == 200 and first_gi.get('status') == 'Completed', first_gi)
code, replay_gi = call('POST', f'/api/gi/{rid}/post', whop, body)
check('GI replay returns existing posting',
      code == 200 and replay_gi.get('idempotent') is True
      and replay_gi.get('gi', {}).get('giDocumentNumber') == first_gi.get('gi', {}).get('giDocumentNumber'), replay_gi)

print(f"\nIdempotency regression: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
