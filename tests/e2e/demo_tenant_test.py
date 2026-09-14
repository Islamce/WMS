#!/usr/bin/env python3
"""A demo tenant a salesperson can actually present from, alone.

Two things have to be true for a demo to work, and neither is obvious:

 1. The account must open every screen. An edition hides modules, and App.can()
    checks the edition BEFORE the admin short-circuit, so "admin" alone is not a
    guarantee.
 2. It must be able to walk a request from raised to issued WITHOUT a second
    person. The product enforces segregation of duties — the approver cannot
    post the goods issue — which is correct for a real warehouse and fatal for a
    presenter working alone. Admins are exempt, and this pins that exemption: if
    someone later makes SoD apply to admins, every sales demo breaks in the last
    step, in front of a customer.

And the guard matters as much as the feature. An account holding every authority
with a password printed to a terminal must never be creatable on a database that
already exists, because that database might be a live warehouse.
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


tmp = tempfile.mkdtemp(prefix='wms-demo-')
db = os.path.join(tmp, 'demo.db')
PASSWORD = 'Demo-Presentation!2026'

r = subprocess.run(['node', 'scripts/create-demo-tenant.js', '--slug', 'demo-suite',
                    '--name', 'Suite Contracting (DEMO)', '--db', db,
                    '--password', PASSWORD, '--with-second-user'],
                   cwd=ROOT, capture_output=True, text=True)
check('D1 the demo tenant is created', r.returncode == 0, r.stderr[-400:])

# ===== 1. The guard: it only ever creates =====
again = subprocess.run(['node', 'scripts/create-demo-tenant.js', '--slug', 'demo-suite', '--db', db],
                       cwd=ROOT, capture_output=True, text=True)
check('D1 it REFUSES a database that already exists',
      again.returncode != 0 and 'REFUSED' in again.stderr, (again.returncode, again.stderr[-200:]))

prod = subprocess.run(['node', 'scripts/create-demo-tenant.js', '--slug', 'demo-p',
                       '--db', '/opt/apps/wms/data/wms.db'], cwd=ROOT, capture_output=True, text=True)
check('D1 and refuses a production path outright',
      prod.returncode != 0 and 'production path' in prod.stderr, prod.stderr[-200:])

con = sqlite3.connect(db)
counts = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
          for t in ('users', 'materials', 'warehouses', 'bin_locations', 'subcontractors')}
material_id = con.execute("SELECT id FROM materials WHERE item_code='CEM-OPC-50'").fetchone()[0]
audited = con.execute("SELECT COUNT(*) FROM audit_trail WHERE action='DEMO_TENANT_CREATED'").fetchone()[0]
con.close()
check('D1 it has something to demonstrate with',
      counts['materials'] >= 10 and counts['warehouses'] == 1 and counts['bin_locations'] >= 4
      and counts['subcontractors'] == 1, counts)
# Exactly the accounts that were asked for, and no orphan: provisioning creates
# an administrator whose generated password this script would otherwise throw
# away, leaving a live admin on the demo that nobody can log in as.
check('D1 and exactly the accounts asked for, with no orphan admin',
      counts['users'] == 2, counts)
check('D1 creation is audited', audited == 1, audited)

port = 3451
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

    # ===== 2. It logs in with no password change in the way =====
    code, body = call('POST', '/api/auth/login',
                      body={'email': 'demo@demo-suite.demo', 'password': PASSWORD})
    token = body.get('token')
    check('D2 the demo account logs straight in', code == 200 and bool(token), (code, body))
    check('D2 with no forced password change interrupting a presentation',
          not (body.get('user') or {}).get('must_change_password'), body.get('user'))

    # ===== 3. It can walk the whole flow ALONE =====
    # This is the assertion that protects every future sales demo.
    code, receipt = call('POST', '/api/receiving', token, {
        'material_id': material_id, 'received_quantity': 100,
        'warehouse_code': 'SITE-01', 'po_number': 'PO-DEMO-1'})
    check('D3 receive', code in (200, 201), (code, receipt))
    bid = receipt.get('batch_id')

    code, _ = call('POST', f'/api/master/batches/{bid}/quality', token, {'quality_status': 'RELEASED'})
    check('D3 release from quality hold', code == 200, code)
    code, _ = call('PATCH', f'/api/receiving/batches/{bid}/bin', token,
                   {'bin_location': 'SITE-01-RACK-01'})
    check('D3 put away', code == 200, code)

    code, created = call('POST', '/api/requests', token, {
        'request_type': 'COST_CENTER', 'plant': 'P100', 'issue_warehouse_code': 'SITE-01',
        'lines': [{'material_id': material_id, 'requested_quantity': 10}]})
    rid = (created.get('request') or created).get('id')
    check('D3 raise a request', code in (200, 201) and bool(rid), (code, created))

    call('POST', f'/api/requests/{rid}/submit', token)
    code, body = call('POST', f'/api/approvals/{rid}/decision', token, {'decision': 'approve'})
    check('D3 approve it', code == 200, (code, body))

    code, body = call('POST', f'/api/picking/requests/{rid}/claim', token)
    check('D3 claim it', code == 200, (code, body))

    con = sqlite3.connect(db)
    line_id = con.execute('SELECT id FROM material_request_lines WHERE request_id=?', (rid,)).fetchone()[0]
    task_id = con.execute('SELECT id FROM picking_tasks WHERE request_id=?', (rid,)).fetchone()[0]
    con.close()
    code, body = call('POST', f'/api/picking/lines/{line_id}/confirm', token, {'picked_quantity': 10})
    check('D3 pick it', code == 200, (code, body))
    call('POST', f'/api/picking/tasks/{task_id}/complete', token)

    # The step a presenter working alone would otherwise be blocked on.
    code, body = call('POST', f'/api/gi/{rid}/post', token, {})
    check('D3 AND post the issue, having approved it — one person, whole demo',
          code == 200, (code, body))

    con = sqlite3.connect(db)
    mv = con.execute("SELECT transaction_type, quantity FROM stock_transactions WHERE request_line_id=?",
                     (line_id,)).fetchone()
    con.close()
    check('D3 the stock really moved', mv and mv[0] == 'OUT' and abs(mv[1] - 10) < 0.001, mv)

    # ===== 4. The second account shows the control that the admin bypasses =====
    code, body = call('POST', '/api/auth/login',
                      body={'email': 'store@demo-suite.demo', 'password': PASSWORD})
    store_token = body.get('token')
    check('D4 the storekeeper account logs in', code == 200 and bool(store_token), code)
    code, body = call('GET', '/api/auth/me', store_token)
    check('D4 and is NOT an admin, so segregation of duties applies to it',
          (body.get('user') or {}).get('role') != 'admin', body.get('user'))
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
