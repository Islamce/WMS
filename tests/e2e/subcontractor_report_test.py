#!/usr/bin/env python3
"""Owned-stock reporting and the owner split in replenishment (phase 3).

Phase 1 made a subcontractor's material REAL inventory. That created a defect
nobody asked for: every replenishment figure summed batches without looking at
who owned them, so 500 blocks belonging to a subcontractor would count as stock
the company could draw on and suppress the reorder signal on the company's own
blocks. Owning the fix is the point of this phase, not an extra.

What this pins:

 1. Replenishment counts COMPANY-owned stock only, and subcontractor-owned stock
    is reported alongside rather than dropped — it is real material in a real
    bin, it just answers a different question.
 2. The report is derived from receipt and issue quantities alone (§1.2). No
    BOQ, no WBS mapping, no execution rate.
 3. "Issued" is a residual and is named for what the system actually knows: the
    material left the store. Not that it was installed in the works.
 4. Engagement type rides along for presentation (§4.2) and nothing branches on
    it — supply-only and supply-and-execute post identically.
 5. Depletion alerts fire on what is nearly gone, and NOT on what is already
    gone. A permanent alert on every finished line is how alerts get ignored.

Requires a running server (started by tests/run.sh).
"""
import json, os, sqlite3, sys, urllib.error, urllib.request

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'data', 'wms.db')


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
check('P0 admin logged in', bool(admin))

c, sub = call('POST', '/api/subcontractor/subcontractors', admin,
              {'name': 'Report Test Contracting', 'trade_category': 'Blockwork'})
check('P0 subcontractor created', c == 201, (c, sub))
sub_id = sub.get('id')

# Pick a material that has batches, and split its batches between the company
# and the subcontractor so the owner dimension has something to separate.
con = sqlite3.connect(DB)
row = con.execute("""SELECT material_id, COUNT(*) FROM batches
                     WHERE remaining_quantity > 0 GROUP BY material_id
                     HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 1""").fetchone()
check('P0 a material with at least two batches exists', row is not None, row)
material_id = row[0]
batch_ids = [r[0] for r in con.execute(
    'SELECT id FROM batches WHERE material_id=? AND remaining_quantity>0 ORDER BY id', (material_id,)).fetchall()]
owned_batch = batch_ids[-1]

total_before = con.execute(
    'SELECT SUM(remaining_quantity-reserved_quantity) FROM batches WHERE material_id=?', (material_id,)).fetchone()[0]
owned_qty = con.execute(
    'SELECT remaining_quantity-reserved_quantity FROM batches WHERE id=?', (owned_batch,)).fetchone()[0]
con.close()


def analytics_item():
    _, r = call('GET', '/api/analytics', admin)
    items = r.get('items') or []
    return next((i for i in items if i['material_id'] == material_id), None)


before = analytics_item()
check('P1 the material appears in analytics', before is not None, before)
check('P1 before the split, replenishment sees the whole quantity',
      before and abs(before['current_stock'] - total_before) < 0.001,
      (before or {}).get('current_stock'))

# Hand one batch to the subcontractor (phase-1 schema; no UI yet).
con = sqlite3.connect(DB)
con.execute("UPDATE batches SET owner_type='SUBCONTRACTOR', owner_subcontractor_id=? WHERE id=?",
            (sub_id, owned_batch))
con.commit()
con.close()

after = analytics_item()
check('P1 replenishment no longer counts the subcontractor-owned batch',
      after and abs(after['current_stock'] - (total_before - owned_qty)) < 0.001,
      (after or {}).get('current_stock'))
check('P1 the owned quantity is reported, not dropped',
      after and abs(after['subcontractor_stock'] - owned_qty) < 0.001,
      (after or {}).get('subcontractor_stock'))
check('P1 the two halves still add up to the physical total',
      after and abs((after['current_stock'] + after['subcontractor_stock']) - total_before) < 0.001,
      after)

# ===== 2. The report itself =====
c, rep = call('GET', '/api/subcontractor/owned-stock-report', admin)
check('P2 report is readable', c == 200, (c, rep))
rows = [r for r in rep.get('report', []) if r['subcontractor_id'] == sub_id]
check('P2 the owned material appears exactly once per material and store', len(rows) == 1, rows)
line = rows[0] if rows else {}

check('P2 the subcontractor is named', line.get('subcontractor_name') == 'Report Test Contracting', line)
check('P2 engagement type rides along for presentation',
      line.get('engagement_type') == 'SUPPLY_ONLY', line)
check('P2 received is reported', line.get('quantity_received', 0) > 0, line)
check('P2 on hand is reported', line.get('quantity_on_hand', 0) > 0, line)
check('P2 issued is received minus returned minus on hand',
      abs(line.get('quantity_issued', -1)
          - max(0, line.get('quantity_received', 0) - line.get('quantity_returned', 0)
                - line.get('quantity_on_hand', 0))) < 0.001, line)
check('P2 nothing has been returned yet', line.get('quantity_returned') == 0, line)
check('P2 no discrepancy on a consistent line', line.get('discrepancy') is None, line)
check('P2 the basis is stated, not assumed',
      'no BOQ' in (rep.get('basis') or '') and 'left the store' in (rep.get('basis') or ''), rep.get('basis'))

c, r = call('GET', f'/api/subcontractor/owned-stock-report?subcontractor_id={sub_id}', admin)
check('P2 filterable by subcontractor',
      c == 200 and all(x['subcontractor_id'] == sub_id for x in r.get('report', [])), (c, r))

c, r = call('GET', '/api/subcontractor/owned-stock-report?low_stock_percent=500', admin)
check('P2 a nonsense threshold is refused', c == 400, (c, r))

# ===== 3. Depletion alerts =====
# Nothing is near depletion at 0%, everything on hand is at 100%.
c, none_low = call('GET', '/api/subcontractor/owned-stock-report?low_stock_percent=0', admin)
check('P3 at a 0% threshold nothing is flagged',
      not any(x['subcontractor_id'] == sub_id for x in none_low.get('alerts', [])), none_low.get('alerts'))

c, all_low = call('GET', '/api/subcontractor/owned-stock-report?low_stock_percent=100', admin)
check('P3 at a 100% threshold the line is flagged',
      any(x['subcontractor_id'] == sub_id for x in all_low.get('alerts', [])), all_low.get('alerts'))

# Deplete it entirely: a finished line must NOT keep alerting.
con = sqlite3.connect(DB)
con.execute('UPDATE batches SET remaining_quantity=0 WHERE id=?', (owned_batch,))
con.commit()
con.close()

c, depleted = call('GET', '/api/subcontractor/owned-stock-report?low_stock_percent=100', admin)
line = next((x for x in depleted.get('report', []) if x['subcontractor_id'] == sub_id), {})
check('P3 a fully depleted line is not an alert', line.get('low_stock') is False, line)
check('P3 but it is still reported, with everything issued',
      line.get('quantity_on_hand') == 0 and line.get('quantity_issued', 0) > 0, line)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
