#!/usr/bin/env python3
"""Auto-seed guard (INC-2026-07-25-01 / issue #40).

Auto-seeding writes demo data AND a default administrator. On an established
deployment an empty users table means data loss or a mispointed DB_PATH, so
seeding would seal over the void and reset the admin to a known default.

The previous guard was opt-OUT and keyed on NODE_ENV, so it failed OPEN: a real
deployment whose runtime did not export NODE_ENV would silently seed. These
tests pin the policy as opt-IN — absence of configuration must mean "refuse".

Part A asserts the policy truth table directly. Part B proves it end to end by
booting the real server against a throwaway database.

Needs no shared server or dataset; runs in Phase 1.
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []


def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)


def node(script, env=None, args=()):
    e = dict(os.environ); e.update(env or {})
    return subprocess.run(['node', '-e', script, *args], cwd=ROOT,
                          capture_output=True, text=True, env=e)


# ===== Part A: policy truth table =====================================
POLICY = (
    "const {shouldAutoSeed} = require('./server/services/firstRunSeed');"
    "console.log(JSON.stringify(shouldAutoSeed(JSON.parse(process.argv[1]))));"
)

def policy(env_map):
    r = node(POLICY, args=[json.dumps(env_map)])
    if r.returncode != 0:
        return {'allowed': None, 'reason': r.stderr[:200]}
    return json.loads(r.stdout.strip())


# The regression that matters: an unset environment must NOT seed.
check('empty environment refuses auto-seed', policy({})['allowed'] is False)

# The exact production shape that previously failed open.
check('NODE_ENV unset + no opt-in refuses',
      policy({'DB_PATH': '/srv/wms/data/wms.db'})['allowed'] is False)
check('NODE_ENV=development refuses (old guard would have seeded)',
      policy({'NODE_ENV': 'development'})['allowed'] is False)
check('NODE_ENV=production refuses without opt-in',
      policy({'NODE_ENV': 'production'})['allowed'] is False)

# Explicit opt-in is the only way through.
check('ALLOW_AUTO_SEED=1 permits auto-seed',
      policy({'ALLOW_AUTO_SEED': '1'})['allowed'] is True)
check('ALLOW_AUTO_SEED=1 permits even in production',
      policy({'NODE_ENV': 'production', 'ALLOW_AUTO_SEED': '1'})['allowed'] is True)

# Kill switch outranks the opt-in.
check('SKIP_AUTO_SEED=1 overrides ALLOW_AUTO_SEED=1',
      policy({'ALLOW_AUTO_SEED': '1', 'SKIP_AUTO_SEED': '1'})['allowed'] is False)
check('production invariants (SKIP=1, ALLOW=0) refuse',
      policy({'NODE_ENV': 'production', 'SKIP_AUTO_SEED': '1',
              'ALLOW_AUTO_SEED': '0'})['allowed'] is False)

# Near-miss values must not be treated as truthy opt-in.
for val in ('true', 'yes', 'TRUE', '2', ''):
    check(f'ALLOW_AUTO_SEED={val!r} is not an opt-in',
          policy({'ALLOW_AUTO_SEED': val})['allowed'] is False)

# The refusal reason must be loggable and non-empty (it goes to operators).
check('refusal carries a reason', bool(policy({})['reason']))


# ===== Part B: end-to-end against a throwaway database =================
COUNT = (
    "const D=require('better-sqlite3');"
    "const d=new D(process.argv[1],{readonly:true});"
    "let n=0; try{n=d.prepare('SELECT COUNT(*) n FROM users').get().n;}catch(e){}"
    "console.log(n);"
)

def users_in(db_path):
    r = node(COUNT, args=[db_path])
    return int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else -1


def boot(db_path, extra_env, port):
    """Start the real server against db_path; return users count after boot."""
    env = dict(os.environ)
    env.update({'DB_PATH': db_path, 'PORT': str(port), 'SCHEDULER_ENABLED': '0'})
    env.pop('NODE_ENV', None)
    env.pop('ALLOW_AUTO_SEED', None)
    env.pop('SKIP_AUTO_SEED', None)
    env.update(extra_env)
    proc = subprocess.Popen(['node', 'index.js'], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(60):
            if proc.poll() is not None:
                break
            try:
                urllib.request.urlopen(f'http://localhost:{port}/healthz', timeout=1).read()
                break
            except Exception:
                time.sleep(0.5)
        time.sleep(0.5)  # let any seed finish writing
        return users_in(db_path)
    finally:
        proc.kill()
        proc.wait(timeout=10)


workdir = tempfile.mkdtemp(prefix='wms-autoseed-test-')
try:
    # A migrated but userless database — exactly the INC-2026-07-25-01 shape.
    empty_db = os.path.join(workdir, 'empty', 'wms.db')
    os.makedirs(os.path.dirname(empty_db), exist_ok=True)
    r = subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, capture_output=True,
                       text=True, env={**os.environ, 'DB_PATH': empty_db})
    check('throwaway database migrates', r.returncode == 0, r.stderr[:300])
    check('throwaway database starts with zero users', users_in(empty_db) == 0)

    # The incident condition: no NODE_ENV, no opt-in, empty DB. Must NOT seed.
    check('server does NOT seed an empty DB with no opt-in',
          boot(empty_db, {}, 3997) == 0)

    # Same, but explicitly non-production — the case the old guard seeded.
    check('server does NOT seed an empty DB when NODE_ENV=development',
          boot(empty_db, {'NODE_ENV': 'development'}, 3998) == 0)

    # Deliberate opt-in still works, so genuine first installs are not broken.
    seed_db = os.path.join(workdir, 'seeded', 'wms.db')
    os.makedirs(os.path.dirname(seed_db), exist_ok=True)
    subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, capture_output=True,
                   text=True, env={**os.environ, 'DB_PATH': seed_db})
    check('server DOES seed when ALLOW_AUTO_SEED=1',
          boot(seed_db, {'ALLOW_AUTO_SEED': '1'}, 3999) > 0)
finally:
    shutil.rmtree(workdir, ignore_errors=True)

print(f"\n{passed} passed, {failed} failed")
if fails:
    print("Failed:", ", ".join(fails))
sys.exit(1 if failed else 0)
