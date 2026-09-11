#!/usr/bin/env python3
"""Switching the industry edition of an EXISTING install.

provision-tenant.js writes the edition for a brand-new tenant and refuses to
touch a database that already exists — correctly, since it also creates an
administrator and strips the demo data. That left no way to put a RUNNING
customer onto an edition, so the Contracting edition could be sold to new
tenants only, never to the company already using the system.

Changing an edition is not provisioning. Nothing is created or destroyed; one
row decides which modules exist. The danger is the opposite of data loss and
much easier to miss: setting an edition switches screens OFF, silently, for
people who used them yesterday. Nobody finds out until a storekeeper cannot post
a goods issue.

What this pins:

 1. Dry run is the DEFAULT. A command that changes what a warehouse can see must
    not do it because someone pressed enter.
 2. The dry run states the blast radius — which modules disappear and how many
    active users hold each permission today. That is the number that makes the
    decision informed rather than blind.
 3. Applying writes the row and audits the before and after.
 4. Permissions are never revoked, so clearing the edition restores every
    module. That is what makes the change reversible rather than destructive.
 5. Clearing returns the install to unrestricted — the rollback.

Runs entirely offline against throwaway databases. Never touches a server.
"""
import json, os, sqlite3, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, 'scripts', 'set-tenant-profile.js')
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


def run(db_path, *args):
    return subprocess.run(
        ['node', SCRIPT, '--db', db_path, *args],
        cwd=ROOT, capture_output=True, text=True)


def migrated_db(tmp):
    """A schema-identical database built by the project's own migrations."""
    path = os.path.join(tmp, 'edition.db')
    env = dict(os.environ, DB_PATH=path, NODE_ENV='test', SKIP_AUTO_SEED='1')
    r = subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        sys.exit(1)
    subprocess.run(['node', 'server/db/seed.js'], cwd=ROOT, env=env,
                   capture_output=True, text=True)
    return path


def profile_row(path):
    con = sqlite3.connect(path)
    row = con.execute('SELECT tenant_name, industry_profile FROM tenant_profile WHERE id=1').fetchone()
    con.close()
    return row


def role_permission_count(path):
    con = sqlite3.connect(path)
    n = con.execute('SELECT COUNT(*) FROM role_permissions').fetchone()[0]
    con.close()
    return n


tmp = tempfile.mkdtemp(prefix='wms-edition-')
db = migrated_db(tmp)

check('E0 the test database migrated', os.path.exists(db))
check('E0 it starts unrestricted, exactly like a pre-editions install',
      profile_row(db) is None, profile_row(db))
permissions_before = role_permission_count(db)
check('E0 it has role permissions to lose', permissions_before > 0, permissions_before)

# ===== 1. Dry run is the default =====
r = run(db, '--profile', 'contracting', '--tenant-name', 'Existing Customer')
check('E1 a dry run succeeds', r.returncode == 0, r.stderr)
check('E1 and says plainly that nothing was written',
      'DRY RUN' in r.stdout and 'nothing was written' in r.stdout, r.stdout)
check('E1 the row is genuinely still absent', profile_row(db) is None, profile_row(db))

# ===== 2. The dry run states the blast radius =====
check('E2 it names the modules that would be hidden',
      'will be HIDDEN' in r.stdout, r.stdout)
# Manufacturing-only modules must be among them, since the target is contracting.
check('E2 including a module this edition does not include',
      'movement_types_master' in r.stdout, r.stdout)
check('E2 it counts the users who hold each one today',
      'active non-admin user(s) hold this today' in r.stdout, r.stdout)
check('E2 and says permissions are not revoked, so it is reversible',
      'NOT revoked' in r.stdout and 'restores every one of them' in r.stdout, r.stdout)

# ===== 3. Validation before anything is written =====
r = run(db, '--profile', 'aerospace')
check('E3 an unknown edition is refused', r.returncode != 0, r.stdout)
check('E3 and the refusal lists the valid ones',
      'contracting' in (r.stdout + r.stderr) and 'manufacturing' in (r.stdout + r.stderr), r.stderr)

r = run(db, '--profile', 'contracting', '--apply')
check('E3 a name is required the first time an edition is set', r.returncode != 0, r.stdout)
check('E3 and nothing was written by the refusal', profile_row(db) is None, profile_row(db))

# ===== 4. Applying =====
r = run(db, '--profile', 'contracting', '--tenant-name', 'Existing Customer', '--apply', '--by', 'tester')
check('E4 applying succeeds', r.returncode == 0, r.stderr)
row = profile_row(db)
check('E4 the edition row is written', row is not None and row[1] == 'contracting', row)
check('E4 with the tenant name', row is not None and row[0] == 'Existing Customer', row)
check('E4 and it tells the operator a restart is needed',
      'restart' in r.stdout.lower(), r.stdout)

con = sqlite3.connect(db)
audit = con.execute("""SELECT old_value, new_value, changed_by_name FROM audit_trail
                       WHERE entity_type='Tenant' AND action='EDITION_CHANGED'
                       ORDER BY id DESC LIMIT 1""").fetchone()
con.close()
check('E4 the change is audited', audit is not None, audit)
check('E4 recording who made it', audit and audit[2] == 'tester', audit)
check('E4 and what the edition was before (unrestricted)',
      audit and json.loads(audit[0]) is None, audit)
check('E4 and which modules it hid',
      audit and 'movement_types_master' in (json.loads(audit[1]) or {}).get('modules_hidden', []), audit)

# ===== 5. Permissions are untouched — this is what makes it reversible =====
check('E5 not one role permission was revoked',
      role_permission_count(db) == permissions_before,
      (role_permission_count(db), permissions_before))

# ===== 6. Re-running the same edition changes nothing =====
r = run(db, '--profile', 'contracting', '--apply')
check('E6 setting the same edition again is a no-op',
      r.returncode == 0 and 'already on this edition' in r.stdout, r.stdout)

# ===== 7. Clearing is the rollback =====
r = run(db, '--profile', 'none')
check('E7 clearing dry-runs first too',
      r.returncode == 0 and 'DRY RUN' in r.stdout, r.stdout)
check('E7 and reports the modules that come back',
      'become visible' in r.stdout, r.stdout)
check('E7 with the row still in place', profile_row(db) is not None, profile_row(db))

r = run(db, '--profile', 'none', '--apply')
check('E7 clearing succeeds', r.returncode == 0, r.stderr)
check('E7 the row is gone — unrestricted again', profile_row(db) is None, profile_row(db))
check('E7 and every role permission survived the round trip',
      role_permission_count(db) == permissions_before,
      (role_permission_count(db), permissions_before))

# ===== 8. It refuses a database that is not there =====
r = run(os.path.join(tmp, 'nope.db'), '--profile', 'contracting')
check('E8 a missing database is refused', r.returncode != 0, r.stdout)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
