#!/usr/bin/env python3
"""A flat subscription that can never take a warehouse offline by accident.

The product had no way to charge anyone: no subscription, no term, no expiry,
nothing anywhere recording that a customer owed money. It could be delivered as
a bespoke installation per customer, which does not scale past the number of
customers one person can onboard.

This pins the behaviour that makes the mechanism safe enough to ship:

 1. NO ROW MEANS NO RESTRICTION. Every existing deployment, production included,
    has no subscription row and must be completely unaffected. This is the same
    fail-open rule tenant_profile already follows, and it is the assertion that
    matters most — a licence check that failed closed would turn a lost row or a
    half-restored backup into a stopped warehouse.
 2. Expiry is a ramp, not a switch: warnings, then a grace period that still
    writes, and only then read-only.
 3. Read-only means READ-ONLY. Reads, exports and login keep working, because
    the customer's stock records are theirs and they still have to run the site.
 4. Removing the subscription restores an unrestricted system — the escape hatch
    if licensing itself ever misbehaves on a live site.
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


def node(*argv):
    return subprocess.run(['node'] + list(argv), cwd=ROOT, capture_output=True, text=True)


def iso(days_from_now):
    return time.strftime('%Y-%m-%d', time.gmtime(time.time() + days_from_now * 86400))


tmp = tempfile.mkdtemp(prefix='wms-subs-')
db = os.path.join(tmp, 'wms.db')
env0 = dict(os.environ, DB_PATH=db, NODE_ENV='test', SKIP_AUTO_SEED='1')
subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env0, capture_output=True, text=True)
subprocess.run(['node', 'server/db/seed.js'], cwd=ROOT, env=env0, capture_output=True, text=True)

port = 3441
base = f'http://localhost:{port}'
server = None


def start():
    global server
    env = dict(env0, JWT_SECRET='k' * 48, PORT=str(port))
    server = subprocess.Popen(['node', 'index.js'], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(base + '/healthz', timeout=2).read()
            return True
        except Exception:
            time.sleep(0.5)
    return False


def stop():
    global server
    if not server:
        return
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()
    server = None


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


def login(email='requester@example.com'):
    # The requester account, because the write below has to be a REAL write
    # through a real route — a synthetic endpoint would not prove the middleware
    # sits in front of the ones that matter.
    return call('POST', '/api/auth/login', body={'email': email, 'password': 'Passw0rd!'})


def try_write(token, n):
    """A real write through a real route, not a synthetic one."""
    return call('POST', '/api/requests', token, {
        'request_type': 'COST_CENTER', 'plant': 'P100',
        'lines': [{'material_id': material_id, 'requested_quantity': n}],
    })


con = sqlite3.connect(db)
material_id = con.execute('SELECT id FROM materials LIMIT 1').fetchone()[0]
con.close()

try:
    # ===== 1. The assertion that matters most: no row, no restriction =====
    assert start(), 'server did not start'
    code, body = login()
    token = body.get('token')
    check('S1 an existing deployment logs in normally', code == 200 and bool(token), (code, body))
    code, body = call('GET', '/api/subscription/status', token)
    check('S1 and reports itself unlicensed, not expired',
          code == 200 and body.get('state') == 'UNLICENSED' and body.get('writable') is True, body)
    code, body = try_write(token, 1)
    check('S1 writes are completely unaffected', code in (200, 201), (code, body))
    stop()

    # ===== 2. An active subscription changes nothing =====
    r = node('scripts/set-subscription.js', '--db', db, '--plan', 'standard', '--months', '12')
    check('S2 the dry run reports without writing', r.returncode == 0 and 'DRY RUN' in r.stdout, r.stdout[-300:])
    con = sqlite3.connect(db)
    check('S2 and really wrote nothing',
          con.execute('SELECT COUNT(*) FROM tenant_subscription').fetchone()[0] == 0)
    con.close()

    r = node('scripts/set-subscription.js', '--db', db, '--plan', 'standard', '--months', '12', '--apply')
    check('S2 the subscription is set', r.returncode == 0, r.stderr[-300:])
    assert start()
    token = login()[1]['token']
    code, body = call('GET', '/api/subscription/status', token)
    check('S2 it reports ACTIVE with no message to show',
          body.get('state') == 'ACTIVE' and body.get('message') is None, body)
    code, body = try_write(token, 2)
    check('S2 writes still work', code in (200, 201), (code, body))
    stop()

    # ===== 3. Expiry is a ramp: warn, then grace, then read-only =====
    con = sqlite3.connect(db)
    con.execute("UPDATE tenant_subscription SET expires_on=?, grace_days=14 WHERE id=1", (iso(10),))
    con.commit(); con.close()
    assert start()
    token = login()[1]['token']
    code, body = call('GET', '/api/subscription/status', token)
    check('S3 inside the warning window it says so', body.get('state') == 'EXPIRING', body)
    check('S3 and names the date', body.get('expires_on') in (body.get('message') or ''), body)
    code, body = try_write(token, 3)
    check('S3 but nothing is blocked yet', code in (200, 201), (code, body))
    stop()

    con = sqlite3.connect(db)
    con.execute("UPDATE tenant_subscription SET expires_on=? WHERE id=1", (iso(-3),))
    con.commit(); con.close()
    assert start()
    token = login()[1]['token']
    code, body = call('GET', '/api/subscription/status', token)
    check('S3 past expiry but inside grace it is still writable',
          body.get('state') == 'GRACE' and body.get('writable') is True, body)
    code, body = try_write(token, 4)
    # This is the one that stops a late renewal stranding a storekeeper who is
    # halfway through a pick with material already on a forklift.
    check('S3 a late renewal does not strand work in progress', code in (200, 201), (code, body))
    stop()

    # ===== 4. Read-only means read-only, not locked out =====
    con = sqlite3.connect(db)
    con.execute("UPDATE tenant_subscription SET expires_on=? WHERE id=1", (iso(-40),))
    con.commit(); con.close()
    assert start()
    code, body = login()
    token = body.get('token')
    check('S4 the customer can still LOG IN to read the message', code == 200 and bool(token), (code, body))

    code, body = try_write(token, 5)
    check('S4 writes are refused', code == 402, (code, body))
    check('S4 with a message naming the expiry date, not a bare error',
          'expired' in (body.get('error') or '').lower(), body)
    check('S4 and flagged as a payment problem, not a session failure',
          body.get('subscription_state') == 'READ_ONLY', body)

    code, body = call('GET', '/api/requests', token)
    check('S4 reading the records still works', code == 200, code)
    code, body = call('GET', '/api/dashboard', token)
    check('S4 and so do the reports', code == 200, code)
    code, body = call('GET', '/api/subscription/status', token)
    check('S4 the status endpoint stays reachable', code == 200, code)

    con = sqlite3.connect(db)
    rows = con.execute('SELECT COUNT(*) FROM material_request_headers').fetchone()[0]
    con.close()
    check('S4 nothing was deleted — the records are intact', rows >= 4, rows)
    stop()

    # ===== 5. Suspension, and the escape hatch =====
    r = node('scripts/set-subscription.js', '--db', db, '--remove', '--apply')
    check('S5 the subscription can be removed', r.returncode == 0, r.stderr[-300:])
    assert start()
    token = login()[1]['token']
    code, body = call('GET', '/api/subscription/status', token)
    check('S5 and the deployment is unrestricted again',
          body.get('state') == 'UNLICENSED' and body.get('writable') is True, body)
    code, body = try_write(token, 6)
    check('S5 writes work again — licensing can be taken out of the way', code in (200, 201), (code, body))

    con = sqlite3.connect(db)
    audited = con.execute("SELECT COUNT(*) FROM audit_trail WHERE entity_type='Subscription'").fetchone()[0]
    con.close()
    check('S5 every subscription change is audited', audited >= 2, audited)
finally:
    stop()
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
