#!/usr/bin/env python3
"""Converging the legacy subcontractor ledger into owned stock.

Two ledgers describe one physical store. The legacy stream is keyed on free text
and never writes batches or movements, so material in it gets none of FIFO, bins,
QR, expiry, reorder alerts or a single physical count. Phase 1 gave real stock an
owner; this is what carries the existing rows across instead of stranding them.

Three things make it harder than it looks, and the tool must refuse to paper over
any of them. This pins all three:

 1. The legacy line has no material_id, and guessing which material a free-text
    description means is how a stock file gets corrupted — a wrong match is
    invisible afterwards, because the quantity looks right against the wrong
    item. Only an EXACT match is ever proposed; anything else demands a reviewed
    mapping.
 2. On-hand is POOLED across subcontractors. When two delivered the same
    description to the same site, the data does not say whose the remainder is,
    so the line is reported undecidable rather than assigned to whoever sorts
    first.
 3. On-hand is derived, so there is no row to stamp as done. Running twice must
    NOT double the site's stock — that is the failure the convergence table
    exists to make impossible, and the assertion this test cares most about.

Runs entirely offline against a throwaway database.
"""
import json, os, sqlite3, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, 'scripts', 'converge-subcontractor-ledger.js')
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
    return subprocess.run(['node', SCRIPT, '--db', db_path, *args],
                          cwd=ROOT, capture_output=True, text=True)


tmp = tempfile.mkdtemp(prefix='wms-converge-')
db_path = os.path.join(tmp, 'conv.db')
env = dict(os.environ, DB_PATH=db_path, NODE_ENV='test', SKIP_AUTO_SEED='1')
r = subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env, capture_output=True, text=True)
if r.returncode != 0:
    print(r.stdout, r.stderr); sys.exit(1)
subprocess.run(['node', 'server/db/seed.js'], cwd=ROOT, env=env, capture_output=True, text=True)

con = sqlite3.connect(db_path)
wh = con.execute('SELECT warehouse_code FROM warehouses LIMIT 1').fetchone()[0]
mat = con.execute('SELECT id, item_code, description FROM materials LIMIT 1').fetchone()
material_id, item_code, material_desc = mat

# Two subcontractors, and a legacy ledger built through its own tables.
con.execute("INSERT INTO subcontractors (name, trade_category) VALUES ('Legacy Alpha','Civil')")
con.execute("INSERT INTO subcontractors (name, trade_category) VALUES ('Legacy Beta','Civil')")
alpha = con.execute("SELECT id FROM subcontractors WHERE name='Legacy Alpha'").fetchone()[0]
beta = con.execute("SELECT id FROM subcontractors WHERE name='Legacy Beta'").fetchone()[0]


def legacy_line(subcontractor_id, description, delivered, received, consumed=0.0):
    """One delivery -> inspection -> receipt -> optional consumption."""
    con.execute("INSERT INTO subcontractor_deliveries (warehouse_code, subcontractor_id, status) VALUES (?,?, 'Received')",
                (wh, subcontractor_id))
    did = con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute("""INSERT INTO subcontractor_delivery_lines
                   (delivery_id, line_number, description, uom, quantity_delivered, quality_status, quantity_approved)
                   VALUES (?,1,?, 'EA', ?, 'Approved', ?)""", (did, description, delivered, received))
    lid = con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute("INSERT INTO subcontractor_receipts (warehouse_code) VALUES (?)", (wh,))
    rid = con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute("INSERT INTO subcontractor_receipt_lines (receipt_id, delivery_line_id, quantity_received) VALUES (?,?,?)",
                (rid, lid, received))
    if consumed:
        con.execute("""INSERT INTO subcontractor_consumptions
                       (warehouse_code, description, uom, quantity_issued) VALUES (?,?, 'EA', ?)""",
                    (wh, description, consumed))


