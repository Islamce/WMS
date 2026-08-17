#!/usr/bin/env python3
"""Regression coverage for approved web-only request-line and picker-state visibility."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'http://localhost:3000'
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
failures = []
ROOT = Path(__file__).resolve().parents[2]


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', 'Bearer ' + token)
    try:
        response = urllib.request.urlopen(request)
        return response.getcode(), json.loads(response.read() or '{}')
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or '{}')
        except Exception:
            return error.code, {}


def check(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print('PASS:', name)
    else:
        failed += 1
        failures.append(name)
        print('FAIL:', name, detail)


def login(email, password):
    _, payload = call('POST', '/api/auth/login', body={'email': email, 'password': password})
    return payload.get('token')


admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')

_, material_one = call('GET', '/api/materials/search?q=MAT-0001', admin)
_, material_two = call('GET', '/api/materials/search?q=MAT-0002', admin)
first_id = material_one['materials'][0]['id']
second_id = material_two['materials'][0]['id']

# Build a two-line request to prove that the existing request-detail contract
# carries the exact data required by ERP context and dashboard expansion.
_, created = call('POST', '/api/requests', requester, {
    'purpose': 'visibility-regression',
    'cost_center': 'CC-1000',
    'plant': 'P100',
    'lines': [
        {'material_id': first_id, 'requested_quantity': 2},
        {'material_id': second_id, 'requested_quantity': 3},
    ],
})
rid = created.get('id')
check('two-line request created', bool(rid), created)
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{rid}', erp, {
    'erp_reservation_number': f'RES-VIS-{rid}',
    'erp_reference_number': f'ERP-VIS-{rid}',
    'movement_type': '201',
    'plant': 'P100',
    'storage_location': '0001',
    'issue_warehouse_code': 'WH01',
})

_, detail = call('GET', f'/api/requests/{rid}', erp)
lines = detail.get('lines', [])
check('existing request detail returns both material lines', len(lines) == 2, lines)
check('request detail lines carry item, description, quantity, and UoM', all(
    line.get('material_code') and line.get('material_description') and
    line.get('requested_quantity') is not None and line.get('uom')
    for line in lines
), lines)

call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
supervisor_detail_status, supervisor_detail = call('GET', f'/api/requests/{rid}', supervisor)
check('Warehouse Dashboard can reuse request-detail lines without a new API or permission',
      supervisor_detail_status == 200 and len(supervisor_detail.get('lines', [])) == 2,
      supervisor_detail)
_, before_allocate = call('GET', '/api/warehouse/queue', supervisor)
pre_row = next((row for row in before_allocate.get('requests', []) if row.get('id') == rid), {})
check('warehouse queue keeps a compact line count before expansion', pre_row.get('total_lines') == 2, pre_row)
check('unassigned queue row has no active picker task', pre_row.get('active_task_id') is None, pre_row)

call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
_, pickers = call('GET', '/api/warehouse/pickers', supervisor)
picker_id = pickers['pickers'][0]['id']
picker_name = pickers['pickers'][0]['name']
_, assignment = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': picker_id})
check('manual picker assignment created an active task', bool(assignment.get('task_id')), assignment)

_, assigned_queue = call('GET', '/api/warehouse/queue', supervisor)
assigned_row = next((row for row in assigned_queue.get('requests', []) if row.get('id') == rid), {})
check('queue returns active task identity after manual assignment',
      assigned_row.get('active_task_id') == assignment.get('task_id') and
      assigned_row.get('active_assigned_picker_id') == picker_id and
      assigned_row.get('active_assigned_picker_name') == picker_name,
      assigned_row)
check('queue returns awaiting-acceptance task status without false escalation',
      assigned_row.get('active_task_status') == 'Pending Picker Acceptance' and
      assigned_row.get('active_reminder_count') == 0,
      assigned_row)

# At 11 minutes the normal-priority task has received its two reminders, but
# has not reached supervisor escalation. It must remain visible with the same
# assigned picker instead of disappearing from assignment context.
call('POST', '/api/picking/sweep', supervisor, {'testMinutes': 11})
_, reminder_queue = call('GET', '/api/warehouse/queue', supervisor)
reminder_row = next((row for row in reminder_queue.get('requests', []) if row.get('id') == rid), {})
check('Reminder Sent remains in warehouse queue', reminder_row.get('request_status') == 'Reminder Sent', reminder_row)
check('Reminder Sent preserves assigned picker and reminder evidence',
      reminder_row.get('active_assigned_picker_id') == picker_id and
      reminder_row.get('active_assigned_picker_name') == picker_name and
      reminder_row.get('active_task_status') == 'Reminder Sent' and
      reminder_row.get('active_reminder_count') == 2,
      reminder_row)

# At 16 minutes the existing task escalates. The original picker must remain
# visible until an authorized supervisor explicitly uses the existing reassign
# action; no automatic unassignment is allowed.
call('POST', '/api/picking/sweep', supervisor, {'testMinutes': 16})
_, escalated_queue = call('GET', '/api/warehouse/queue', supervisor)
escalated_row = next((row for row in escalated_queue.get('requests', []) if row.get('id') == rid), {})
check('escalated task remains in assignment queue', escalated_row.get('request_status') == 'Escalated to Supervisor', escalated_row)
check('escalation retains original picker and exposes escalation evidence',
      escalated_row.get('active_assigned_picker_id') == picker_id and
      escalated_row.get('active_assigned_picker_name') == picker_name and
      escalated_row.get('active_task_status') == 'Escalated to Supervisor' and
      escalated_row.get('active_escalation_level') == 1,
      escalated_row)

# Focused source guards protect the explicit web boundaries without claiming a
# new API, permission, mobile surface, or automatic reassignment behavior.
erp_source = (ROOT / 'public/js/pages/erpOperator.js').read_text()
warehouse_source = (ROOT / 'public/js/pages/giPosting.js').read_text()
picker_source = (ROOT / 'public/js/pages/pickerAssign.js').read_text()
check('ERP page renders the read-only requested-material summary',
      'eo-material-lines' in erp_source and 'Requested Materials' in erp_source and
      'UI.materialDisclosure({' in erp_source and 'requestStageIndicator(r)' in erp_source)
check('warehouse dashboard has an explicit lazy material disclosure and preserves request navigation',
      'UI.materialDisclosure({' in warehouse_source and 'details.addEventListener(\'toggle\'' in warehouse_source and
      'Api.get(`/api/requests/${id}`)' in warehouse_source and 'link: `#/request-detail/${request.id}`' in warehouse_source and
      "tr[data-id]" not in warehouse_source)
check('picker page keeps reminder/escalation evidence visible and requires explicit reassignment',
      "'Reminder Sent'" in picker_source and 'active_assigned_picker_name' in picker_source and
      "const action = escalated ? 'Reassign' : 'Assign';" in picker_source and 'Awaiting picker response' in picker_source)

print(f'\n===== RESULT: {passed} passed, {failed} failed =====')
if failures:
    print('Failed:', failures)
sys.exit(1 if failed else 0)
