#!/usr/bin/env python3
"""P2 enterprise-completeness tests:
 1. Goods Issue reversal returns issued stock to its batch and closes the
    request as Reversed.
 2. Approval matrix: a high-value request is blocked for a normal approver
    (manager) and allowed for an authorised one (admin).
 3. Email channel: an approval records an EMAIL notification_log row.
 4. Password policy: weak passwords are rejected on signup.
 5. Global API rate limiter: the pure check() blocks past the max.
Runs on a fresh, fully seeded database (its own phase) so stock is pristine.
"""
import json, urllib.request, urllib.error, os, sys, sqlite3, subprocess

B = "http://localhost:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, 'data', 'wms.db')
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
whop = login('whoperator@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

def bolt_remaining():
    _, r = call('GET', '/api/master/batches?search=MAT-0001', admin)
    return sum(b['remaining_quantity'] for b in r['batches'])

def qr_for_batch(batchnum):
    _, pp = call('GET', f'/api/receiving/qr?search={batchnum}', admin)
    return pp['qr_codes'][0]['qr_code_value'] if pp.get('qr_codes') else None

# ===== 1. Full flow to Completed, then reverse =====
_, p = call('POST', '/api/requests', requester, {'purpose': 'reverse me', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 30}]})
rid = p['id']
call('POST', f'/api/requests/{rid}/submit', requester)
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{rid}', erp, {'erp_reservation_number': 'RES-REV', 'movement_type': '201',
    'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
call('POST', f'/api/erp-operator/{rid}/send-to-warehouse', erp)
call('POST', f'/api/warehouse/{rid}/allocate', supervisor)
_, pk = call('GET', '/api/warehouse/pickers', supervisor)
_, p = call('POST', f'/api/warehouse/{rid}/assign-picker', supervisor, {'picker_id': pk['pickers'][0]['id']})
tid = p['task_id']
call('POST', f'/api/picking/tasks/{tid}/accept', picker)
call('POST', f'/api/picking/tasks/{tid}/start', picker)
_, p = call('GET', f'/api/picking/tasks/{tid}', picker)
allocs, line1 = p['allocations'], p['lines'][0]
for a in allocs:
    call('POST', f"/api/picking/allocations/{a['id']}/scan", picker, {'qr_value': qr_for_batch(a['batch_number'])})
call('POST', f"/api/picking/lines/{line1['id']}/confirm", picker, {'picked_quantity': 30})
call('POST', f'/api/picking/tasks/{tid}/complete', picker)
c, p = call('POST', f'/api/gi/{rid}/post', whop, {'gi_document_number': '4900009001', 'fiscal_year': '2026'})
check('flow reaches Completed', c == 200 and p.get('status') == 'Completed', p)

after_gi = bolt_remaining()
# reverse: reason required
c, r = call('POST', f'/api/gi/{rid}/reverse', whop, {})
check('reverse without reason rejected (400)', c == 400, (c, r))
c, r = call('POST', f'/api/gi/{rid}/reverse', whop, {'reason': 'wrong cost center'})
check('reverse succeeds', c == 200 and r.get('reversal'), (c, r))
check('reversal returns 30 units to stock', bolt_remaining() - after_gi >= 30 - 0.001, (after_gi, bolt_remaining()))
_, det = call('GET', f'/api/requests/{rid}', requester)
check('request now Reversed', det['request']['request_status'] == 'Reversed', det['request']['request_status'])
# a second reverse is rejected
c, r = call('POST', f'/api/gi/{rid}/reverse', whop, {'reason': 'again'})
check('double reverse rejected (400)', c == 400, (c, r))

# ===== 2. Approval matrix =====
c, r = call('GET', '/api/approvals/matrix', manager)
check('matrix endpoint lists thresholds', c == 200 and len(r.get('thresholds', [])) >= 1, r)
# high-value request: 5000 bolts * 0.35 = 1750 >= 1000
_, p = call('POST', '/api/requests', requester, {'purpose': 'big buy', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 5000}]})
hv = p['id']
call('POST', f'/api/requests/{hv}/submit', requester)
c, r = call('POST', f'/api/approvals/{hv}/decision', manager, {'decision': 'approve'})
check('high-value blocked for manager (403)', c == 403 and r.get('required_permission') == 'approvals_high_value', (c, r))
c, r = call('POST', f'/api/approvals/{hv}/decision', admin, {'decision': 'approve'})
check('high-value approved by admin', c == 200, (c, r))
# low-value still fine for manager
_, p = call('POST', '/api/requests', requester, {'purpose': 'small', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 5}]})
lv = p['id']
call('POST', f'/api/requests/{lv}/submit', requester)
c, r = call('POST', f'/api/approvals/{lv}/decision', manager, {'decision': 'approve'})
check('low-value approved by manager', c == 200, (c, r))

# ===== 3. Email channel recorded =====
con = sqlite3.connect(DB, timeout=5)
try:
    n = con.execute("SELECT COUNT(*) FROM notification_log WHERE channel='EMAIL'").fetchone()[0]
    check('email-channel notifications recorded', n >= 1, n)
finally:
    con.close()

# ===== 4. Password policy =====
c, r = call('POST', '/api/auth/signup', body={'name': 'X', 'email': 'weakpw1@example.com', 'password': 'short1'})
check('short password rejected', c == 400, (c, r))
c, r = call('POST', '/api/auth/signup', body={'name': 'X', 'email': 'weakpw2@example.com', 'password': 'allletters'})
check('letters-only password rejected', c == 400, (c, r))
c, r = call('POST', '/api/auth/signup', body={'name': 'X', 'email': 'goodpw@example.com', 'password': 'Str0ngPass'})
check('valid password accepted', c == 201, (c, r))

# ===== 5. Global rate limiter (pure check) =====
code = ("const {check}=require('./server/middleware/apiRateLimit');"
        "const out=[];for(let i=0;i<5;i++){out.push(check('k',3,60000,1000).allowed);}"
        "console.log(JSON.stringify(out));")
p = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True)
try:
    out = json.loads(p.stdout.strip().splitlines()[-1])
    check('rate limiter allows up to max', out[:3] == [True, True, True], out)
    check('rate limiter blocks past max', out[3] is False and out[4] is False, out)
except Exception as e:
    check('rate limiter test ran', False, f'{e}: {p.stdout} {p.stderr}')

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
