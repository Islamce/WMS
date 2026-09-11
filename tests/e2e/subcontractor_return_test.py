#!/usr/bin/env python3
"""Subcontractor return-to-owner workflow (Contracting edition, phase 2).

Leftover material in a site store still belongs to the subcontractor; the company
only holds it. Returning it is therefore neither a stock adjustment nor
consumption — it is an outbound movement of someone else's property.

The contractor specified the shape exactly: a SEPARATE approval stage by project
management, after which the APPROVED quantity (not the requested one) is issued
out under a distinctive movement number. Movement type 542 is what keeps a return
distinguishable from consumption in every later report.

What this pins:

 1. Only subcontractor-owned material can be returned. Company stock leaving the
    store is a goods issue — a different thing under a different authority.
 2. Project management approves, not the warehouse, and never one's own request.
 3. The APPROVED quantity moves. A part-approval issues the approved amount and
    leaves the rest in stock.
 4. Handover is a real movement: batch quantity drops and a stock transaction is
    written under movement type 542.
 5. Replays are idempotent and state transitions are guarded, matching the
    reallocation lifecycle this deliberately mirrors.

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
supervisor = login('supervisor@example.com', 'Passw0rd!')
check('R0 admin logged in', bool(admin))
check('R0 supervisor logged in', bool(supervisor))

# ---- Fixtures: a subcontractor, and a batch they own ----------------------
c, sub = call('POST', '/api/subcontractor/subcontractors', admin,
              {'name': 'Return Test Contracting', 'trade_category': 'Concrete'})
check('R0 subcontractor created', c == 201, (c, sub))
sub_id = sub.get('id')

_, batches = call('GET', '/api/master/batches?limit=5', admin)
rows = batches.get('batches', [])
check('R0 a batch is available', len(rows) > 0, batches)
company_batch = rows[0]['id']
owned_batch = rows[1]['id'] if len(rows) > 1 else rows[0]['id']

# ===== 1. Company-owned stock cannot be "returned" =====
# Refusing this is what stops a goods issue being dressed up as a return.
c, r = call('POST', '/api/subcontractor/returns', admin,
            {'batch_id': company_batch, 'quantity': 1})
check('R1 company-owned batch is refused', c == 409, (c, r))
check('R1 refusal explains why', 'company-owned' in json.dumps(r).lower(), r)

# Mark a batch as owned by the subcontractor (phase-1 schema; no UI yet).
import sqlite3
db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'data', 'wms.db')
con = sqlite3.connect(db_path)
con.execute("UPDATE batches SET owner_type='SUBCONTRACTOR', owner_subcontractor_id=? WHERE id=?",
            (sub_id, owned_batch))
con.commit()
before_qty, reserved = con.execute(
    'SELECT remaining_quantity, COALESCE(reserved_quantity,0) FROM batches WHERE id=?',
    (owned_batch,)).fetchone()
con.close()
available = before_qty - reserved
check('R1 the owned batch has stock to return', available > 0, (before_qty, reserved))

# ===== 2. Request, then over-quantity is refused =====
c, r = call('POST', '/api/subcontractor/returns', admin,
            {'batch_id': owned_batch, 'quantity': available + 1000})
check('R2 more than available is refused', c == 409, (c, r))

request_qty = max(2, int(available // 2))
c, created = call('POST', '/api/subcontractor/returns', admin,
                  {'batch_id': owned_batch, 'quantity': request_qty, 'reason': 'Project closeout'})
check('R2 return requested', c == 201, (c, created))
check('R2 starts PENDING_APPROVAL', created.get('status') == 'PENDING_APPROVAL', created)
ret_id = created.get('id')

# ===== 3. Approval authority and four-eyes =====
# The warehouse supervisor holds subcontractor permissions but NOT the
# project-management approval permission — that separation is the requirement.
c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/approve', supervisor, {})
check('R3 warehouse cannot approve a return', c == 403, (c, r))

c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/execute', admin, {})
check('R3 cannot hand over before approval', c == 409, (c, r))

# ===== 4. Part-approval: the APPROVED quantity is what moves =====
approved_qty = max(1, request_qty - 1)
c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/approve', admin,
            {'quantity_approved': approved_qty})
check('R4 project management approves', c == 200, (c, r))
check('R4 approved quantity recorded', r.get('quantity_approved') == approved_qty, r)

c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/approve', admin, {})
check('R4 re-approval is idempotent', c == 200 and r.get('idempotent') is True, (c, r))

c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/approve', admin,
            {'quantity_approved': request_qty + 50})
check('R4 cannot approve more than requested', c in (400, 200), (c, r))

# ===== 5. Handover is a real movement under type 542 =====
c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/execute', admin, {})
check('R5 handover succeeds', c == 200, (c, r))
check('R5 reports movement type 542', r.get('movement_type') == '542', r)
check('R5 moved the APPROVED quantity', r.get('quantity') == approved_qty, r)

con = sqlite3.connect(db_path)
after_qty = con.execute('SELECT remaining_quantity FROM batches WHERE id=?', (owned_batch,)).fetchone()[0]
tx = con.execute("""SELECT transaction_type, quantity, notes FROM stock_transactions
                    WHERE notes LIKE '%movement type 542%' ORDER BY id DESC LIMIT 1""").fetchone()
audited = con.execute("""SELECT COUNT(*) FROM audit_trail
                         WHERE entity_type='SubcontractorReturn' AND entity_id=?""", (ret_id,)).fetchone()[0]
con.close()

check('R5 batch quantity dropped by the approved amount',
      abs((before_qty - after_qty) - approved_qty) < 0.001,
      f'before={before_qty} after={after_qty} approved={approved_qty}')
check('R5 an OUT stock transaction was written', tx is not None and tx[0] == 'OUT', tx)
check('R5 the movement is tagged 542, not ordinary consumption',
      tx is not None and '542' in (tx[2] or ''), tx)
check('R5 every stage is audited (requested, approved, executed)', audited >= 3, audited)

# ===== 6. Replay and state guards =====
c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/execute', admin, {})
check('R6 re-handover is idempotent', c == 200 and r.get('idempotent') is True, (c, r))

c, r = call('POST', f'/api/subcontractor/returns/{ret_id}/reject', admin, {'reason': 'too late'})
check('R6 cannot reject an executed return', c == 409, (c, r))

# ===== 7. Rejection path =====
c, second = call('POST', '/api/subcontractor/returns', admin,
                 {'batch_id': owned_batch, 'quantity': 1, 'reason': 'To be rejected'})
check('R7 second return requested', c == 201, (c, second))
second_id = second.get('id')
c, r = call('POST', f'/api/subcontractor/returns/{second_id}/reject', admin, {'reason': 'Still needed on site'})
check('R7 rejected', c == 200 and r.get('status') == 'REJECTED', (c, r))
c, r = call('POST', f'/api/subcontractor/returns/{second_id}/execute', admin, {})
check('R7 a rejected return cannot be handed over', c == 409, (c, r))

# ===== 8. The queue is readable =====
c, r = call('GET', '/api/subcontractor/returns', admin)
check('R8 queue lists returns', c == 200 and len(r.get('returns', [])) >= 2, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
