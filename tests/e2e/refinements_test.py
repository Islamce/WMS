#!/usr/bin/env python3
"""Test the new refinements: dropdowns/meta, optional purpose, material search
with availability, goods-receipt rework (auto batch, PO required, GR#/bin steps)."""
import json, urllib.request, urllib.error, os
B = "http://localhost:3000"; os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0; fails = []

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req); return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

def check(n, c, d=''):
    global passed, failed
    if c: passed += 1; print("PASS:", n)
    else: failed += 1; fails.append(n); print("FAIL:", n, d)

def login(e, p):
    _, r = call('POST', '/api/auth/login', body={'email': e, 'password': p}); return r.get('token')

admin = login('admin@example.com', 'Admin@123456')
requester = login('requester@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
erp = login('erp@example.com', 'Passw0rd!')
picker = login('picker@example.com', 'Passw0rd!')

# meta has dropdown lists
c, m = call('GET', '/api/meta', requester)
check('meta departments', c == 200 and len(m.get('departments', [])) >= 4, m.get('departments'))
check('meta plants', len(m.get('plants', [])) >= 2, m.get('plants'))
check('meta costCenters', len(m.get('costCenters', [])) >= 4, m.get('costCenters'))

# material search: empty query returns list + total_available field
c, s = call('GET', '/api/materials/search?q=', requester)
check('material search empty returns list', c == 200 and len(s['materials']) > 0, c)
check('material search has total_available', 'total_available' in (s['materials'][0] if s['materials'] else {}), s['materials'][:1])

# create request WITHOUT purpose (now optional)
c, r = call('POST', '/api/requests', requester, {'lines': [{'material_id': s['materials'][0]['id'], 'requested_quantity': 5}]})
check('create request without purpose', c == 201, r)
rid = r.get('id')
c, r2 = call('POST', f'/api/requests/{rid}/submit', requester)
check('submit request', c == 200, r2)

# --- Goods Receipt rework ---
# PO mandatory
c, r = call('POST', '/api/receiving', supervisor, {'material_id': 2, 'received_quantity': 100, 'warehouse_code': 'WH01'})
check('receiving requires PO', c == 400 and 'PO' in r.get('error', ''), r)
# batch number NOT provided -> auto-generated; bin not provided -> null
c, r = call('POST', '/api/receiving', supervisor, {'material_id': 2, 'received_quantity': 100, 'warehouse_code': 'WH01', 'po_number': 'PO-9001'})
check('receiving auto-generates batch', c == 201 and r.get('batch_number', '').startswith('B-'), r)
batch_no = r.get('batch_number'); qr_val = r['qr']['qr_code_value']
check('receiving QR has no bin yet', r['qr'].get('bin_location') in (None, ''), r['qr'].get('bin_location'))

# batch shows up in pending-gr and pending-bin
c, pg = call('GET', '/api/receiving/pending-gr', erp)
bid = next((b['id'] for b in pg['batches'] if b['batch_number'] == batch_no), None)
check('batch appears in pending-GR (erp operator)', bid is not None, [b['batch_number'] for b in pg['batches']])
# set GR number (erp operator)
c, r = call('PATCH', f'/api/receiving/batches/{bid}/gr', erp, {'gr_number': 'GR-9001'})
check('erp operator sets GR number', c == 200, r)
# now not in pending-gr
c, pg2 = call('GET', '/api/receiving/pending-gr', erp)
check('batch leaves pending-GR after set', all(b['id'] != bid for b in pg2['batches']))

# pending-bin lists it; assign bin via dropdown value (full_bin_location)
c, pb = call('GET', '/api/receiving/pending-bin', supervisor)
check('batch appears in pending-bin', any(b['id'] == bid for b in pb['batches']))
# get a valid bin for WH01
c, binmeta = call('GET', '/api/meta/warehouses/WH01/bins', supervisor)
binval = binmeta['bins'][0]['full_bin_location']
c, r = call('PATCH', f'/api/receiving/batches/{bid}/bin', picker, {'bin_location': binval})
check('picker assigns bin from dropdown', c == 200, r)
# invalid bin rejected
c, r = call('PATCH', f'/api/receiving/batches/{bid}/bin', picker, {'bin_location': 'NOPE-999'})
check('invalid bin rejected', c == 400, r)
# QR now reflects GR + bin
c, qr = call('GET', f"/api/receiving/qr?search={batch_no}", admin)
qrrow = qr['qr_codes'][0]
check('QR label synced with GR + bin', qrrow['gr_number'] == 'GR-9001' and qrrow['bin_location'] == binval, qrrow)

# unauthorized: picker cannot set GR number
c, r = call('PATCH', f'/api/receiving/batches/{bid}/gr', picker, {'gr_number': 'X'})
check('picker cannot set GR number', c == 403, c)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)

import sys
sys.exit(1 if failed else 0)
