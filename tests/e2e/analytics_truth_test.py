#!/usr/bin/env python3
"""Do the dashboard, the KPI screen and the analytics report tell the truth?

Not "do the endpoints return 200" — every screen already does. This builds a
stock position whose correct answers are known by hand, then asks each screen
and compares. Where two screens answer the same question differently, that is
recorded as a finding rather than a preference: a warehouse manager reading
"total stock" on one screen and "current stock" on another is entitled to
assume they mean the same thing.

The position, for one material:

    batch   remaining  reserved  owner          quality        allocatable
    B1           100         0   COMPANY        RELEASED               100
    B2            50         0   COMPANY        QUALITY_HOLD             0
    B3           200         0   SUBCONTRACTOR  RELEASED                 0  (not ours)
    B4            30        10   COMPANY        RELEASED                20
    B5            40         0   COMPANY        RELEASED, BLOCKED        0
    B6            15         0   COMPANY        RELEASED, no bin         15

Hand-computed truths:
    owner-blind sum of remaining .................. 435
    company-owned, net of reservation ............. 225   (still counts hold + blocked)
    genuinely issuable today ...................... 135   (what allocation would find)

Those three numbers are all defensible; what is not defensible is two screens
using the same words for different ones without saying so.

All six findings this test first recorded have now been corrected, and the
assertions below pin the corrected behaviour. Where a number deliberately did
NOT change (total stock on hand), that is asserted too, so a future "tidy-up"
cannot quietly redefine it.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
passed = failed = 0
fails = []
findings = []


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print("PASS:", name)
    else:
        failed += 1
        fails.append(name)
        print("FAIL:", name, detail)


def finding(title, detail):
    findings.append((title, detail))
    print("FINDING:", title)
    print("        ", detail)


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


tmp = tempfile.mkdtemp(prefix='wms-analytics-truth-')
db = os.path.join(tmp, 'wms.db')
# A free port, not a fixed one: on a fixed port an incumbent server answers the
# test's requests instead of its own, and the failure reads as a wrong number
# rather than a port clash.
with __import__('socket').socket() as _s:
    _s.bind(('127.0.0.1', 0))
    PORT = _s.getsockname()[1]
server = None
try:
    prov = run('scripts/provision-tenant.js', '--name', 'Truth Ltd', '--slug', 'truth',
               '--profile', 'contracting', '--admin-email', 'ops@example.com', '--db', db)
    if prov.returncode != 0:
        print('provisioning failed:', prov.stderr[-500:])
        sys.exit(1)
    password = None
    for line in prov.stdout.splitlines():
        if 'password' in line.lower() and ':' in line:
            password = line.split(':', 1)[1].strip()

    ins = run('scripts/install-starter-data.js', '--db', db)
    if ins.returncode != 0:
        print('starter data failed:', ins.stderr[-500:])
        sys.exit(1)

    con = sqlite3.connect(db)
    con.execute('PRAGMA foreign_keys=ON')
    mat = con.execute("SELECT id, item_code FROM materials WHERE item_code='CEM-OPC-50'").fetchone()
    wh = con.execute('SELECT warehouse_code FROM warehouses LIMIT 1').fetchone()[0]
    uid = con.execute('SELECT id FROM users LIMIT 1').fetchone()[0]
    loc = con.execute('SELECT id FROM locations LIMIT 1').fetchone()
    if loc is None:
        con.execute("INSERT INTO locations (code) VALUES (?)", (wh,))
        loc = con.execute('SELECT id FROM locations LIMIT 1').fetchone()
    loc = loc[0]

    BATCHES = [
        ('B1', 100, 0,  'COMPANY',       'RELEASED',     0, 'RACK-01'),
        ('B2',  50, 0,  'COMPANY',       'QUALITY_HOLD', 0, 'RACK-02'),
        ('B3', 200, 0,  'SUBCONTRACTOR', 'RELEASED',     0, 'YARD-A'),
        ('B4',  30, 10, 'COMPANY',       'RELEASED',     0, 'RACK-01'),
        ('B5',  40, 0,  'COMPANY',       'RELEASED',     1, 'RACK-03'),
        # No bin. Real: a delivery received but not yet put away.
        ('B6',  15, 0,  'COMPANY',       'RELEASED',     0, None),
    ]
    for code, rem, res, owner, q, blocked, bin_code in BATCHES:
        con.execute("""INSERT INTO batches
            (batch_number, material_id, material_code, material_description, received_quantity,
             remaining_quantity, reserved_quantity, warehouse_code, bin_location, quality_status,
             is_blocked, owner_type, receiving_date)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?, date('now','-10 days'))""",
            (code, mat[0], mat[1], 'Portland cement', rem, rem, res, wh, bin_code, q, blocked, owner))

    # Two movements, ten days apart, so the 30-day series has real gaps in it.
    con.execute("""INSERT INTO stock_transactions
        (transaction_type, material_id, location_id, quantity, user_id, transaction_date)
        VALUES ('IN', ?, ?, 100, ?, datetime('now','-20 days'))""", (mat[0], loc, uid))
    con.execute("""INSERT INTO stock_transactions
        (transaction_type, material_id, location_id, quantity, reservation_number, user_id, transaction_date)
        VALUES ('OUT', ?, ?, 25, 'RSV-TRUTH-1', ?, datetime('now','-10 days'))""", (mat[0], loc, uid))

    # A request in every lifecycle state the KPI screen counts, one each.
    for i, st in enumerate(['Completed', 'Rejected', 'Cancelled', 'ERP Error', 'Approved']):
        con.execute("""INSERT INTO material_request_headers
            (request_number, request_status, requester_id, requester_name, issue_warehouse_code, created_at)
            VALUES (?,?,?,?,?, datetime('now'))""",
            (f'REQ-TRUTH-{i}', st, uid, 'Ops', wh))
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
    check('the screens are reachable at all', st == 200 and bool(token), (st, body))

    sd, dash = api('GET', '/api/dashboard', token)
    sk, kpi = api('GET', '/api/kpi', token)
    sa, ana = api('GET', '/api/analytics', token)
    check('dashboard, KPI and analytics all answer', (sd, sk, sa) == (200, 200, 200), (sd, sk, sa))

    # ---- 1. The same question, three screens -------------------------------
    total_stock = dash['kpis']['total_stock']
    item = next((i for i in ana['items'] if i['item_code'] == 'CEM-OPC-50'), None)
    check('the analytics report includes the material', item is not None)

    k0 = dash['kpis']
    check('T1 stock on hand still counts every batch, whoever owns it (435)',
          total_stock == 435, total_stock)
    check('T1 the dashboard now also says what can actually be issued (135)',
          k0.get('available_stock') == 135, k0.get('available_stock'))
    check('T1 and names what is held back (90: 50 on hold + 40 blocked)',
          k0.get('held_stock') == 90, k0.get('held_stock'))
    check('T1 and what belongs to a subcontractor (200)',
          k0.get('subcontractor_stock') == 200, k0.get('subcontractor_stock'))
    check('T1 and what was received but never put away (15)',
          k0.get('unplaced_stock') == 15, k0.get('unplaced_stock'))
    check('T1 the dashboard and the analytics report agree on what is issuable',
          k0.get('available_stock') == (item or {}).get('issuable_stock'),
          (k0.get('available_stock'), (item or {}).get('issuable_stock')))
    # The four parts must account for the whole. A released, unblocked, fully
    # reserved batch once fell into no bucket and the screen showed a gap it
    # never explained.
    parts = (k0.get('available_stock', 0) + k0.get('reserved_stock', 0)
             + k0.get('held_stock', 0) + k0.get('subcontractor_stock', 0))
    check('T1 available + reserved + held + subcontractor accounts for every unit on hand',
          parts == total_stock, (parts, total_stock, k0))
    check('T1 analytics reports the subcontractor holding separately (200)',
          item and item['subcontractor_stock'] == 200, item and item['subcontractor_stock'])

    # ---- 2. Stock that cannot be issued still counts as stock --------------
    # allocation.js takes only quality_status='RELEASED' AND is_blocked=0.
    issuable = 135
    # current_stock deliberately still counts held stock. Excluding it was worse
    # than the defect it fixed: receiving.js puts EVERY received batch on
    # QUALITY_HOLD, so a fresh delivery read as zero and fired a critical
    # "replenish now" alert on material that had just been unloaded.
    check('T2 current stock counts held stock, because held stock is pending, not lost (225)',
          item and item['current_stock'] == 225, item and item['current_stock'])
    check('T2 what a picker could be handed today is its own figure (135)',
          item and item.get('issuable_stock') == issuable, item and item.get('issuable_stock'))
    check('T2 and the held part is named rather than dropped (90)',
          item and item.get('held_stock') == 90, item and item.get('held_stock'))
    check('T2 a material whose stock is entirely held still appears in the report',
          item is not None and item['classification'] != 'INACTIVE', item and item['classification'])
    # (The finding this block used to raise is now a deliberate decision, pinned
    # by the assertions above rather than reported as a defect.)
    check('T2 the analytics service knows hold/blocked stock is unavailable (it says so in insights)',
          any('quality' in (i.get('title', '') + i.get('detail', '')).lower() for i in ana['insights']),
          [i['title'] for i in ana['insights']])

    # ---- 3. KPI request states -------------------------------------------
    k = kpi['kpis']
    total = k['total_requests']
    bucket_sum = k['completed'] + k['partially_completed'] + k['rejected'] + k['cancelled'] + k['open']
    check('T3 the KPI request buckets add up to the total exactly once',
          bucket_sum + k['erp_error'] == total,
          f"buckets={bucket_sum} erp_error={k['erp_error']} total={total}")
    if k['erp_error'] and bucket_sum == total:
        finding('ERP Error requests are counted twice',
                f"open = total - completed - partial - rejected - cancelled, which leaves the "
                f"{k['erp_error']} ERP Error request inside 'open' as well as in its own tile. "
                "Defensible as 'still open work', but any chart drawing both reads over 100%.")

    # ---- 4. The 30-day series ---------------------------------------------
    series = dash['charts']['in_out_over_time']
    check('T4 the series is a real 30-day axis, quiet days included', len(series) == 30, len(series))
    check('T4 and the quiet days are zero rather than absent',
          sum(1 for d in series if d['in_qty'] == 0 and d['out_qty'] == 0) >= 25,
          [d for d in series if d['in_qty'] or d['out_qty']])
    check('T4 and it still carries both real movements',
          sum(d['in_qty'] for d in series) == 100 and sum(d['out_qty'] for d in series) == 25,
          series)
    if len(series) < 28:
        finding('"Stock IN vs OUT — last 30 days" plots only the days that had movement',
                f"The series returned {len(series)} point(s) for a 30-day window; days with no "
                "movement are absent rather than zero. The chart uses a category axis "
                "(public/js/pages/dashboard.js), so two movements ten days apart render as adjacent "
                "points and the x-axis stops being time. A quiet fortnight looks like steady activity.")

    # ---- 5. The location ranking ------------------------------------------
    codes = [r['code'] for r in dash['top_locations']]
    check('T5 the bin ranking contains bins only, never a bare warehouse code',
          wh not in codes, codes)
    check('T5 and every bin is qualified by its warehouse',
          all(' · ' in c for c in codes), codes)
    check('T5 the unplaced batch is reported as its own figure instead',
          k0.get('unplaced_stock') == 15, k0.get('unplaced_stock'))
    if any(c == wh for c in codes) and any(c != wh for c in codes):
        finding('The location ranking mixes bins and warehouses on one axis',
                f"top_locations groups by COALESCE(NULLIF(bin_location,''), warehouse_code), so a bin "
                f"and a whole warehouse compete in the same ranking: {codes}. Batches with no bin are "
                "ranked as if the warehouse were a location. The same bin_code in two warehouses also "
                "collapses into one bar.")

    # ---- 6. Does the collapsed contracting workflow leave KPIs dead? -------
    check('T6 a contracting tenant is told the ERP cycle times do not apply',
          k.get('erp_staging') is False
          and k.get('avg_erp_reservation_minutes') is None
          and k.get('avg_gi_posting_minutes') is None,
          {kk: k.get(kk) for kk in ('erp_staging', 'avg_erp_reservation_minutes', 'avg_gi_posting_minutes')})
    check('T6 and is given the cycle time its workflow actually has',
          'avg_approval_to_issue_minutes' in k, sorted(k))
    # The one structural fix the first version of this test did not pin — proved
    # unpinned by mutation testing, and it was the one broken on the KPI screen.
    check('T6 a success rate over zero postings is unknown, not 100%',
          k.get('erp_success_rate') is None, k.get('erp_success_rate'))
    if k['avg_erp_reservation_minutes'] == 0 and k['avg_gi_posting_minutes'] == 0:
        finding('Two cycle-time KPIs are structurally zero on the contracting edition',
                "avg_erp_reservation_minutes and avg_gi_posting_minutes are both measured from "
                "erp_reservation_date, which is written in exactly one place: "
                "server/routes/erpOperator.js:116, the ERP Operator screen. The contracting "
                "workflow routes past that screen entirely, so the column stays NULL and both "
                "tiles read 0 forever — indistinguishable from 'instant'.")

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
    print('Failed:', ', '.join(fails))
print(f"===== {len(findings)} finding(s) about what the numbers mean =====")
for i, (t, _) in enumerate(findings, 1):
    print(f"  {i}. {t}")
sys.exit(1 if failed else 0)
