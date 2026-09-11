#!/usr/bin/env python3
"""Industry edition (tenant profile) regression tests.

Contracting and Manufacturing are sold as different editions from ONE codebase.
A tenant's edition decides which optional modules exist for that organisation;
permissions still decide what each user may open. The two gates are independent.

The rule that protects every install that predates editions:

    No tenant_profile row  ==  no edition restriction.

Migration 021 creates the table EMPTY, so an existing single-company deployment
keeps every module reachable. Defaulting an unconfigured install to some profile
would switch screens off on a live warehouse at the first restart after an
upgrade — an outage, not a licensing feature. These tests pin that direction.

Runs offline against temporary provisioned databases; needs no server.
"""
import os, shutil, sqlite3, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def provision(db_path, name, profile, email):
    return subprocess.run(
        ['node', os.path.join(REPO, 'scripts', 'provision-tenant.js'),
         '--db', db_path, '--name', name, '--profile', profile, '--admin-email', email],
        cwd=REPO, capture_output=True, text=True)


def tenant_ctx(db_path):
    """Read the runtime tenant context the server would compute for a database."""
    script = (
        "const t=require('./server/services/tenant');"
        "const c=t.getTenant();"
        "console.log(JSON.stringify({"
        "  ctx: c,"
        "  sub: t.tenantHasModule('subcontractor_admin'),"
        "  quality: t.tenantHasModule('quality'),"
        "  unknown: t.tenantHasModule('module_that_does_not_exist')"
        "}));"
    )
    env = dict(os.environ)
    if db_path:
        env['DB_PATH'] = db_path
    r = subprocess.run(['node', '-e', script], cwd=REPO, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise AssertionError(r.stderr[-500:])
    import json
    return json.loads(r.stdout)


work = tempfile.mkdtemp(prefix='wms-edition-test-')
try:
    # ===== 1. An install with no tenant_profile row is UNRESTRICTED =====
    # This is the safety direction. If this section ever fails, upgrading a live
    # single-company deployment would start hiding modules from it.
    plain = os.path.join(work, 'plain', 'wms.db')
    os.makedirs(os.path.dirname(plain), exist_ok=True)
    subprocess.run(['node', os.path.join(REPO, 'server', 'db', 'migrate.js')],
                   cwd=REPO, capture_output=True, text=True,
                   env={**os.environ, 'DB_PATH': plain, 'NODE_ENV': 'test', 'SKIP_AUTO_SEED': '1'})
    con = sqlite3.connect(f'file:{plain}?mode=ro', uri=True)
    has_table = con.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tenant_profile'").fetchone()[0]
    rows = con.execute('SELECT COUNT(*) FROM tenant_profile').fetchone()[0]
    con.close()
    check('E1 migration creates tenant_profile', has_table == 1)
    check('E1 migration leaves it EMPTY (no edition imposed)', rows == 0, rows)

    ctx = tenant_ctx(plain)
    check('E1 unconfigured install reports configured=false', ctx['ctx']['configured'] is False, ctx)
    check('E1 modules is null, meaning unrestricted', ctx['ctx']['modules'] is None, ctx)
    check('E1 subcontractor module allowed', ctx['sub'] is True)
    check('E1 quality module allowed', ctx['quality'] is True)
    check('E1 even an unknown module is allowed (no restriction at all)',
          ctx['unknown'] is True, 'an unconfigured install must never restrict')

    # ===== 2. Contracting edition: subcontractor custody, no quality module ====
    contracting = os.path.join(work, 'contracting', 'wms.db')
    r = provision(contracting, 'Acme Contracting', 'contracting', 'ops@acme.example')
    check('E2 contracting tenant provisions', r.returncode == 0, r.stderr[-300:])
    ctx = tenant_ctx(contracting)
    check('E2 reports configured=true', ctx['ctx']['configured'] is True, ctx)
    check('E2 profile is contracting', ctx['ctx']['profileKey'] == 'contracting', ctx)
    check('E2 tenant name carried through', ctx['ctx']['name'] == 'Acme Contracting', ctx)
    check('E2 subcontractor custody INCLUDED', ctx['sub'] is True,
          'subcontractor reconciliation is this edition differentiator')
    # Quality belongs to BOTH editions. A contractor confirmed that material
    # received from a subcontractor is inspected by the company against project
    # specifications and approved submittals — incoming inspection is not a
    # manufacturing-only concern, and an earlier split that assumed so was wrong.
    check('E2 quality module INCLUDED (incoming inspection against approvals)',
          ctx['quality'] is True, ctx)
    check('E2 unknown module refused once an edition is configured',
          ctx['unknown'] is False, ctx)

    # ===== 3. Manufacturing edition: the mirror image =====
    factory = os.path.join(work, 'factory', 'wms.db')
    r = provision(factory, 'Plant Co', 'manufacturing', 'ops@plant.example')
    check('E3 manufacturing tenant provisions', r.returncode == 0, r.stderr[-300:])
    ctx_f = tenant_ctx(factory)
    check('E3 profile is manufacturing', ctx_f['ctx']['profileKey'] == 'manufacturing', ctx_f)
    check('E3 quality module INCLUDED', ctx_f['quality'] is True, ctx_f)
    check('E3 subcontractor custody EXCLUDED', ctx_f['sub'] is False, ctx_f)

    # ===== 4. The editions are genuinely different, from one codebase =====
    con_mods = set(tenant_ctx(contracting)['ctx']['modules'])
    fac_mods = set(tenant_ctx(factory)['ctx']['modules'])
    check('E4 editions differ', con_mods != fac_mods)
    check('E4 both share the core workflow',
          {'create_request', 'approvals', 'picking', 'gi_posting'} <= (con_mods & fac_mods),
          con_mods & fac_mods)
    check('E4 contracting-only module is subcontractor custody',
          'subcontractor_admin' in (con_mods - fac_mods), con_mods - fac_mods)
    check('E4 quality is shared, not an edition differentiator',
          'quality' in (con_mods & fac_mods), 'both editions inspect incoming material')
    check('E4 manufacturing-only module is movement-type configuration',
          'movement_types_master' in (fac_mods - con_mods), fac_mods - con_mods)

    # ===== 5. A corrupt/unknown profile key degrades to unrestricted =====
    # A hand-edited row or a downgrade must not take the deployment down, and
    # must not silently restrict it either.
    broken = os.path.join(work, 'broken', 'wms.db')
    shutil.copytree(os.path.dirname(factory), os.path.dirname(broken))
    con = sqlite3.connect(broken)
    con.execute("UPDATE tenant_profile SET industry_profile='no_such_edition' WHERE id=1")
    con.commit()
    con.close()
    ctx_b = tenant_ctx(broken)
    check('E5 unknown profile does not crash', ctx_b['ctx'] is not None)
    check('E5 unknown profile falls back to unrestricted',
          ctx_b['ctx']['modules'] is None and ctx_b['sub'] is True,
          'a bad config row must fail open, never lock a warehouse out')
    check('E5 tenant name still reported for diagnosis',
          ctx_b['ctx']['name'] == 'Plant Co', ctx_b)

finally:
    shutil.rmtree(work, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