# 1. Exactly matches a material by description, one owner, stock remaining.
legacy_line(alpha, material_desc, 100, 100, 40)          # 60 on hand
# 2. No material match at all.
legacy_line(alpha, 'Scaffold coupler 48mm', 500, 500, 0)  # 500 on hand, unmatched
# 3. Two subcontractors, same description — ownership undecidable.
legacy_line(alpha, 'Shared sand pile', 50, 50, 0)
legacy_line(beta, 'Shared sand pile', 30, 30, 0)
# 4. Fully consumed — nothing left to carry across.
legacy_line(alpha, 'Fully used cement', 20, 20, 20)
con.commit()
con.close()

# ===== 1. The report, read-only =====
r = run(db_path)
check('C1 the report runs', r.returncode == 0, r.stderr)
out = r.stdout
check('C1 it is a dry run by default', 'DRY RUN' in out and 'nothing was written' in out, out)

check('C1 an exact material match is READY', 'READY to convert' in out, out)
check('C1 naming the material it matched', item_code in out, out)
check('C1 an unmatched description demands a mapping',
      'NEEDS A MAPPING' in out and 'Scaffold coupler' in out, out)
check('C1 it says why — no exact match', 'no exact material match' in out, out)
check('C1 a pooled line is undecidable, not guessed',
      'UNDECIDABLE' in out and 'Shared sand pile' in out, out)
check('C1 explaining the data does not say whose it is',
      'does not say whose' in out, out)
check('C1 a fully consumed line has nothing to move',
      'NOTHING TO MOVE' in out and 'Fully used cement' in out, out)

con = sqlite3.connect(db_path)
check('C1 no batch was created by the report',
      con.execute("SELECT COUNT(*) FROM batches WHERE owner_type='SUBCONTRACTOR'").fetchone()[0] == 0)
con.close()

# ===== 2. The starter mapping file =====
map_path = os.path.join(tmp, 'map.json')
r = run(db_path, '--write-mapping', map_path)
check('C2 a starter mapping is written', os.path.exists(map_path), r.stdout)
starter = json.load(open(map_path))
check('C2 it lists the lines that need a decision',
      set(starter) == {f'{wh}|Scaffold coupler 48mm||EA', f'{wh}|Shared sand pile||EA'},
      starter)
check('C2 with every value blank, so nothing is decided for the operator',
      all(v is None for v in starter.values()), starter)

# ===== 3. Applying =====
r = run(db_path, '--apply')
check('C3 applying converts the ready line', r.returncode == 0, r.stderr)
check('C3 and reports how many', 'Converted 1 legacy line' in r.stdout, r.stdout)

con = sqlite3.connect(db_path)
batches = con.execute("""SELECT id, material_id, remaining_quantity, owner_type, owner_subcontractor_id, quality_status
                         FROM batches WHERE owner_type='SUBCONTRACTOR'""").fetchall()
check('C3 exactly one owned batch exists', len(batches) == 1, batches)
b = batches[0] if batches else None
check('C3 carrying the net on-hand, not the delivered quantity',
      b and abs(b[2] - 60) < 0.001, b)
check('C3 owned by the one subcontractor who delivered it',
      b and b[4] == alpha, b)
check('C3 against the matched material', b and b[1] == material_id, b)

# The legacy material arrived long ago. Booking it as received today would
# corrupt every consumption rate and reorder point computed from the ledger.
movements = con.execute("""SELECT COUNT(*) FROM stock_transactions
                           WHERE notes LIKE '%LEGACY%' OR notes LIKE '%CONV%'""").fetchone()[0]
check('C3 no inbound movement was invented for material received long ago',
      movements == 0, movements)

audited = con.execute("""SELECT COUNT(*) FROM audit_trail WHERE action='LEDGER_CONVERGED'""").fetchone()[0]
check('C3 the conversion is audited', audited == 1, audited)
con.close()

# ===== 4. The assertion that matters most: running twice must not double stock =====
r = run(db_path, '--apply')
check('C4 a second run succeeds', r.returncode == 0, r.stderr)
check('C4 and converts nothing more', 'Nothing is ready to convert' in r.stdout, r.stdout)

con = sqlite3.connect(db_path)
after = con.execute("""SELECT COUNT(*), COALESCE(SUM(remaining_quantity),0)
                       FROM batches WHERE owner_type='SUBCONTRACTOR'""").fetchone()
