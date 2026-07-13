#!/usr/bin/env python3
"""P3 maturity tests:
 1. Segregation of duties: the same user cannot approve and then perform the
    ERP step for one request (distinct users still flow through).
 2. Request attachments: upload / list / download / delete round-trip.
 3. Cycle counting: open -> enter -> post adjusts batch stock by the variance.
 4. Data retention: pruneRetention() deletes aged log rows (never the audit).
Runs in Phase 3 after p2_test on the same fresh database.
"""
import json, urllib.request, urllib.error, os, sys, base64, subprocess

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

def raw_get(path, token=None):
    req = urllib.request.Request(B + path, method='GET')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

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
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']

# ===== 1. Segregation of duties =====
# Grant the ERP operator the 'approvals' permission so one user can attempt both
# the approval and the ERP step on the same request.
_, users = call('GET', '/api/users', admin)
erp_uid = next(u['id'] for u in users['users'] if u['email'] == 'erp@example.com')
_, perms = call('GET', f'/api/users/{erp_uid}/permissions', admin)
approvals_pid = next(p['id'] for p in perms['permissions'] if p['key'] == 'approvals')
erp_pid = next(p['id'] for p in perms['permissions'] if p['key'] == 'erp_operator')
call('PUT', f'/api/users/{erp_uid}/permissions', admin, {'permission_ids': [approvals_pid, erp_pid]})

_, p = call('POST', '/api/requests', requester, {'purpose': 'sod', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 5}]})
sod_rid = p['id']
call('POST', f'/api/requests/{sod_rid}/submit', requester)
c, r = call('POST', f'/api/approvals/{sod_rid}/decision', erp, {'decision': 'approve'})
check('erp (as approver) approves', c == 200, (c, r))
call('PATCH', f'/api/erp-operator/{sod_rid}', erp, {'erp_reservation_number': 'RES-SOD', 'movement_type': '201',
    'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
c, r = call('POST', f'/api/erp-operator/{sod_rid}/send-to-warehouse', erp)
check('SoD blocks same user doing ERP after approving (403)', c == 403, (c, r))
# distinct users still flow: manager approves, erp does ERP
_, p = call('POST', '/api/requests', requester, {'purpose': 'sod-ok', 'cost_center': 'CC-1000', 'plant': 'P100',
    'lines': [{'material_id': BOLT, 'requested_quantity': 5}]})
ok_rid = p['id']
call('POST', f'/api/requests/{ok_rid}/submit', requester)
call('POST', f'/api/approvals/{ok_rid}/decision', manager, {'decision': 'approve'})
call('PATCH', f'/api/erp-operator/{ok_rid}', erp, {'erp_reservation_number': 'RES-OK', 'movement_type': '201',
    'plant': 'P100', 'storage_location': '0001', 'issue_warehouse_code': 'WH01'})
c, r = call('POST', f'/api/erp-operator/{ok_rid}/send-to-warehouse', erp)
check('distinct approver/ERP operator flows through', c == 200, (c, r))

# ===== 2. Attachments =====
payload = base64.b64encode(b'hello attachment file').decode()
c, r = call('POST', f'/api/requests/{ok_rid}/attachments', requester,
    {'file_name': 'note.txt', 'content_type': 'text/plain', 'data_base64': payload})
check('attachment upload', c == 201 and r.get('id'), (c, r))
aid = r.get('id')
c, r = call('GET', f'/api/requests/{ok_rid}/attachments', requester)
check('attachment listed', c == 200 and any(a['id'] == aid for a in r['attachments']), (c, r))
sc, body = raw_get(f'/api/attachments/{aid}/download', requester)
check('attachment download returns bytes', sc == 200 and body == b'hello attachment file', (sc, body[:40]))
c, r = call('POST', f'/api/requests/{ok_rid}/attachments', requester,
    {'file_name': 'bad.exe', 'content_type': 'application/x-msdownload', 'data_base64': payload})
check('unsupported type rejected', c == 400, (c, r))
c, r = call('DELETE', f'/api/attachments/{aid}', requester)
check('attachment delete', c == 200, (c, r))

# ===== 3. Cycle counting =====
_, bat = call('GET', '/api/master/batches?search=MAT-0001', admin)
batch = bat['batches'][0]
before = batch['remaining_quantity']
c, r = call('POST', '/api/cycle-count', supervisor, {'batch_id': batch['id']})
check('cycle count opened', c == 201 and r.get('count_number'), (c, r))
ccid = r['id']
c, r = call('POST', f'/api/cycle-count/{ccid}/count', supervisor, {'counted_quantity': before + 7, 'reason': 'found extra'})
check('cycle count variance computed', c == 200 and abs(r.get('variance', 0) - 7) < 0.001, (c, r))
c, r = call('POST', f'/api/cycle-count/{ccid}/post', supervisor)
check('cycle count posted', c == 200, (c, r))
_, bat2 = call('GET', '/api/master/batches?search=MAT-0001', admin)
after = next(b['remaining_quantity'] for b in bat2['batches'] if b['id'] == batch['id'])
check('batch stock adjusted by variance', abs(after - (before + 7)) < 0.001, (before, after))
# a normal user without cycle_count cannot open a count
c, r = call('POST', '/api/cycle-count', requester, {'batch_id': batch['id']})
check('cycle count requires permission (403)', c == 403, (c, r))

# ===== 4. Data retention =====
code = ("const db=require('./server/db/connection');"
        "db.prepare(\"INSERT INTO notification_log (notification_type, sent_at) VALUES ('OLD', datetime('now','-40 days'))\").run();"
        "const a0=db.prepare('SELECT COUNT(*) n FROM audit_trail').get().n;"
        "const {pruneRetention}=require('./server/services/retention');"
        "const r=pruneRetention(30);"
        "const a1=db.prepare('SELECT COUNT(*) n FROM audit_trail').get().n;"
        "console.log(JSON.stringify({pruned:r.total, auditBefore:a0, auditAfter:a1}));")
p = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True)
try:
    out = json.loads(p.stdout.strip().splitlines()[-1])
    check('retention prunes aged log rows', out['pruned'] >= 1, out)
    check('retention never touches the audit trail', out['auditBefore'] == out['auditAfter'], out)
except Exception as e:
    check('retention test ran', False, f'{e}: {p.stdout} {p.stderr}')

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
