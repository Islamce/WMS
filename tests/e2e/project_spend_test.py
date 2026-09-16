#!/usr/bin/env python3
"""Spend by project: the arithmetic, the reversal rule, the coverage floor, the
window bound, and the register. Runs on the fresh Phase 1 database with a
hand-built ledger whose right answers are worked out here, not copied from
the query under test."""
import json, os, sqlite3, urllib.request, urllib.error

B = 'http://localhost:3000'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.environ.get('DB_PATH') or os.path.join(ROOT, 'data', 'wms.db')
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req); return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or '{}')
        except Exception: return e.code, {}

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print('PASS:', name)
    else: failed += 1; fails.append(name); print('FAIL:', name, detail)

_, r = call('POST', '/api/auth/login', body={'email': 'admin@example.com', 'password': 'Admin@123456'})
admin = r.get('token')
_, r = call('POST', '/api/auth/login', body={'email': 'requester@example.com', 'password': 'Passw0rd!'})
requester = r.get('token')

# ---- fixture: two projects, two priced materials, issues, one reversal, one unattributed issue
con = sqlite3.connect(DB)
con.execute("INSERT OR IGNORE INTO reference_data (category, code, label, is_active) VALUES ('PROJECT','PRJ-A','Alpha',1),('PROJECT','PRJ-B','Beta',1)")
uid = con.execute("SELECT id FROM users WHERE email='admin@example.com'").fetchone()[0]
con.execute("INSERT INTO materials (item_code, description, unit, price, currency) VALUES ('PS-CEM','Cement','BAG',100,'EGP'),('PS-FREE','Unpriced thing','EA',0,'EGP')")
m_cem = con.execute("SELECT id FROM materials WHERE item_code='PS-CEM'").fetchone()[0]
m_free = con.execute("SELECT id FROM materials WHERE item_code='PS-FREE'").fetchone()[0]
def header(num, wbs):
    con.execute("INSERT INTO material_request_headers (request_number, requester_id, requester_name, request_status, wbs_element) VALUES (?,?,?,?,?)", (num, uid, 'Fixture', 'Completed', wbs))
    return con.execute("SELECT id FROM material_request_headers WHERE request_number=?", (num,)).fetchone()[0]
def line(hid, num, mid, code):
    con.execute("INSERT INTO material_request_lines (request_id, request_number, line_number, material_id, material_code, requested_quantity, line_status) VALUES (?,?,?,?,?,?,?)", (hid, num, 1, mid, code, 1, 'Picked'))
    return con.execute("SELECT id FROM material_request_lines WHERE request_id=? AND line_number=1", (hid,)).fetchone()[0]
ha = header('MR-PS-A', 'PRJ-A'); la = line(ha, 'MR-PS-A', m_cem, 'PS-CEM')
hb = header('MR-PS-B', 'PRJ-B'); lb = line(hb, 'MR-PS-B', m_cem, 'PS-CEM')
hc = header('MR-PS-C', 'PRJ-B'); lc = line(hc, 'MR-PS-C', m_free, 'PS-FREE')
con.execute("INSERT OR IGNORE INTO locations (code) VALUES ('PS-LOC')")
loc = con.execute("SELECT id FROM locations WHERE code='PS-LOC'").fetchone()[0]
def tx(ttype, mid, qty, cat, line_id, when, rev_of=None):
    con.execute("INSERT INTO stock_transactions (transaction_type, material_id, location_id, quantity, user_id, transaction_date, movement_category, request_line_id, reversal_of_transaction_id) VALUES (?,?,?,?,?,?,?,?,?)", (ttype, mid, loc, qty, uid, when, cat, line_id, rev_of))
    return con.execute("SELECT last_insert_rowid()").fetchone()[0]
# window: 2026-03-01 .. 2026-03-31
t1 = tx('OUT', m_cem, 100, 'ISSUE', la, '2026-03-05 10:00:00')     # A: 100 x 100 = 10,000
t2 = tx('OUT', m_cem, 40,  'ISSUE', lb, '2026-03-10 10:00:00')     # B: 40
t3 = tx('IN',  m_cem, 15,  'REVERSAL', lb, '2026-03-11 10:00:00', t2)  # B: -15 -> 25 x 100 = 2,500
t4 = tx('OUT', m_free, 7,  'ISSUE', lc, '2026-03-12 10:00:00')     # B: 7 unpriced -> spend 0
t5 = tx('OUT', m_cem, 999, 'ISSUE', None, '2026-03-15 10:00:00')   # unattributed: excluded, counted in coverage
t6 = tx('OUT', m_cem, 50,  'ISSUE', la, '2026-04-02 10:00:00')     # outside the window
con.commit(); con.close()

