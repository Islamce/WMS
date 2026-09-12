#!/usr/bin/env python3
"""Contracting issues material without an ERP reservation.

The request workflow in this product was modelled on SAP: a worker requests, a
manager approves, an ERP operator raises a RESERVATION, and the store posts a
GOODS ISSUE against it. Those documents exist because SAP is the system of
record and this system feeds it.

On a construction site there is no SAP and no such documents. The responsible
engineer approves and the store issues. Requiring a reservation there means
asking a storekeeper to type a document number that does not exist, for a system
they do not own.

What this pins:

 1. On an unconfigured install and on Manufacturing, NOTHING changes — the
    request still stages through the ERP operator. This is the regression guard,
    and it is the assertion that matters most: every existing deployment has no
    tenant_profile row.
 2. On Contracting, approval sends the request straight to the store.
 3. The stock movement is NOT skipped. A locally generated issue number takes
    the reservation's place, because stock_transactions.reservation_number is
    required on every outbound movement — skipping the staging document must not
    break the ledger.
 4. Nothing is guessed: a request that cannot resolve a site store is refused
    with a message, never routed to a warehouse picked at random.

Runs offline against throwaway databases; the edition is a module-level cache in
the server, so each case needs its own process.
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


def build_db(tmp, name):
    path = os.path.join(tmp, name)
    env = dict(os.environ, DB_PATH=path, NODE_ENV='test', SKIP_AUTO_SEED='1')
    subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env, capture_output=True, text=True)
    subprocess.run(['node', 'server/db/seed.js'], cwd=ROOT, env=env, capture_output=True, text=True)
    return path


def set_edition(path, profile):
    con = sqlite3.connect(path)
    con.execute("INSERT OR REPLACE INTO tenant_profile (id, tenant_name, industry_profile) VALUES (1,'T',?)",
                (profile,))
    con.commit()
    con.close()


def approve_on_own_server(path, port, warehouse=None):
    """Approve a fresh request against a server pointed at this database.

    The edition is resolved once and cached inside the server process, so every
    case needs its own server. Sharing one would test the first edition twice
    and report a pass for the second.
    """
    con = sqlite3.connect(path)
    material = con.execute('SELECT id, item_code, description, unit FROM materials LIMIT 1').fetchone()
    requester = con.execute("SELECT id, name FROM users WHERE email='requester@example.com'").fetchone()
    con.execute("""INSERT INTO material_request_headers
        (request_number, request_type, requester_id, requester_name, request_status,
         current_workflow_step, created_by, total_lines, plant)
        VALUES ('RQ-DIRECT-1','COST_CENTER',?,?,'Pending Manager Approval',
                'Pending Manager Approval',?,1,'P100')""",
        (requester[0], requester[1], requester[0]))
    rid = con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute("""INSERT INTO material_request_lines
        (request_id, request_number, line_number, material_id, material_code,
         material_description, uom, requested_quantity, approved_quantity, line_status)
        VALUES (?,'RQ-DIRECT-1',1,?,?,?,?,5,5,'Approved')""",
        (rid, material[0], material[1], material[2], material[3]))
    if warehouse:
        con.execute('UPDATE material_request_headers SET issue_warehouse_code=? WHERE id=?',
                    (warehouse, rid))
    con.commit(); con.close()

    env = dict(os.environ, DB_PATH=path, NODE_ENV='test', SKIP_AUTO_SEED='1',
               JWT_SECRET='k' * 48, PORT=str(port))
    server = subprocess.Popen(['node', 'index.js'], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://localhost:{port}'
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(base + '/healthz', timeout=2).read()
                break
            except Exception:
                time.sleep(0.5)
        else:
            return {'error': 'server did not start'}

        def call(method, route, token=None, body=None):
            data = json.dumps(body).encode() if body is not None else None
            rq = urllib.request.Request(base + route, data=data, method=method)
            rq.add_header('Content-Type', 'application/json')
            if token:
                rq.add_header('Authorization', 'Bearer ' + token)
            try:
                res = urllib.request.urlopen(rq, timeout=15)
                return res.getcode(), json.loads(res.read() or '{}')
            except urllib.error.HTTPError as e:
                try:
                    return e.code, json.loads(e.read() or '{}')
                except Exception:
                    return e.code, {}

        _, login = call('POST', '/api/auth/login',
                        body={'email': 'manager@example.com', 'password': 'Passw0rd!'})
        token = login.get('token')
        code, body = call('POST', f'/api/approvals/{rid}/decision', token, {'decision': 'approve'})
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:
            server.kill()

    con = sqlite3.connect(path)
    header = con.execute("""SELECT request_status, erp_reservation_number, issue_warehouse_code
                            FROM material_request_headers WHERE id=?""", (rid,)).fetchone()
    con.close()
    return {'code': code, 'body': body,
            'header': {'request_status': header[0], 'erp_reservation_number': header[1],
                       'issue_warehouse_code': header[2]}}


tmp = tempfile.mkdtemp(prefix='wms-direct-')

# ===== 1. Regression guard: an unconfigured install is unchanged =====
plain = build_db(tmp, 'plain.db')
r = approve_on_own_server(plain, 3401)
check('D1 unconfigured install still stages through ERP',
      r.get('header', {}).get('request_status') == 'Approved - Pending ERP Processing', r)
check('D1 and raises no local issue number',
      not (r.get('header') or {}).get('erp_reservation_number'), r)

# ===== 2. Manufacturing keeps the SAP chain =====
mfg = build_db(tmp, 'mfg.db')
set_edition(mfg, 'manufacturing')
r = approve_on_own_server(mfg, 3402)
check('D2 manufacturing still stages through ERP',
      r.get('header', {}).get('request_status') == 'Approved - Pending ERP Processing', r)

# ===== 3. Contracting goes straight to the store =====
con_db = build_db(tmp, 'con.db')
set_edition(con_db, 'contracting')
r = approve_on_own_server(con_db, 3403, warehouse='WH01')
check('D3 contracting skips the ERP operator',
      r.get('header', {}).get('request_status') == 'Pending Bin Location Assignment', r)
check('D3 the response says so', (r.get('body') or {}).get('routed_without_erp') is True, r.get('body'))

# ===== 4. The ledger keeps its shape =====
# reservation_number is required on every OUT movement, so skipping the staging
# document must not leave it empty.
issue_no = (r.get('header') or {}).get('erp_reservation_number') or ''
check('D4 a local issue number stands in for the reservation',
      issue_no.startswith('ISS-'), issue_no)
check('D4 and a site store was resolved',
      bool((r.get('header') or {}).get('issue_warehouse_code')), r.get('header'))

conn = sqlite3.connect(con_db)
audited = conn.execute("SELECT COUNT(*) FROM audit_trail WHERE action='ROUTED_WITHOUT_ERP'").fetchone()[0]
conn.close()
check('D4 the skip is audited, not silent', audited == 1, audited)

# ===== 5. Nothing is guessed =====
ambiguous = build_db(tmp, 'ambig.db')
set_edition(ambiguous, 'contracting')
conn = sqlite3.connect(ambiguous)
conn.execute("INSERT INTO warehouses (warehouse_code, warehouse_name) VALUES ('WH99','Second Site Store')")
conn.commit(); conn.close()
r = approve_on_own_server(ambiguous, 3404)
check('D5 two site stores and no choice on the request is refused',
      r.get('code') == 400, r)
check('D5 and the refusal says what to do',
      'issue warehouse' in json.dumps(r.get('body', {})).lower(), r.get('body'))

# ===== 6. One site store resolves itself =====
# The small contractor case: a single store, and the storekeeper types nothing.
single = build_db(tmp, 'single.db')
set_edition(single, 'contracting')
conn = sqlite3.connect(single)
conn.execute("UPDATE warehouses SET is_active=0 WHERE warehouse_code <> 'WH01'")
conn.commit(); conn.close()
r = approve_on_own_server(single, 3405)
check('D6 a single site store is resolved without being named',
      r.get('header', {}).get('issue_warehouse_code') == 'WH01', r)
check('D6 and the request still went straight to the store',
      r.get('header', {}).get('request_status') == 'Pending Bin Location Assignment', r)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
