#!/usr/bin/env python3
"""Does the Materials master report what is physically in the store?

Two ledgers describe one store. `batches` is the execution ledger — goods
receipt, put-away, picking, goods issue, counts and reallocation all move it.
`material_location_stock` is moved only by the legacy stock-in/stock-out
screens, and is ALSO written by the opening-stock importer, which writes BOTH
ledgers for the same physical quantity.

The master used to add them. On production that double-counted 2,843 of 9,746
materials (measured 2026-09-16), and — worse — a material whose batches had
been issued to zero kept reporting its original import quantity forever,
because the importer's mirror row never moves.

The position built here, one material per case:

    material   batches                  legacy rows                physical
    IMPORTED   100 in RACK-01           100 at RACK-01 (mirror)          100
    LEGACY     none                      25 at RACK-01                    25
    MIXED       60 in RACK-01            40 at YARD-A (no batch)         100
    DEPLETED      0 in RACK-01 (issued) 100 at RACK-01 (stale mirror)      0

Those four numbers are worked out by hand from what is physically present, not
read off the query under test.

NOT asserted here, deliberately: that /api/materials/search agrees. It answers
a different question — what a request could be filled from — and allocation
reads batches only, so legacy stock is on hand without being allocatable. The
two numbers differ for MIXED by design. Do not "fix" them into agreement
without deciding that semantic first.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['no_proxy'] = 'localhost,127.0.0.1'
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


def api(method, path, token=None, body=None):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


tmp = tempfile.mkdtemp(prefix='wms-materials-truth-')
db = os.path.join(tmp, 'wms.db')
# A free port, not a fixed one: on a fixed port an incumbent server answers the
# test's requests instead of its own, and the failure reads as a wrong number
# rather than a port clash.
with __import__('socket').socket() as _s:
    _s.bind(('127.0.0.1', 0))
    PORT = _s.getsockname()[1]
server = None
try:
    prov = run('scripts/provision-tenant.js', '--name', 'Stock Truth Ltd', '--slug', 'stocktruth',
               '--profile', 'contracting', '--admin-email', 'ops@example.com', '--db', db)
    if prov.returncode != 0:
        print('provisioning failed:', prov.stderr[-500:])
        sys.exit(1)
    password = None
    for line in prov.stdout.splitlines():
        if 'password' in line.lower() and ':' in line:
            password = line.split(':', 1)[1].strip()

    con = sqlite3.connect(db)
    con.execute('PRAGMA foreign_keys=ON')
    # Starter data is deliberately NOT installed: this suite wants exactly the
    # four cases below and nothing else that could drift underneath them. The
    # store is built by hand, so only the warehouse the batches reference.
    con.execute("INSERT INTO warehouses (warehouse_code, warehouse_name) VALUES ('SITE-01', 'Main Site Store')")
    con.execute("INSERT INTO locations (code) VALUES ('SITE-01-RACK-01'), ('SITE-01-YARD-A')")
    rack = con.execute("SELECT id FROM locations WHERE code='SITE-01-RACK-01'").fetchone()[0]
    yard = con.execute("SELECT id FROM locations WHERE code='SITE-01-YARD-A'").fetchone()[0]

    MATERIALS = ['MST-IMPORTED', 'MST-LEGACY', 'MST-MIXED', 'MST-DEPLETED']
    for code in MATERIALS:
        con.execute("INSERT INTO materials (item_code, description, unit, material_type) "
                    "VALUES (?, ?, 'EA', 'Construction material')", (code, f'Truth case {code}'))
    mid = {c: con.execute('SELECT id FROM materials WHERE item_code=?', (c,)).fetchone()[0]
           for c in MATERIALS}

    def batch(code, bin_location, remaining):
        con.execute("""INSERT INTO batches
            (batch_number, material_id, material_code, material_description, received_quantity,
             remaining_quantity, reserved_quantity, warehouse_code, bin_location, quality_status,
             is_blocked, owner_type, receiving_date)
            VALUES (?,?,?,?,?,?,0,'SITE-01',?, 'RELEASED', 0, 'COMPANY', date('now','-5 days'))""",
            (f'B-{code}', mid[code], code, 'Truth case', remaining, remaining, bin_location))

    def legacy(code, location_id, quantity):
        con.execute('INSERT INTO material_location_stock (material_id, location_id, quantity) VALUES (?,?,?)',
                    (mid[code], location_id, quantity))

    # The importer writes both ledgers for one delivery.
    batch('MST-IMPORTED', 'SITE-01-RACK-01', 100)
    legacy('MST-IMPORTED', rack, 100)
    # Booked through /api/stock/in only: no batch was ever created.
    legacy('MST-LEGACY', rack, 25)
    # A batch in the rack, and genuinely separate legacy stock out in the yard.
    batch('MST-MIXED', 'SITE-01-RACK-01', 60)
    legacy('MST-MIXED', yard, 40)
    # Imported, then picked and issued down to nothing. The mirror row is stale.
    batch('MST-DEPLETED', 'SITE-01-RACK-01', 0)
    legacy('MST-DEPLETED', rack, 100)
    con.commit()
    con.close()

    env = dict(os.environ, DB_PATH=db, NODE_ENV='test', SKIP_AUTO_SEED='1',
               JWT_SECRET='k' * 48, PORT=str(PORT))
    server = subprocess.Popen(['node', 'index.js'], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            if api('GET', '/healthz')[0] == 200:
                break
        except Exception:
            pass
        time.sleep(0.5)

    st, body = api('POST', '/api/auth/login', body={'email': 'ops@example.com', 'password': password})
    token = body.get('token')
    check('the materials master is reachable at all', st == 200 and bool(token), (st, body))

    st, page = api('GET', '/api/materials?search=MST-&limit=50', token)
    check('the master answers', st == 200, (st, page))
    by_code = {m['item_code']: m for m in page.get('materials', [])}
    check('all four cases are on the screen', set(by_code) >= set(MATERIALS), list(by_code))

    # ---- the four physical truths -----------------------------------------
    check('M1 an imported material is counted ONCE, not once per ledger (100, not 200)',
          by_code.get('MST-IMPORTED', {}).get('total_stock') == 100,
          by_code.get('MST-IMPORTED', {}).get('total_stock'))
    check('M2 stock that only the legacy ledger knows about is still counted (25)',
          by_code.get('MST-LEGACY', {}).get('total_stock') == 25,
          by_code.get('MST-LEGACY', {}).get('total_stock'))
    check('M3 legacy stock held where no batch sits is added, not dropped (60 + 40 = 100)',
          by_code.get('MST-MIXED', {}).get('total_stock') == 100,
          by_code.get('MST-MIXED', {}).get('total_stock'))
    check('M4 an issued material reads zero, not its stale import mirror (0, not 100)',
          by_code.get('MST-DEPLETED', {}).get('total_stock') == 0,
          by_code.get('MST-DEPLETED', {}).get('total_stock'))

    # ---- the figure says which ledgers produced it -------------------------
    check('M5 the number names the ledgers it came from',
          by_code.get('MST-IMPORTED', {}).get('total_stock_source') == 'batches'
          and by_code.get('MST-LEGACY', {}).get('total_stock_source') == 'legacy locations'
          and by_code.get('MST-MIXED', {}).get('total_stock_source') == 'batches + legacy locations',
          {c: by_code.get(c, {}).get('total_stock_source') for c in MATERIALS})

    # ---- the filters read the corrected figure, not the old one ------------
    st, in_page = api('GET', '/api/materials?search=MST-&stock=in&limit=50', token)
    in_codes = {m['item_code'] for m in in_page.get('materials', [])}
    check('M6 "in stock" excludes the issued material the old figure kept alive',
          st == 200 and 'MST-DEPLETED' not in in_codes and {'MST-IMPORTED', 'MST-LEGACY', 'MST-MIXED'} <= in_codes,
          sorted(in_codes))
    st, out_page = api('GET', '/api/materials?search=MST-&stock=out&limit=50', token)
    out_codes = {m['item_code'] for m in out_page.get('materials', [])}
    check('M7 and "out of stock" finds it',
          st == 200 and 'MST-DEPLETED' in out_codes, sorted(out_codes))

    # ---- paging count and rows agree --------------------------------------
    check('M8 the row count matches the rows returned',
          in_page.get('total') == len(in_codes), (in_page.get('total'), len(in_codes)))
finally:
    if server:
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
