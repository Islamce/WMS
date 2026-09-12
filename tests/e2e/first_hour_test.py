#!/usr/bin/env python3
"""A brand-new tenant can receive and issue material without being told how.

The objection this answers: provisioning hands a customer a correct, clean
database and 43 screens with nothing in them. They cannot post a goods receipt
at all — no store to receive into, no bin to put it in, no material to receive.
The distance between "I said yes" and "I saw it work" is days of data entry, and
that is where pilots die.

So this test does what a new customer does, against a database provisioned by
the real script rather than a fixture, and asserts the whole first hour works:

 1. Provisioning alone leaves a tenant that CANNOT receive. That is the problem
    stated as a test, and it must keep being true — otherwise provisioning has
    started seeding data behind somebody's back.
 2. Starter data is refused on a tenant that already holds master data. No
    --force exists. Writing sample rows into a live store is the failure this
    guard is for, and it is indistinguishable from real data afterwards.
 3. After starter data, the real first hour works end to end: a goods receipt
    posts, quality releases the batch, and it is put away in a bin. Those last
    two are not ceremony and are easy to miss — a received batch lands on
    QUALITY HOLD with no bin, and allocation will not touch it until both are
    done. A customer who does not know that concludes the product is broken.
 4. And the material goes back out again: request, approve, claim, pick, issue.

Point 4 matters more than it looks. It proves the starter data is not merely
present but COHERENT — the store, the bins and the materials fit together well
enough to carry a request end to end on the collapsed contracting workflow.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

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


def run(*argv):
    return subprocess.run(['node'] + list(argv), cwd=ROOT, capture_output=True, text=True)


tmp = tempfile.mkdtemp(prefix='wms-firsthour-')
db = os.path.join(tmp, 'wms.db')

prov = run('scripts/provision-tenant.js', '--name', 'First Hour Ltd', '--slug', 'firsthour',
           '--profile', 'contracting', '--admin-email', 'ops@example.com', '--db', db)
check('provisioning succeeds', prov.returncode == 0, prov.stderr[-400:])

password = None
for line in prov.stdout.splitlines():
    if 'password' in line.lower() and ':' in line:
        password = line.split(':', 1)[1].strip()
check('provisioning issues an administrator password', bool(password), prov.stdout[-600:])

con = sqlite3.connect(db)
empty = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
         for t in ('materials', 'warehouses', 'bin_locations')}
con.close()

# ===== 1. The problem, stated as a test =====
check('F1 a freshly provisioned tenant has no master data at all',
      all(v == 0 for v in empty.values()), empty)

# ===== 2. Starter data goes in, and only into an empty tenant =====
dry = run('scripts/install-starter-data.js', '--db', db, '--dry-run')
check('F2 the dry run reports without writing', dry.returncode == 0 and 'DRY RUN' in dry.stdout, dry.stdout[-300:])
con = sqlite3.connect(db)
check('F2 and really wrote nothing',
      con.execute('SELECT COUNT(*) FROM materials').fetchone()[0] == 0)
con.close()

ins = run('scripts/install-starter-data.js', '--db', db)
check('F2 starter data installs', ins.returncode == 0, ins.stderr[-400:])

again = run('scripts/install-starter-data.js', '--db', db)
check('F2 a second run is REFUSED, not merged', again.returncode != 0 and 'REFUSED' in again.stderr,
      (again.returncode, again.stderr[-300:]))

con = sqlite3.connect(db)
counts = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
          for t in ('materials', 'warehouses', 'bin_locations', 'subcontractors')}
audited = con.execute("SELECT COUNT(*) FROM audit_trail WHERE action='STARTER_DATA_INSTALLED'").fetchone()[0]
# It must write master data only: no users, no stock, no transactions.
stock = con.execute('SELECT COUNT(*) FROM batches').fetchone()[0]
users = con.execute('SELECT COUNT(*) FROM users').fetchone()[0]
material = con.execute("SELECT id, item_code FROM materials WHERE item_code='CEM-OPC-50'").fetchone()
con.close()

check('F2 one site store, bins, materials and a subcontractor exist',
      counts['warehouses'] == 1 and counts['bin_locations'] >= 4
      and counts['materials'] >= 10 and counts['subcontractors'] == 1, counts)
check('F2 it wrote no stock', stock == 0, stock)
check('F2 and created no user beyond the provisioned administrator', users == 1, users)
check('F2 the install is audited', audited == 1, audited)

# ===== 3 and 4. The first hour, through the API =====
port = 3421
env = dict(os.environ, DB_PATH=db, NODE_ENV='test', SKIP_AUTO_SEED='1',
           JWT_SECRET='k' * 48, PORT=str(port))
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


try:
    for _ in range(60):
        try:
            urllib.request.urlopen(base + '/healthz', timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
    else:
        raise SystemExit('server did not start')

    code, body = call('POST', '/api/auth/login', body={'email': 'ops@example.com', 'password': password})
    token = body.get('token')
    check('F3 the provisioned administrator can log in', code == 200 and bool(token), (code, body))

    # Provisioning sets must_change_password, so the first act is changing it.
    code, body = call('PATCH', '/api/auth/password', token,
                      {'current_password': password, 'new_password': 'FirstHour!2026x'})
    check('F3 and is required to set a new password first', code == 200, (code, body))
    _, body = call('POST', '/api/auth/login', body={'email': 'ops@example.com', 'password': 'FirstHour!2026x'})
    token = body.get('token')

    # The first receipt. Nothing was created by hand to make this work.
    code, receipt = call('POST', '/api/receiving', token, {
        'material_id': material[0], 'received_quantity': 100, 'warehouse_code': 'SITE-01',
        'po_number': 'PO-FH-0001',
    })
    check('F3 the first goods receipt posts', code in (200, 201), (code, receipt))
    batch_id = receipt.get('batch_id')
    batch_number = receipt.get('batch_number')

    con = sqlite3.connect(db)
    batch = con.execute('SELECT remaining_quantity, quality_status, bin_location FROM batches WHERE id=?',
                        (batch_id,)).fetchone()
    con.close()
    check('F3 the stock is really there', batch and abs(batch[0] - 100) < 0.001, batch)
    # Receipt does not make stock issuable, and that is correct: it arrives on
    # quality hold, in no bin. Asserted rather than worked around, because it is
    # the step a new customer does not know is waiting for them.
    check('F3 but it arrives on quality hold, in no bin',
          batch and batch[1] == 'QUALITY_HOLD' and batch[2] is None, batch)

    code, body = call('POST', f'/api/master/batches/{batch_id}/quality', token,
                      {'quality_status': 'RELEASED'})
    check('F3 quality releases it', code == 200, (code, body))

    code, body = call('PATCH', f'/api/receiving/batches/{batch_id}/bin', token,
                      {'bin_location': 'SITE-01-RACK-01'})
    check('F3 and it is put away in a starter bin', code == 200, (code, body))

    # Now back out again, on the collapsed contracting chain.
    code, req = call('POST', '/api/requests', token, {
        'request_type': 'COST_CENTER', 'plant': 'P100', 'issue_warehouse_code': 'SITE-01',
        'lines': [{'material_id': material[0], 'requested_quantity': 10}],
    })
    rid = (req.get('request') or {}).get('id') or req.get('id')
    check('F4 a material request can be raised', code in (200, 201) and bool(rid), (code, req))

    if rid:
        call('POST', f'/api/requests/{rid}/submit', token)
        code, body = call('POST', f'/api/approvals/{rid}/decision', token, {'decision': 'approve'})
        check('F4 and approved', code == 200, (code, body))

        con = sqlite3.connect(db)
        status = con.execute('SELECT request_status FROM material_request_headers WHERE id=?', (rid,)).fetchone()
        allocs = con.execute('SELECT COUNT(*) FROM picking_allocations WHERE request_id=?', (rid,)).fetchone()[0]
        line_id = con.execute('SELECT id FROM material_request_lines WHERE request_id=?', (rid,)).fetchone()[0]
        con.close()
        check('F4 approval allocated a bin and batch without an operator',
              allocs >= 1 and status[0] == 'Pending Picker Assignment', (status, allocs))

        code, body = call('POST', f'/api/picking/requests/{rid}/claim', token)
        check('F4 the store claims it', code == 200, (code, body))
        code, body = call('POST', f'/api/picking/lines/{line_id}/confirm', token, {'picked_quantity': 10})
        check('F4 and picks it', code == 200, (code, body))

        con = sqlite3.connect(db)
        task = con.execute('SELECT id FROM picking_tasks WHERE request_id=?', (rid,)).fetchone()
        con.close()
        call('POST', f'/api/picking/tasks/{task[0]}/complete', token)
        code, body = call('POST', f'/api/gi/{rid}/post', token, {})
        check('F4 and issues it, with no ERP document to copy', code == 200, (code, body))

        con = sqlite3.connect(db)
        left = con.execute('SELECT remaining_quantity FROM batches WHERE id=?', (batch_id,)).fetchone()[0]
        mv = con.execute('SELECT transaction_type, quantity FROM stock_transactions WHERE request_line_id=?',
                         (line_id,)).fetchone()
        con.close()
        check('F4 the stock went down by what left', abs((100 - left) - 10) < 0.001, left)
        check('F4 and the ledger recorded the issue', mv and mv[0] == 'OUT' and abs(mv[1] - 10) < 0.001, mv)
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