# ---- the roll-up
c, r = call('GET', '/api/reports/project-spend?from=2026-03-01&to=2026-03-31', admin)
check('report answers', c == 200, (c, r))
by = {row['project']: row for row in r.get('rows', [])}
check('project A: 100 bags x 100 = 10,000', by.get('PRJ-A', {}).get('spend') == 10000 and by['PRJ-A']['quantity'] == 100, by.get('PRJ-A'))
check('project B nets the reversal: (40 - 15) x 100 = 2,500, plus 7 unpriced units at 0', by.get('PRJ-B', {}).get('spend') == 2500 and by['PRJ-B']['quantity'] == 32, by.get('PRJ-B'))
check('the April issue is outside the window', all(row['quantity'] != 150 for row in r['rows']), r['rows'])
check('coverage says 3 of 4 issues in the window are attributable', r['coverage']['attributable_issues'] == 3 and r['coverage']['total_issues'] == 4, r['coverage'])
check('coverage names the unpriced material', r['coverage']['unpriced_materials'] == 1, r['coverage'])
check('the report says its price basis out loud', 'Current material price' in r.get('price_basis', ''), r.get('price_basis'))
check('the unattributed 999 is not smuggled in under any project', not any(row['quantity'] >= 999 for row in r['rows']), r['rows'])

# ---- drill-down
c, r = call('GET', '/api/reports/project-spend?from=2026-03-01&to=2026-03-31&project=PRJ-B', admin)
items = {row['item_code']: row for row in r.get('rows', [])}
check('drill-down lists both materials of project B', set(items) == {'PS-CEM', 'PS-FREE'}, list(items))
check('drill-down cement line is 25 units, 2,500', items.get('PS-CEM', {}).get('quantity') == 25 and items['PS-CEM']['spend'] == 2500, items.get('PS-CEM'))

# ---- bounds and access
c, r = call('GET', '/api/reports/project-spend?from=2020-01-01&to=2026-03-31', admin)
check('a window over 366 days is refused, not run', c == 400 and 'window' in r.get('error', '').lower(), (c, r))
c, r = call('GET', '/api/reports/project-spend?from=2026-03-31&to=2026-03-01', admin)
check('from after to is refused', c == 400, (c, r))
c, r = call('GET', '/api/reports/project-spend', requester)
check('a requester without kpi_dashboard cannot read the report', c == 403, (c, r))

# ---- the register
c, r = call('GET', '/api/master/reference/PROJECT', admin)
check('the project register is readable', c == 200 and {i['code'] for i in r['items']} >= {'PRJ-A', 'PRJ-B'}, (c, r))
c, r = call('POST', '/api/master/reference', requester, {'category': 'PROJECT', 'code': 'PRJ-X', 'label': 'nope'})
check('a requester cannot add to the register (403)', c == 403, (c, r))
c, r = call('POST', '/api/master/reference', admin, {'category': 'PROJECT', 'code': 'prj-c', 'label': 'Gamma'})
check('an administrator can, and the code is normalised', c == 201, (c, r))
c, r = call('POST', '/api/master/reference', admin, {'category': 'PROJECT', 'code': 'PRJ-C', 'label': 'again'})
check('a duplicate code is refused (409)', c == 409, (c, r))
c, r = call('GET', '/api/meta', admin)
check('the request form sees the register through /api/meta', any(p['code'] == 'PRJ-C' for p in r.get('projects', [])), r.get('projects'))

# ---- the requests list filters by project
c, r = call('GET', '/api/requests?project=PRJ-A', admin)
check('the requests list filters by project', c == 200 and r['total'] == 1 and r['requests'][0]['wbs_element'] == 'PRJ-A', (c, r.get('total')))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if failed: print('Failed:', fails)
raise SystemExit(1 if failed else 0)
