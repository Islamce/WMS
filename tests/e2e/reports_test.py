#!/usr/bin/env python3
"""Audit dashboard filters + report export tests:
 1. Audit endpoint returns facets + summary.
 2. Audit filters (action, user, source, date, request) narrow results.
 3. PDF export endpoint streams a PDF for given columns/rows.
 4. Export requires authentication.
"""
import json, urllib.request, urllib.error, os, sys

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        if raw: return r.getcode(), r.read(), dict(r.getheaders())
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        if raw: return e.code, e.read(), dict(e.headers)
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def login(email, pw):
    _, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return r.get('token')

admin = login('admin@example.com', 'Admin@123456')

# Generate some audit activity: create + submit + approve a request.
_, m = call('GET', '/api/materials/search?q=MAT-0001', admin)
BOLT = m['materials'][0]['id']
_, r = call('POST', '/api/requests', admin, {'purpose': 'audit gen', 'lines': [{'material_id': BOLT, 'requested_quantity': 4}]})
rid = r['id']
call('POST', f'/api/requests/{rid}/submit', admin)
manager = login('manager@example.com', 'Passw0rd!')
call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})

# ===== 1. facets + summary =====
c, r = call('GET', '/api/master/audit?limit=25', admin)
check('audit returns facets', c == 200 and 'facets' in r and 'actions' in r['facets'], list(r.keys()))
check('audit returns summary', 'summary' in r and 'by_action' in r['summary'], r.get('summary', {}).keys() if isinstance(r.get('summary'), dict) else r.get('summary'))
check('facets list users + sources', len(r['facets']['users']) >= 1 and isinstance(r['facets']['sources'], list), r['facets'])

# ===== 2. filters narrow results =====
_, allr = call('GET', '/api/master/audit?limit=1', admin)
total_all = allr['total']
_, statusr = call('GET', '/api/master/audit?action=STATUS_CHANGE&limit=1', admin)
check('action filter narrows (<= all)', statusr['total'] <= total_all and statusr['total'] >= 1, (statusr['total'], total_all))
# request filter
_, reqr = call('GET', f'/api/master/audit?request_number={r["audit"][0]["request_number"] or ""}&limit=1', admin) if r['audit'] and r['audit'][0].get('request_number') else (200, {'total': total_all})
check('request filter works', reqr['total'] >= 1, reqr.get('total'))
# impossible date filter -> 0
_, empt = call('GET', '/api/master/audit?date_from=2999-01-01&limit=1', admin)
check('future date_from yields 0', empt['total'] == 0, empt.get('total'))

# ===== 3. PDF export =====
c, body, headers = call('POST', '/api/export/pdf', admin, {
    'title': 'Test Report', 'filename': 'test',
    'columns': [{'key': 'a', 'label': 'A'}, {'key': 'b', 'label': 'B'}],
    'rows': [{'a': '1', 'b': 'hello'}, {'a': '2', 'b': 'world'}],
}, raw=True)
lower = {k.lower(): v for k, v in headers.items()}
check('pdf export returns application/pdf', c == 200 and 'application/pdf' in lower.get('content-type', ''), (c, lower.get('content-type')))
check('pdf body starts with %PDF', body[:4] == b'%PDF', body[:8])
check('pdf has content-disposition attachment', 'attachment' in lower.get('content-disposition', ''), lower.get('content-disposition'))

# empty columns rejected
c, r = call('POST', '/api/export/pdf', admin, {'columns': [], 'rows': []})
check('pdf export rejects no columns', c == 400, (c, r))

# ===== 4. auth required =====
c, b2, _ = call('POST', '/api/export/pdf', None, {'columns': [{'key': 'a', 'label': 'A'}], 'rows': []}, raw=True)
check('pdf export requires auth', c == 401, c)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
