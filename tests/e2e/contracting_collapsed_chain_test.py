#!/usr/bin/env python3
"""A Contracting request walks from approval to issued stock with two people.

The SAP chain has six authorities act before material leaves: manager, ERP
operator, bin-assignment operator, picker-assignment supervisor, picker, GI
poster. A site store has a storekeeper and a site engineer.

Three of those six were ERP or warehouse-pool ceremony and are collapsed here.
Three things were NOT collapsed, and this test exists mainly to pin them:

 1. Batch and bin selection still happens. It is not ERP dressing: picking
    refuses a line whose reserved_quantity is 0, and without picking_allocations
    rows a pick records a movement while the batch keeps its quantity. It runs
    automatically at approval instead of on an operator's screen.
 2. Who physically pulled the stock is still recorded. The storekeeper claims
    the request, so assigned_picker_id is set by the person doing the work.
 3. Separation of duties survives: the approver still cannot post the issue.

And the ledger keeps its shape: a locally minted issue number and GI number
stand in for the SAP documents, so stock_transactions looks the same as it
always did.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
passed = failed = 0
fails = []


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print("PASS:", name)
    else:
        failed += 1
        fails.append(name)
        print("FAIL:", name, detail)


tmp = tempfile.mkdtemp(prefix='wms-collapsed-')
path = os.path.join(tmp, 'wms.db')
env = dict(os.environ, DB_PATH=path, NODE_ENV='test', SKIP_AUTO_SEED='1')
subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env, capture_output=True, text=True)
subprocess.run(['node', 'server/db/seed.js'], cwd=ROOT, env=env, capture_output=True, text=True)

con = sqlite3.connect(path)
con.execute("INSERT OR REPLACE INTO tenant_profile (id, tenant_name, industry_profile) VALUES (1,'Site','contracting')")
con.execute("UPDATE warehouses SET is_active=0 WHERE warehouse_code <> 'WH01'")

# A material that actually has stock in the site store, so the pick is real.
row = con.execute("""SELECT b.material_id, b.id, b.remaining_quantity, m.item_code, m.description, m.unit
                     FROM batches b JOIN materials m ON m.id=b.material_id
                     WHERE b.warehouse_code='WH01' AND b.remaining_quantity >= 5
                     ORDER BY b.id LIMIT 1""").fetchone()
assert row, 'seed produced no stocked batch in WH01'
material_id, batch_id, before_qty, code, desc, uom = row

requester = con.execute("SELECT id, name FROM users WHERE email='requester@example.com'").fetchone()
con.execute("""INSERT INTO material_request_headers
    (request_number, request_type, requester_id, requester_name, request_status,
     current_workflow_step, created_by, total_lines, plant, issue_warehouse_code)
    VALUES ('RQ-COLLAPSE-1','COST_CENTER',?,?,'Pending Manager Approval',
            'Pending Manager Approval',?,1,'P100','WH01')""",
    (requester[0], requester[1], requester[0]))
rid = con.execute('SELECT last_insert_rowid()').fetchone()[0]
con.execute("""INSERT INTO material_request_lines
    (request_id, request_number, line_number, material_id, material_code,
     material_description, uom, requested_quantity, approved_quantity, line_status)
    VALUES (?,'RQ-COLLAPSE-1',1,?,?,?,?,5,5,'Approved')""",
    (rid, material_id, code, desc, uom))
line_id = con.execute('SELECT last_insert_rowid()').fetchone()[0]
con.commit(); con.close()

port = 3411
env = dict(env, JWT_SECRET='k' * 48, PORT=str(port))
server = subprocess.Popen(['node', 'index.js'], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = f'http://localhost:{port}'


def call(method, route, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(base + route, data=data, method=method)
    rq.add_header('Content-Type', 'application/json')
    if token:
        rq.add_header('Authorization', 'Bearer ' + token)
    try:
        res = urllib.request.urlopen(rq, timeout=20)
        return res.getcode(), json.loads(res.read() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or '{}')
        except Exception:
            return e.code, {}


def login(email):
    _, body = call('POST', '/api/auth/login', body={'email': email, 'password': 'Passw0rd!'})
    return body.get('token')


def header_row():
    c = sqlite3.connect(path)
    r = c.execute("""SELECT request_status, erp_reservation_number, gi_document_number
                     FROM material_request_headers WHERE id=?""", (rid,)).fetchone()
    c.close()
    return r


try:
    for _ in range(60):
        try:
            urllib.request.urlopen(base + '/healthz', timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
    else:
        raise SystemExit('server did not start')

    manager = login('manager@example.com')
    picker = login('picker@example.com')
    # The storekeeper who posts the issue. In the seeded demo roles picking and
    # gi_posting sit on two accounts; a real contractor gives one storekeeper
    # both. Either way the approver is barred, which is the control that matters.
    storekeeper = login('whoperator@example.com')

    # ===== 1. Approval routes straight to the store, already allocated =====
    code, body = call('POST', f'/api/approvals/{rid}/decision', manager, {'decision': 'approve'})
    check('E1 approval succeeds', code == 200, body)
    check('E1 and lands ready to pick, with no bin-assignment screen in between',
          header_row()[0] == 'Pending Picker Assignment', header_row())

    c = sqlite3.connect(path)
    allocs = c.execute("SELECT COUNT(*), SUM(proposed_quantity) FROM picking_allocations WHERE request_id=?",
                       (rid,)).fetchone()
    reserved = c.execute("SELECT reserved_quantity FROM material_request_lines WHERE id=?", (line_id,)).fetchone()[0]
    batch_reserved = c.execute("SELECT reserved_quantity FROM batches WHERE id=?", (batch_id,)).fetchone()[0]
    c.close()
    check('E1 batches were chosen automatically', allocs[0] >= 1, allocs)
    check('E1 the line carries the reserved quantity picking enforces', abs(reserved - 5) < 0.001, reserved)
    check('E1 and the batch stock is soft-reserved', batch_reserved >= 5, batch_reserved)

    # ===== 2. The storekeeper claims and picks, in one action =====
    code, body = call('POST', f'/api/picking/requests/{rid}/claim', picker)
    check('E2 the storekeeper claims the request', code == 200, body)
    check('E2 and picking is under way with no accept/start handshake',
          header_row()[0] == 'Picking in Progress', header_row())

    c = sqlite3.connect(path)
    task = c.execute("""SELECT id, assigned_picker_id, assigned_picker_name, task_status
                        FROM picking_tasks WHERE request_id=?""", (rid,)).fetchone()
    c.close()
    check('E2 who pulled the stock is recorded', task and task[2] == 'Petra Picker', task)
    check('E2 the task is in progress', task and task[3] == 'Picking in Progress', task)

    # A second claim must not hand the same request to two storekeepers.
    code, body = call('POST', f'/api/picking/requests/{rid}/claim', picker)
    check('E2 a second claim is refused', code in (400, 409), (code, body))

    # ===== 3. Confirming the pick moves real stock =====
    code, body = call('POST', f'/api/picking/lines/{line_id}/confirm', picker, {'picked_quantity': 5})
    check('E3 the pick is confirmed', code == 200, body)
    c = sqlite3.connect(path)
    after_pick = c.execute("SELECT remaining_quantity FROM batches WHERE id=?", (batch_id,)).fetchone()[0]
    c.close()
    check('E3 and the batch actually went down', abs((before_qty - after_pick) - 5) < 0.001,
          (before_qty, after_pick))

    code, body = call('POST', f'/api/picking/tasks/{task[0]}/complete', picker)
    check('E3 the task completes', code == 200, body)
    check('E3 and the request is ready to issue', header_row()[0] == 'Pending ERP GI', header_row())

    # ===== 4. The issue posts with no ERP document to copy =====
    # Separation of duties first: the approver must not be able to issue.
    code, body = call('POST', f'/api/gi/{rid}/post', manager, {})
    check('E4 the approver cannot post the issue', code == 403, (code, body))

    code, body = call('POST', f'/api/gi/{rid}/post', storekeeper, {})
    check('E4 the storekeeper posts it without typing a GI number', code == 200, body)

    status, issue_no, gi_no = header_row()
    check('E4 the request is closed', status in ('Completed', 'Partially Completed', 'Closed with Shortage'), status)
    check('E4 a local issue number stood in for the reservation', (issue_no or '').startswith('ISS-'), issue_no)
    check('E4 a local GI number stood in for the SAP document', (gi_no or '').startswith('GI-'), gi_no)

    # ===== 5. The ledger looks exactly as it always did =====
    c = sqlite3.connect(path)
    mv = c.execute("""SELECT transaction_type, quantity, reservation_number, request_line_id
                      FROM stock_transactions WHERE request_line_id=?""", (line_id,)).fetchone()
    c.close()
    check('E5 one OUT movement was recorded', mv and mv[0] == 'OUT', mv)
    check('E5 for the quantity that was picked', mv and abs(mv[1] - 5) < 0.001, mv)
    check('E5 carrying a document reference, as every OUT must',
          mv and (mv[2] or '').startswith('ISS-'), mv)
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