con.close()
check('C4 the site still has exactly one owned batch', after[0] == 1, after)
check('C4 and exactly the same quantity — stock was not doubled',
      abs(after[1] - 60) < 0.001, after)

r = run(db_path)
check('C4 the report now shows it as already converged', 'ALREADY CONVERGED' in r.stdout, r.stdout)

# ===== 5. A reviewed mapping converts what could not be matched =====
json.dump({f'{wh}|Scaffold coupler 48mm||EA': material_id,
           f'{wh}|Shared sand pile||EA': 'SKIP'}, open(map_path, 'w'))
r = run(db_path, '--mapping', map_path, '--apply')
check('C5 a mapped line converts', r.returncode == 0 and 'Converted 1 legacy line' in r.stdout, r.stdout)

con = sqlite3.connect(db_path)
total = con.execute("SELECT COUNT(*) FROM batches WHERE owner_type='SUBCONTRACTOR'").fetchone()[0]
skipped = con.execute("""SELECT COUNT(*) FROM subcontractor_ledger_convergence
                         WHERE description='Shared sand pile'""").fetchone()[0]
con.close()
check('C5 two owned batches now exist', total == 2, total)
check('C5 and a SKIPped line was genuinely left alone', skipped == 0, skipped)

# ===== 6. A pooled line needs its OWNER named, not just its material =====
# Mapping only the material must not silently pick one of the two contributors.
json.dump({f'{wh}|Shared sand pile||EA': material_id}, open(map_path, 'w'))
r = run(db_path, '--mapping', map_path, '--apply')
check('C6 a material-only mapping does not resolve a pooled line',
      r.returncode == 0 and 'Nothing is ready to convert' in r.stdout, r.stdout)
check('C6 and it says how to resolve it', 'subcontractor_id' in r.stdout, r.stdout)

# Naming the owner is the operator asserting what the data cannot: whose it is.
json.dump({f'{wh}|Shared sand pile||EA': {'material_id': material_id, 'subcontractor_id': beta}},
          open(map_path, 'w'))
r = run(db_path, '--mapping', map_path, '--apply')
check('C6 naming the owner resolves it',
      r.returncode == 0 and 'Converted 1 legacy line' in r.stdout, r.stdout)

con = sqlite3.connect(db_path)
pooled = con.execute(
    "SELECT owner_subcontractor_id, remaining_quantity FROM batches "
    "WHERE owner_type='SUBCONTRACTOR' ORDER BY id DESC LIMIT 1").fetchone()
con.close()
check('C6 assigned to the owner the operator named, not a guess',
      pooled and pooled[0] == beta, pooled)
check('C6 carrying the whole pooled quantity', pooled and abs(pooled[1] - 80) < 0.001, pooled)

# ===== 6b. A mapping pointing at nothing writes nothing =====
con = sqlite3.connect(db_path)
before = con.execute("SELECT COUNT(*) FROM batches WHERE owner_type='SUBCONTRACTOR'").fetchone()[0]
con.close()
json.dump({f'{wh}|Fully used cement||EA': 999999}, open(map_path, 'w'))
r = run(db_path, '--mapping', map_path, '--apply')
check('C6b a mapping to a missing material converts nothing',
      'Converted' not in r.stdout or r.returncode != 0, r.stdout)
con = sqlite3.connect(db_path)
check('C6b and nothing was written',
      con.execute("SELECT COUNT(*) FROM batches WHERE owner_type='SUBCONTRACTOR'").fetchone()[0] == before)
con.close()

# ===== 7. An empty legacy ledger is a no-op, not an error =====
clean = os.path.join(tmp, 'clean.db')
env2 = dict(os.environ, DB_PATH=clean, NODE_ENV='test', SKIP_AUTO_SEED='1')
subprocess.run(['node', 'server/db/migrate.js'], cwd=ROOT, env=env2, capture_output=True, text=True)
r = run(clean, '--apply')
check('C7 an empty legacy ledger is a clean no-op',
      r.returncode == 0 and 'Nothing in the legacy subcontractor ledger' in r.stdout, r.stdout)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
