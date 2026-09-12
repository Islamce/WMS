#!/usr/bin/env python3
"""Every CSV template's example row actually imports.

The import templates used to be a header row and nothing else. A customer
filling their first file had to guess what a valid value looked like — that
`direction` accepts four words and no others, that a bin location has a shape,
that dates have a format — and found out by failed upload.

Each template now carries one filled-in example row. That is only worth having
if it is true, so this test takes each example straight from the server's own
/api/import/meta and imports it. An example that does not import is worse than
no example: it teaches the customer the wrong format and blames them for it.

The entities are imported in dependency order, because a bin needs its
warehouse and stock needs both its material and its warehouse. If that order is
ever wrong the test fails on a foreign key, which is itself worth knowing.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
passed = failed = 0
fails = []

# Warehouses before bins; materials and warehouses before stock.
ORDER = ['materials', 'locations', 'warehouses', 'bins', 'movement-types', 'stock']


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print("PASS:", name)
    else:
        failed += 1
        fails.append(name)
        print("FAIL:", name, detail)


tmp = tempfile.mkdtemp(prefix='wms-importex-')
db = os.path.join(tmp, 'wms.db')
prov = subprocess.run(
    ['node', 'scripts/provision-tenant.js', '--name', 'Import Examples', '--slug', 'importex',
     '--profile', 'contracting', '--admin-email', 'ops@example.com', '--db', db],
    cwd=ROOT, capture_output=True, text=True)
password = next((l.split(':', 1)[1].strip() for l in prov.stdout.splitlines()
                 if 'password' in l.lower() and ':' in l), None)
check('a clean tenant is provisioned', prov.returncode == 0 and bool(password), prov.stderr[-300:])

port = 3431
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

    _, body = call('POST', '/api/auth/login', body={'email': 'ops@example.com', 'password': password})
    token = body['token']
    call('PATCH', '/api/auth/password', token,
         {'current_password': password, 'new_password': 'ImportEx!2026x'})
    _, body = call('POST', '/api/auth/login', body={'email': 'ops@example.com', 'password': 'ImportEx!2026x'})
    token = body['token']

    code, meta = call('GET', '/api/import/meta', token)
    entities = {e['key']: e for e in meta.get('entities', [])}
    check('the import metadata lists every entity', set(ORDER) <= set(entities), sorted(entities))
    check('and every one carries an example row',
          all(entities.get(k, {}).get('example') for k in ORDER),
          {k: bool(entities.get(k, {}).get('example')) for k in ORDER})

    for key in ORDER:
        ent = entities.get(key) or {}
        example = ent.get('example')
        if not example:
            continue
        # The example must only mention columns the importer declares; a stray
        # key means the example and the column list have drifted apart.
        stray = set(example) - set(ent['columns'])
        check(f'{key}: the example uses only declared columns', not stray, stray)

        code, result = call('POST', f'/api/import/{key}', token, {'rows': [example]})
        ok = code == 200 and result.get('errors', 1) == 0 and (result.get('created', 0) + result.get('updated', 0)) == 1
        check(f'{key}: the example row imports cleanly', ok, (code, result))

    # And the result is a tenant that actually holds what the examples describe.
    con = sqlite3.connect(db)
    rows = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
            for t in ('materials', 'warehouses', 'bin_locations', 'batches')}
    con.close()
    check('the imported examples left real rows behind',
          all(v >= 1 for v in rows.values()), rows)
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
