#!/usr/bin/env python3
"""Tenant provisioning regression tests.

The product is sold as Contracting and Manufacturing editions from ONE codebase,
so standing up a new tenant must be a repeatable, safe operation — unlike
production initialization (server/services/reset.js), which wipes a live
database and is permanently locked after one use (INC-2026-07-25-01).

The invariant that makes provisioning safe is that it REFUSES to run when the
target database already exists. These tests exist so that invariant cannot be
weakened by a later change without a test failing:

 1. A fresh tenant gets baseline config (roles/permissions/movement types) and
    ZERO demo data.
 2. The well-known seed admin (admin@example.com / Admin@123456) never survives.
 3. Provisioning refuses an existing database — including the live one.
 4. Invalid input is rejected before anything is written to disk.

Runs entirely offline against temporary databases; needs no server.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(REPO, 'scripts', 'provision-tenant.js')
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


def provision(db_path, name="Test Tenant", profile="contracting",
              email="ops@tenant.example", extra=None):
    cmd = ['node', SCRIPT, '--db', db_path, '--name', name,
           '--profile', profile, '--admin-email', email]
    if extra:
        cmd += extra
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)


def count(db_path, table):
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        return con.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    finally:
        con.close()


work = tempfile.mkdtemp(prefix='wms-provision-test-')
try:
    # ===== 1. A fresh tenant is usable and clean =====
    tenant = os.path.join(work, 'acme', 'wms.db')
    r = provision(tenant, name="Acme Contracting")
    check('P1 provisioning succeeds', r.returncode == 0, r.stderr[-400:])
    check('P1 database file created', os.path.exists(tenant))

    # Baseline the application cannot run without.
    check('P1 roles seeded', count(tenant, 'roles') > 0)
    check('P1 permissions seeded', count(tenant, 'permissions') > 0)
    check('P1 role_permissions seeded', count(tenant, 'role_permissions') > 0)
    check('P1 movement types seeded', count(tenant, 'movement_types') > 0)
    check('P1 reference data seeded', count(tenant, 'reference_data') > 0)

    # Demo data must NOT reach a customer's live tenant.
    for table in ('materials', 'warehouses', 'bin_locations', 'batches',
                  'material_request_headers', 'stock_transactions'):
        check(f'P1 no demo {table}', count(tenant, table) == 0, count(tenant, table))

    # ===== 2. The well-known seed admin never survives =====
    con = sqlite3.connect(f'file:{tenant}?mode=ro', uri=True)
    users = con.execute('SELECT email, status, must_change_password FROM users').fetchall()
    con.close()
    check('P2 exactly one admin account', len(users) == 1, users)
    check('P2 seed admin removed',
          not any(u[0].endswith('@example.com') for u in users), users)
    check('P2 tenant admin is the provisioned address',
          users and users[0][0] == 'ops@tenant.example', users)
    check('P2 admin must change password on first login',
          users and users[0][2] == 1, users)
    # The generated password is shown once on stdout and never persisted.
    check('P2 password printed once for the operator', 'Admin password' in r.stdout)
    check('P2 password is not the known seed default',
          'Admin@123456' not in r.stdout, 'seed default leaked into a tenant')

    # ===== 3. Tenant identity and edition are recorded =====
    con = sqlite3.connect(f'file:{tenant}?mode=ro', uri=True)
    row = con.execute('SELECT tenant_name, industry_profile FROM tenant_profile').fetchone()
    audited = con.execute(
        "SELECT COUNT(*) FROM audit_trail WHERE entity_type='Tenant' AND action='PROVISIONED'"
    ).fetchone()[0]
    con.close()
    check('P3 tenant name recorded', row and row[0] == 'Acme Contracting', row)
    check('P3 industry profile recorded', row and row[1] == 'contracting', row)
    check('P3 provisioning is audited', audited == 1, audited)

    # ===== 4. THE SAFETY INVARIANT: never touch an existing database =====
    # This is what separates provisioning from the locked reset path. If this
    # test ever fails, the script has become capable of destroying data.
    before = count(tenant, 'roles')
    r2 = provision(tenant, name="Hijack Attempt")
    check('P4 refuses an existing database', r2.returncode != 0, r2.stdout[-300:])
    check('P4 refusal is explained', 'already exists' in (r2.stdout + r2.stderr))
    check('P4 existing tenant is untouched', count(tenant, 'roles') == before)

    # The live production database must be refused for the same reason.
    live = os.path.join(REPO, 'data', 'wms.db')
    if os.path.exists(live):
        live_users = count(live, 'users')
        r3 = provision(live, name="Hijack Live")
        check('P4 refuses the live database', r3.returncode != 0, r3.stdout[-300:])
        check('P4 live database untouched', count(live, 'users') == live_users)

    # A stale -wal sidecar still represents real data, so it must also block.
    sidecar = os.path.join(work, 'sidecar', 'wms.db')
    os.makedirs(os.path.dirname(sidecar), exist_ok=True)
    open(sidecar + '-wal', 'w').close()
    r4 = provision(sidecar)
    check('P4 refuses when only a -wal sidecar exists', r4.returncode != 0, r4.stdout[-200:])
    check('P4 no database created behind a sidecar', not os.path.exists(sidecar))

    # ===== 5. Bad input is rejected before anything is written =====
    for label, kwargs in (
        ('unknown industry profile', dict(profile='nonexistent')),
        ('invalid admin email', dict(email='not-an-email')),
    ):
        target = os.path.join(work, 'rejected', 'wms.db')
        rr = provision(target, **kwargs)
        check(f'P5 rejects {label}', rr.returncode != 0, rr.stdout[-200:])
        check(f'P5 writes nothing on {label}', not os.path.exists(target))

    # ===== 6. Both editions provision from the same codebase =====
    factory = os.path.join(work, 'plant', 'wms.db')
    rm = provision(factory, name="Plant Co", profile="manufacturing")
    check('P6 manufacturing edition provisions', rm.returncode == 0, rm.stderr[-300:])
    con = sqlite3.connect(f'file:{factory}?mode=ro', uri=True)
    prof = con.execute('SELECT industry_profile FROM tenant_profile').fetchone()
    con.close()
    check('P6 manufacturing profile recorded', prof and prof[0] == 'manufacturing', prof)
    check('P6 same schema as contracting edition',
          count(factory, 'permissions') == count(tenant, 'permissions'),
          'editions must stay schema-identical — one codebase, not a fork')

    # ===== 7. Docker-native deployment artifacts =====
    # Production runs container-per-tenant behind a shared Caddy proxy, so a
    # tenant is a running container, not just a database file.
    droot = os.path.join(work, 'tenants')
    r7 = subprocess.run(
        ['node', os.path.join(REPO, 'scripts', 'provision-tenant.js'),
         '--name', 'Acme Contracting', '--profile', 'contracting',
         '--admin-email', 'ops@acme.example', '--domain', 'acme.wms.example',
         '--tenants-root', droot],
        cwd=REPO, capture_output=True, text=True)
    check('P7 provisions with deployment artifacts', r7.returncode == 0, r7.stderr[-400:])

    tdir = os.path.join(droot, 'acme-contracting')
    check('P7 slug derived from tenant name', os.path.isdir(tdir), os.listdir(droot) if os.path.isdir(droot) else 'missing')
    for rel in ('data/wms.db', 'docker-compose.yml', '.env'):
        check(f'P7 creates {rel}', os.path.exists(os.path.join(tdir, rel)))
    check('P7 creates backups directory', os.path.isdir(os.path.join(tdir, 'backups')))

    # The secret file must not be world-readable: it signs that tenant sessions.
    mode = oct(os.stat(os.path.join(tdir, '.env')).st_mode & 0o777)
    check('P7 secret file is chmod 600', mode == '0o600', mode)

    compose = open(os.path.join(tdir, 'docker-compose.yml')).read()
    check('P7 container name is tenant-scoped', 'container_name: wms-acme-contracting' in compose)
    check('P7 joins the shared proxy network', 'external: true' in compose and 'web' in compose)
    check('P7 publishes NO host port (no collisions, proxy-only reach)',
          'ports:' not in compose, 'a published port would collide between tenants')
    check('P7 keeps the production safety flags',
          all(f in compose for f in ('SKIP_AUTO_SEED: "1"', 'ALLOW_AUTO_SEED: "0"',
                                     'PRODUCTION_INITIALIZATION_ENABLED: "false"')), compose)
    check('P7 pins one shared image tag (one build, many tenants)',
          'image: wms-app:latest' in compose)
    check('P7 prints the Caddy block for the domain',
          'acme.wms.example' in r7.stdout and 'reverse_proxy wms-acme-contracting:3000' in r7.stdout,
          r7.stdout[-300:])

    # ===== 8. Per-tenant JWT secret — the isolation the model depends on =====
    # Every tenant runs the same image against its own database, and a token's
    # `sub` is resolved against whichever database the process points at. A
    # shared secret would let a token minted at tenant A log its bearer in as
    # tenant B's user of the same id. Nothing in the app code would be wrong;
    # isolation rests entirely on these values differing.
    r8 = subprocess.run(
        ['node', os.path.join(REPO, 'scripts', 'provision-tenant.js'),
         '--name', 'Beta Builders', '--profile', 'contracting',
         '--admin-email', 'ops@beta.example', '--tenants-root', droot],
        cwd=REPO, capture_output=True, text=True)
    check('P8 second tenant provisions', r8.returncode == 0, r8.stderr[-300:])

    def secret_of(slug):
        for line in open(os.path.join(droot, slug, '.env')):
            if line.startswith('JWT_SECRET='):
                return line.split('=', 1)[1].strip()
        return None

    a, b = secret_of('acme-contracting'), secret_of('beta-builders')
    check('P8 both tenants got a secret', bool(a) and bool(b))
    check('P8 secrets DIFFER between tenants', a != b,
          'a shared secret is cross-tenant account takeover')
    check('P8 secret has real entropy (>= 64 hex chars)', a and len(a) >= 64, len(a or ''))

    # ===== 9. --db still provisions a bare database, no artifacts =====
    bare = os.path.join(work, 'bare', 'wms.db')
    r9 = provision(bare, name='Sandbox')
    check('P9 --db still works', r9.returncode == 0, r9.stderr[-300:])
    check('P9 --db creates the database', os.path.exists(bare))
    check('P9 --db writes no compose file',
          not os.path.exists(os.path.join(os.path.dirname(bare), 'docker-compose.yml')))
    check('P9 --db writes no secret file',
          not os.path.exists(os.path.join(os.path.dirname(bare), '.env')))

finally:
    shutil.rmtree(work, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
