#!/usr/bin/env python3
"""Stock ownership schema tests (Contracting edition, phase 1).

A contracting store holds company material and subcontractor-owned material side
by side. `batches.supplier_*` answers "who delivered it"; these columns answer
"whose is it while we hold it" — a different question, and the one that has to be
answered at site closeout.

Requirements this pins (docs/CONTRACTING-EDITION-REQUIREMENTS.md):

 - Ownership never transfers. Leftover material returns to the subcontractor on
   a separate project-management approval, under its OWN movement type, so a
   return can never be read as consumption.
 - A subcontractor may supply materials only, or materials plus execution. Both
   post IDENTICALLY; the difference is presentational. So this is one attribute,
   never a second transaction path.
 - Issues must be attributable to the subcontractor who requested them.

The migration must be a NO-OP for any existing deployment: every pre-existing
batch becomes COMPANY-owned by default, so nothing about a live install changes.
That is the property most worth protecting here, and it is tested first.

Runs offline against a temporary migrated database; needs no server.
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


def columns(con, table):
    return {r[1] for r in con.execute(f'PRAGMA table_info({table})')}


work = tempfile.mkdtemp(prefix='wms-ownership-test-')
try:
    db_path = os.path.join(work, 'wms.db')
    env = {**os.environ, 'DB_PATH': db_path, 'NODE_ENV': 'test', 'SKIP_AUTO_SEED': '1'}
    r = subprocess.run(['node', os.path.join(REPO, 'server', 'db', 'migrate.js')],
                       cwd=REPO, capture_output=True, text=True, env=env)
    check('O0 migrations apply cleanly', r.returncode == 0, r.stderr[-400:])

    # Seed gives us demo batches and subcontractors to assert the default over.
    rs = subprocess.run(['node', os.path.join(REPO, 'server', 'db', 'seed.js')],
                        cwd=REPO, capture_output=True, text=True, env=env)
    check('O0 seed applies cleanly', rs.returncode == 0, rs.stderr[-400:])

    con = sqlite3.connect(db_path)

    # ===== 1. The migration is a no-op for existing data =====
    # If this section fails, upgrading a live contracting or manufacturing
    # deployment would change what its stock means.
    batch_cols = columns(con, 'batches')
    check('O1 batches gains owner_type', 'owner_type' in batch_cols, sorted(batch_cols))
    check('O1 batches gains owner_subcontractor_id',
          'owner_subcontractor_id' in batch_cols, sorted(batch_cols))

    total = con.execute('SELECT COUNT(*) FROM batches').fetchone()[0]
    company = con.execute("SELECT COUNT(*) FROM batches WHERE owner_type='COMPANY'").fetchone()[0]
    check('O1 there are batches to check', total > 0, total)
    check('O1 EVERY pre-existing batch defaults to COMPANY', company == total,
          f'{company} of {total} — a non-COMPANY default would reinterpret live stock')
    unowned = con.execute(
        'SELECT COUNT(*) FROM batches WHERE owner_subcontractor_id IS NOT NULL').fetchone()[0]
    check('O1 no batch is attributed to a subcontractor by the migration',
          unowned == 0, unowned)

    # supplier_* must survive: "who delivered it" is still a real, separate fact.
    check('O1 supplier_code is untouched', 'supplier_code' in batch_cols)
    check('O1 supplier_name is untouched', 'supplier_name' in batch_cols)

    # ===== 2. Engagement type — one attribute, not a second posting path =====
    subc_cols = columns(con, 'subcontractors')
    check('O2 subcontractors gains engagement_type', 'engagement_type' in subc_cols,
          sorted(subc_cols))

    con.execute("INSERT INTO subcontractors (name, is_active) VALUES ('Supply Only Co', 1)")
    con.commit()
    default_engagement = con.execute(
        "SELECT engagement_type FROM subcontractors WHERE name='Supply Only Co'").fetchone()[0]
    check('O2 a new subcontractor defaults to SUPPLY_ONLY',
          default_engagement == 'SUPPLY_ONLY', default_engagement)

    con.execute("""INSERT INTO subcontractors (name, is_active, engagement_type)
                   VALUES ('Supply And Execute Co', 1, 'SUPPLY_AND_EXECUTE')""")
    con.commit()
    both = con.execute(
        'SELECT COUNT(DISTINCT engagement_type) FROM subcontractors').fetchone()[0]
    check('O2 both engagement types can coexist', both == 2, both)

    # ===== 3. Issues are attributable =====
    cons_cols = columns(con, 'subcontractor_consumptions')
    check('O3 subcontractor_consumptions gains subcontractor_id',
          'subcontractor_id' in cons_cols, sorted(cons_cols))
    # Pre-existing rows stay NULL on purpose: the attribution was never recorded,
    # and inventing one would be worse than an honest gap.
    check('O3 attribution is nullable (historic rows stay honestly unattributed)',
          all(r[3] == 0 for r in con.execute('PRAGMA table_info(subcontractor_consumptions)')
              if r[1] == 'subcontractor_id'))

    # ===== 4. Return movement type — a return is never consumption =====
    ret = con.execute(
        "SELECT code, description, direction FROM movement_types WHERE code='542'").fetchone()
    check('O4 return movement type exists', ret is not None)
    check('O4 return is an ISSUE (it leaves inventory)', ret and ret[2] == 'ISSUE', ret)
    check('O4 return is distinguishable from consumption',
          ret and 'Return' in ret[1] and ret[0] != '221',
          'a return under the ordinary issue code could not be told apart later')

    issue_codes = {r[0] for r in con.execute(
        "SELECT code FROM movement_types WHERE direction='ISSUE'")}
    check('O4 ordinary project issue still exists separately',
          '221' in issue_codes and '542' in issue_codes, sorted(issue_codes))

    # ===== 5. Ownership can actually be recorded =====
    sub_id = con.execute(
        "SELECT id FROM subcontractors WHERE name='Supply And Execute Co'").fetchone()[0]
    batch_id = con.execute('SELECT id FROM batches LIMIT 1').fetchone()[0]
    con.execute("""UPDATE batches
                   SET owner_type='SUBCONTRACTOR', owner_subcontractor_id=?
                   WHERE id=?""", (sub_id, batch_id))
    con.commit()
    owned = con.execute(
        'SELECT owner_type, owner_subcontractor_id FROM batches WHERE id=?',
        (batch_id,)).fetchone()
    check('O5 a batch can be marked subcontractor-owned',
          owned == ('SUBCONTRACTOR', sub_id), owned)

    # The rest of the store is unaffected — ownership is per batch, and company
    # stock does not become custody stock because one batch did.
    still_company = con.execute(
        "SELECT COUNT(*) FROM batches WHERE owner_type='COMPANY'").fetchone()[0]
    check('O5 other batches stay company-owned', still_company == total - 1,
          f'{still_company} vs expected {total - 1}')

    con.close()

finally:
    shutil.rmtree(work, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
