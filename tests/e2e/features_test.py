#!/usr/bin/env python3
"""Tests for: AI analytics, PDF labels, mass upload, quality inspection step."""
import json, urllib.request, urllib.error, os
B = "http://localhost:3000"; os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0; fails = []

def call(method, path, token=None, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        if raw: return r.getcode(), r.headers.get('Content-Type'), r.read()
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        if raw: return e.code, e.headers.get('Content-Type'), b''
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

def check(n, c, d=''):
    global passed, failed
    if c: passed += 1; print("PASS:", n)
    else: failed += 1; fails.append(n); print("FAIL:", n, d)

def login(e, p):
    _, r = call('POST', '/api/auth/login', body={'email': e, 'password': p}); return r.get('token')

admin = login('admin@example.com', 'Admin@123456')
manager = login('manager@example.com', 'Passw0rd!')
requester = login('requester@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
quality = login('quality@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')

# ===== AI analytics =====
c, r = call('GET', '/api/analytics', manager)
check('AI: manager can access analytics', c == 200, c)
s = r.get('summary', {})
check('AI: classifications present', s.get('fast_count', 0) >= 3 and s.get('slow_count', 0) >= 3 and s.get('dead_count', 0) >= 3, s)
check('AI: dead stock value computed', s.get('dead_stock_value', 0) > 0, s)
check('AI: below-reorder detected', s.get('below_reorder_count', 0) >= 1, s)
check('AI: insights generated', len(r.get('insights', [])) >= 3, [i['title'] for i in r.get('insights', [])])
check('AI: weekly trend series', len(r.get('weekly_trend', [])) >= 8, len(r.get('weekly_trend', [])))
check('AI: reorder point fields', all(k in r['items'][0] for k in ('safety_stock', 'reorder_point', 'days_of_cover', 'classification')), r['items'][0].keys())
c, r = call('GET', '/api/analytics', requester)
check('AI: requester blocked (permission)', c == 403, c)

# ===== PDF labels =====
c, r = call('GET', '/api/receiving/qr?search=', admin)
ids = [q['id'] for q in r['qr_codes'][:3]]
c, ctype, body = call('GET', f"/api/receiving/qr/pdf?ids={','.join(map(str, ids))}", supervisor, raw=True)
check('PDF: streams application/pdf', c == 200 and 'pdf' in (ctype or ''), (c, ctype))
check('PDF: non-trivial size + %PDF header', len(body) > 2000 and body[:4] == b'%PDF', len(body))
c, q2 = call('GET', '/api/receiving/qr?search=', admin)
printed = next(q for q in q2['qr_codes'] if q['id'] == ids[0])
check('PDF: print_count incremented', printed['print_count'] >= 1, printed['print_count'])

# ===== Mass upload =====
c, r = call('POST', '/api/materials/bulk', admin, {'rows': [
    {'plant': 'P100', 'item_code': 'MAT-9001', 'description': 'Bulk Item A', 'unit': 'EA', 'price': '1.5'},
    {'plant': 'P100', 'item_code': 'MAT-9002', 'description': 'Bulk Item B', 'unit': 'KG', 'price': '2'},
    {'plant': 'P100', 'item_code': 'MAT-9001', 'description': 'dup', 'unit': 'EA'},
    {'plant': 'P100', 'item_code': '', 'description': 'missing code'},
]})
check('Bulk materials: 2 created, 1 skipped, 1 error', r.get('created') == 2 and r.get('skipped') == 1 and r.get('errors') == 1, r)
c, r = call('POST', '/api/master/bins/bulk', admin, {'rows': [
    {'warehouse_code': 'WH01', 'zone': 'ZB', 'rack': 'R09', 'line_or_aisle': '01', 'level': '02', 'column_number': '11'},
    {'warehouse_code': 'NOPE', 'zone': 'ZB', 'rack': 'R09'},
]})
check('Bulk bins: 1 created, 1 error', r.get('created') == 1 and r.get('errors') == 1, r)
c, r = call('POST', '/api/materials/bulk', picker, {'rows': [{'item_code': 'X', 'description': 'x'}]})
check('Bulk materials: picker blocked', c == 403, c)

# ===== Quality inspection step =====
# receive a batch -> must be QUALITY_HOLD
c, matres = call('GET', '/api/materials/search?q=MAT-9001', admin)
mid = matres['materials'][0]['id']
c, r = call('POST', '/api/receiving', supervisor, {'material_id': mid, 'po_number': 'PO-Q1',
    'received_quantity': 50, 'warehouse_code': 'WH01'})
check('Quality: receipt lands on QUALITY_HOLD', c == 201 and r['qr']['quality_status'] == 'QUALITY_HOLD', r.get('qr', {}).get('quality_status'))
batch_no = r['batch_number']
c, pend = call('GET', '/api/master/batches?quality=QUALITY_HOLD', quality)
bid = next((b['id'] for b in pend['batches'] if b['batch_number'] == batch_no), None)
check('Quality: batch in pending-inspection queue', bid is not None)
# supervisor (not quality role, no quality perm) cannot change quality
c, r = call('POST', f'/api/master/batches/{bid}/quality', supervisor, {'quality_status': 'RELEASED'})
check('Quality: non-quality role blocked', c == 403, c)
# quality releases it
c, r = call('POST', f'/api/master/batches/{bid}/quality', quality, {'quality_status': 'RELEASED', 'reason': 'passed'})
check('Quality: quality user releases batch', c == 200, r)
c, pend2 = call('GET', '/api/master/batches?quality=QUALITY_HOLD', quality)
check('Quality: leaves pending queue after release', all(b['id'] != bid for b in pend2['batches']))
# quality role received notification of the inspection request
c, notif = call('GET', '/api/notifications', quality)
check('Quality: inspection notification sent', any(n['notification_type'] == 'QUALITY_INSPECTION_NEEDED' for n in notif['notifications']))

# ===== Ledger =====
# The receipt above must appear as an IN movement (analytics data source).
c, dash = call('GET', '/api/analytics', admin)
item = next((i for i in dash['items'] if i['item_code'] == 'MAT-9001'), None)
check('Ledger: received qty visible to analytics', item is not None and item['current_stock'] >= 50, item)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)

import sys
sys.exit(1 if failed else 0)
