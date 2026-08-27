#!/usr/bin/env python3
"""Quick-wins hardening tests:
 1. Optimistic-lock guard: a stale status transition is rejected (409) instead
    of silently clobbering a concurrent change.
 2. Pagination: growth-prone list endpoints (batches, cycle-count) return
    total/page/limit and cap the page size.
Runs in Phase 1 after the other hardening suites (shared DB).
"""
import json, urllib.request, urllib.error, os, sys, subprocess, datetime

B = "http://localhost:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or '{}')
        except: return e.code, {}

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def login(email, pw):
    c, p = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return p.get('token')

admin = login('admin@example.com', 'Admin@123456')

# ===== 1. Optimistic-lock guard (exercised directly against the service) =====
code = r"""
const db = require('./server/db/connection');
const { setHeaderStatus } = require('./server/services/requests');
const rn = 'QW-LOCK-' + Date.now();
const uid = db.prepare("SELECT id FROM users WHERE email='admin@example.com'").get().id;
const id = db.prepare("INSERT INTO material_request_headers (request_number, requester_id, request_status) VALUES (?,?, 'Draft')").run(rn, uid).lastInsertRowid;
const stale = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(id);
// A concurrent actor advances the row first.
db.prepare("UPDATE material_request_headers SET request_status='Submitted' WHERE id=?").run(id);
let threw = false, status = null;
try { setHeaderStatus(stale, 'Submitted', {}); } catch (e) { threw = true; status = e.status; }
// A fresh read transitions fine.
const fresh = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(id);
let okChange = false;
try { setHeaderStatus(fresh, 'Pending Manager Approval', {}); okChange = true; } catch (e) {}
console.log(JSON.stringify({ threw, status, okChange }));
"""
p = subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True)
try:
    out = json.loads(p.stdout.strip().splitlines()[-1])
    check('stale transition rejected', out['threw'] is True, out)
    check('stale transition returns 409', out['status'] == 409, out)
    check('fresh transition still succeeds', out['okChange'] is True, out)
except Exception as e:
    check('optimistic-lock test ran', False, f'{e}: {p.stdout} {p.stderr}')

# ===== 2. Pagination on growth-prone lists =====
c, r = call('GET', '/api/master/batches?page=1', admin)
check('batches endpoint paginated', c == 200 and 'total' in r and r.get('page') == 1 and 'limit' in r, r)
check('batches page size capped', len(r.get('batches', [])) <= r.get('limit', 100), (len(r.get('batches', [])), r.get('limit')))
c, r = call('GET', '/api/cycle-count?page=1', admin)
check('cycle-count endpoint paginated', c == 200 and 'total' in r and r.get('page') == 1 and 'limit' in r, r)

# ===== 3. Stock transaction type/today filters (mobile dashboard drill-down) =====
c, r = call('GET', '/api/stock/transactions?type=IN&limit=100', admin)
check('transactions type=IN filter returns only IN rows', c == 200
      and all(t.get('transaction_type') == 'IN' for t in r.get('transactions', [])), r)
c, r = call('GET', '/api/stock/transactions?type=OUT&limit=100', admin)
check('transactions type=OUT filter returns only OUT rows', c == 200
      and all(t.get('transaction_type') == 'OUT' for t in r.get('transactions', [])), r)
c, r = call('GET', '/api/stock/transactions?type=BOGUS&limit=5', admin)
check('unrecognized type value is ignored, not an error', c == 200, r)
today_str = datetime.date.today().isoformat()
c, r = call('GET', '/api/stock/transactions?today=1&limit=100', admin)
today_ok = c == 200 and all((t.get('transaction_date') or '')[:10] == today_str for t in r.get('transactions', []))
check('transactions today=1 filter returns only today\'s rows', today_ok, r)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
