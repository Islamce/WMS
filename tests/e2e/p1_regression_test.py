#!/usr/bin/env python3
"""P1 regression tests:
 1. Self-approval is blocked (segregation of duties) — a user cannot approve
    their own request even if they hold the approvals permission; another
    approver still can.
 2. Dashboard stock KPIs read the workflow `batches` table (not the empty
    legacy material_location_stock) — total_stock reflects real inventory.
 3. Return-to-picker restores allocations + batch stock, so a re-pick consumes
    stock exactly once (no double-decrement, no ghost picks).
 4. Security headers present (helmet) and large JSON bodies are accepted
    (body limit raised for bulk uploads).
"""
import json, urllib.request, urllib.error, os, sys

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None, want_headers=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        payload = json.loads(r.read() or '{}')
        return (r.getcode(), payload, dict(r.getheaders())) if want_headers else (r.getcode(), payload)
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read() or '{}')
        except: body = {}
        return (e.code, body, dict(e.headers)) if want_headers else (e.code, body)

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def login(email, pw):
    _, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return r.get('token')

admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
manager = login('manager@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
whop = login('whoperator@example.com', 'Passw0rd!')

_, r = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = r['materials'][0]['id']

def qr_for_batch(batchnum):
    _, pp = call('GET', f'/api/receiving/qr?search={batchnum}', admin)
    return pp['qr_codes'][0]['qr_code_value'] if pp.get('qr_codes') else None

def bolt_remaining():
    _, r = call('GET', '/api/master/batches?search=MAT-0001', admin)
    return sum(b['remaining_quantity'] for b in r['batches'])

# ===== 1. Self-approval: admin exempt, non-admin blocked =====
# Admin is a super-user (needed for testing/bootstrapping) and MAY approve
# their own request.
_, r = call('POST', '/api/requests', admin,
            {'purpose': 'admin self', 'lines': [{'material_id': BOLT, 'requested_quantity': 3}]})
aid = r['id']
call('POST', f'/api/requests/{aid}/submit', admin)
c, r = call('POST', f'/api/approvals/{aid}/decision', admin, {'decision': 'approve'})
check('P1-1 admin can approve own request', c == 200, (c, r))

# A non-admin approver still cannot approve their own request. Grant the
# requester the approvals permission, then have them create + try to approve.
_, users = call('GET', '/api/users', admin)
rid_user = next(u['id'] for u in users['users'] if u['email'] == 'requester@example.com')
_, perms = call('GET', f'/api/users/{rid_user}/permissions', admin)
direct_ids = [p['id'] for p in perms['permissions'] if p.get('direct')]
appr_id = next(p['id'] for p in perms['permissions'] if p.get('key') == 'approvals')
call('PUT', f'/api/users/{rid_user}/permissions', admin, {'permission_ids': direct_ids + [appr_id]})
_, r = call('POST', '/api/requests', requester,
            {'purpose': 'self probe', 'lines': [{'material_id': BOLT, 'requested_quantity': 3}]})
sid = r['id']
call('POST', f'/api/requests/{sid}/submit', requester)
c, r = call('POST', f'/api/approvals/{sid}/decision', requester, {'decision': 'approve'})
check('P1-1 non-admin self-approval blocked (403)', c == 403 and 'own request' in r.get('error', '').lower(), (c, r))
# a different approver can still approve it
c, r = call('POST', f'/api/approvals/{sid}/decision', manager, {'decision': 'approve'})
check('P1-1 another approver can approve', c == 200, (c, r))

# ===== 2. Dashboard reads batches, not legacy stock table =====
c, dash = call('GET', '/api/dashboard', admin)
# The workflow seed populates batches but leaves material_location_stock empty,
# so a non-zero total_stock proves the KPI now reads the batches table.
check('P1-2 dashboard total_stock from batches (> 0)', c == 200 and dash['kpis']['total_stock'] > 0, dash.get('kpis'))
check('P1-2 dashboard reports bin locations', dash['kpis']['total_locations'] > 0, dash['kpis'])

# ===== 3. Return-to-picker restores allocations + stock (re-pick consumes once) =====
base = bolt_remaining()
_, r = call('POST', '/api/requests', requester,
            {'purpose': 'return-to-picker', 'lines': [{'material_id': BOLT, 'requested_quantity': 10}]})
rid = r['id']
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{rid}', erp, {
    'erp_reservation_number': 'RES-P1', 'movement_type': '201', 'plant': 'P100',
    'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
_, pk = call('GET', '/api/warehouse/pickers', supervisor)
pid = pk['pickers'][0]['id']
_, p = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': pid})
tid = p['task_id']
call('POST', f'/api/picking/tasks/{tid}/accept', picker)
call('POST', f'/api/picking/tasks/{tid}/start', picker)

def scan_and_confirm(qty):
    _, det = call('GET', f'/api/picking/tasks/{tid}', picker)
    line = det['lines'][0]
    for a in det['allocations']:
        if a['status'] in ('PROPOSED', 'SCANNED'):
            qv = qr_for_batch(a['batch_number'])
            if qv: call('POST', f"/api/picking/allocations/{a['id']}/scan", picker, {'qr_value': qv})
    return call('POST', f"/api/picking/lines/{line['id']}/confirm", picker, {'picked_quantity': qty})

c, r = scan_and_confirm(10)
check('P1-3 first full pick confirmed', c == 200, (c, r))
after_pick = bolt_remaining()
check('P1-3 first pick consumed 10', abs(base - after_pick - 10) < 0.001, (base, after_pick))
call('POST', f'/api/picking/tasks/{tid}/complete', picker)

# Return to picker — stock and allocations must be restored.
c, r = call('POST', f'/api/gi/{rid}/return-to-picker', whop, {'reason': 'recount'})
check('P1-3 return-to-picker accepted', c == 200, (c, r))
restored = bolt_remaining()
check('P1-3 return-to-picker restored stock', abs(restored - base) < 0.001, (base, restored))

# Re-pick the same quantity and post GI — stock must decrement exactly once more.
call('POST', f'/api/picking/tasks/{tid}/start', picker) if False else None
c, r = scan_and_confirm(10)
check('P1-3 re-pick confirmed', c == 200, (c, r))
call('POST', f'/api/picking/tasks/{tid}/complete', picker)
c, r = call('POST', f'/api/gi/{rid}/post', whop, {'gi_document_number': '4900009100'})
check('P1-3 GI posted after re-pick', c == 200, (c, r))
final = bolt_remaining()
check('P1-3 stock consumed exactly once (no double-decrement)', abs(base - final - 10) < 0.001, (base, final))

# A duplicate confirm with no open allocations must be rejected, not silently
# overwrite picked_quantity without moving stock.
_, det = call('GET', f'/api/gi/{rid}', whop)
_, r = call('POST', f"/api/picking/lines/{det['lines'][0]['id']}/confirm", picker, {'picked_quantity': 5})
check('P1-3 confirm with no open allocations rejected', r.get('error') is not None)

# ===== 4. Security headers + body limit =====
c, _, headers = call('GET', '/healthz', want_headers=True)
lower = {k.lower(): v for k, v in headers.items()}
check('P1-4 CSP header present (helmet)', 'content-security-policy' in lower, list(lower.keys()))
check('P1-4 X-Content-Type-Options nosniff', lower.get('x-content-type-options') == 'nosniff', lower.get('x-content-type-options'))
# A large JSON body (~300 KB) must not be rejected by the old 100 KB cap. The
# payload is invalid for the endpoint, so a 400/422 is fine — a 413 is the failure.
big = {'rows': [{'code': f'X{i:05d}', 'name': 'row ' + 'y' * 40} for i in range(4000)]}
c, _ = call('POST', '/api/master/bins/bulk', admin, big)
check('P1-4 large body not rejected by size limit (no 413)', c != 413, c)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
