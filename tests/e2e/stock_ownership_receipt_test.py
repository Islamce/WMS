#!/usr/bin/env python3
"""Receiving subcontractor-owned material — the write path the feature needed.

Phase 1 added an owner to stock, phases 2-3 built the return workflow and the
report on top of it, and the screens made all of it reachable. None of it could
be used: no application code ever WROTE owner_type. Every test set it with raw
SQL, which hid the gap. In production the entire Contracting differentiator was
unreachable — the return workflow refuses company-owned batches, and every batch
was company-owned.

Ownership is decided at goods receipt and nowhere else. There is deliberately no
endpoint that reclassifies an existing batch: that would be a way to turn company
stock into someone else's property after the fact.

What this pins:

 1. Receiving defaults to COMPANY. An existing integration that sends no owner
    keeps behaving exactly as before — this is the regression guard.
 2. Subcontractor-owned receipt requires a real, active subcontractor.
 3. No purchase order is required for material the company did not buy; a
    delivery note is required instead, and inventing a PO is not forced.
 4. The whole loop now runs with NO raw SQL: receive owned -> it appears in the
    owned-stock report -> a return can be requested, approved and handed over.
    That end-to-end path is the actual proof the feature is reachable.

Requires a running server (started by tests/run.sh).
"""
import json, os, sys, urllib.error, urllib.request

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or '{}')
        except Exception:
            return e.code, {}


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print("PASS:", name)
    else:
        failed += 1
        fails.append(name)
        print("FAIL:", name, detail)


def login(email, pw):
    _, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return r.get('token')


admin = login('admin@example.com', 'Admin@123456')
check('O0 admin logged in', bool(admin))

c, sub = call('POST', '/api/subcontractor/subcontractors', admin,
              {'name': 'Receipt Ownership Contracting', 'trade_category': 'Masonry'})
check('O0 subcontractor created', c == 201, (c, sub))
sub_id = sub.get('id')

c, inactive = call('POST', '/api/subcontractor/subcontractors', admin,
                   {'name': 'Dormant Contracting'})
inactive_id = inactive.get('id')
call('PATCH', f'/api/subcontractor/subcontractors/{inactive_id}', admin, {'is_active': 0})

_, mats = call('GET', '/api/materials?limit=5', admin)
material = (mats.get('materials') or [{}])[0]
check('O0 a material is available', bool(material.get('id')), mats)

_, whs = call('GET', '/api/master/warehouses', admin)
rows = whs.get('warehouses') or []
warehouse = rows[0]['warehouse_code'] if rows else 'WH01'
check('O0 a warehouse is available', bool(warehouse), whs)


def receive(extra, qty=40):
    body = {'material_id': material['id'], 'received_quantity': qty,
            'warehouse_code': warehouse}
    body.update(extra)
    return call('POST', '/api/receiving', admin, body)


# ===== 1. The default is unchanged =====
# If this fails, every existing integration just changed behaviour.
c, plain = receive({'po_number': 'PO-OWNER-BASE'})
check('O1 an ordinary receipt still works', c == 201, (c, plain))
check('O1 and defaults to company-owned', plain.get('owner_type') == 'COMPANY', plain)
check('O1 with no owner attached', plain.get('owner_subcontractor_id') is None, plain)

# ===== 2. Subcontractor ownership is validated =====
c, r = receive({'po_number': 'PO-X', 'owner_type': 'SUBCONTRACTOR'})
check('O2 an owner is required when the material is not the company\'s', c == 400, (c, r))

c, r = receive({'po_number': 'PO-X', 'owner_type': 'SUBCONTRACTOR', 'owner_subcontractor_id': 999999})
check('O2 an unknown subcontractor is refused', c == 404, (c, r))

c, r = receive({'po_number': 'PO-X', 'owner_type': 'SUBCONTRACTOR', 'owner_subcontractor_id': inactive_id})
check('O2 an inactive subcontractor is refused', c == 409, (c, r))

c, r = receive({'po_number': 'PO-X', 'owner_type': 'NOBODY'})
check('O2 a nonsense owner type is refused', c == 400, (c, r))

# ===== 3. No purchase order for material the company did not buy =====
c, r = receive({'owner_type': 'SUBCONTRACTOR', 'owner_subcontractor_id': sub_id})
check('O3 some arrival reference is still required', c == 400, (c, r))
check('O3 and the message asks for a delivery note, not a PO',
      'delivery note' in json.dumps(r).lower() and 'po number' not in json.dumps(r).lower(), r)

c, owned = receive({'owner_type': 'SUBCONTRACTOR', 'owner_subcontractor_id': sub_id,
                    'delivery_note': 'DN-2026-0042'}, qty=60)
check('O3 a delivery note alone is enough — no PO invented', c == 201, (c, owned))
check('O3 the batch is recorded as subcontractor-owned',
      owned.get('owner_type') == 'SUBCONTRACTOR', owned)
check('O3 and names the owner back to the storekeeper',
      owned.get('owner_name') == 'Receipt Ownership Contracting', owned)

# ===== 4. The whole loop, with no raw SQL anywhere =====
c, rep = call('GET', f'/api/subcontractor/owned-stock-report?subcontractor_id={sub_id}', admin)
line = next((x for x in rep.get('report', []) if x['material_id'] == material['id']), None)
check('O4 the received material reaches the owned-stock report', line is not None, rep)
check('O4 with the quantity that was received',
      line and abs(line['quantity_received'] - 60) < 0.001, line)
check('O4 and nothing issued or returned yet',
      line and line['quantity_issued'] == 0 and line['quantity_returned'] == 0, line)

_, batches = call('GET', '/api/master/batches?limit=200', admin)
owned_batch = next((x for x in batches.get('batches', [])
                    if x.get('id') == owned.get('batch_id')), None)
check('O4 the batch is visible in batch tracking', owned_batch is not None, owned.get('batch_id'))

c, ret = call('POST', '/api/subcontractor/returns', admin,
              {'batch_id': owned['batch_id'], 'quantity': 10, 'reason': 'End of package'})
check('O4 a return can be requested against it', c == 201, (c, ret))

c, r = call('POST', f"/api/subcontractor/returns/{ret['id']}/approve", admin, {'quantity_approved': 10})
check('O4 project management can approve it', c == 200, (c, r))

c, r = call('POST', f"/api/subcontractor/returns/{ret['id']}/execute", admin, {})
check('O4 and it can be handed over under type 542',
      c == 200 and r.get('movement_type') == '542', (c, r))

c, rep = call('GET', f'/api/subcontractor/owned-stock-report?subcontractor_id={sub_id}', admin)
line = next((x for x in rep.get('report', []) if x['material_id'] == material['id']), None)
check('O4 the report reflects the handover', line and line['quantity_returned'] == 10, line)
check('O4 and on hand dropped by exactly that much',
      line and abs(line['quantity_on_hand'] - 50) < 0.001, line)

# ===== 5. Company stock is unaffected by any of it =====
c, r = call('POST', '/api/subcontractor/returns', admin,
            {'batch_id': plain['batch_id'], 'quantity': 1})
check('O5 a company batch still cannot be returned to a subcontractor', c == 409, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
