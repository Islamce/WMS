#!/usr/bin/env node
'use strict';

/**
 * Converge the legacy free-text subcontractor ledger into owned stock.
 *
 * Two ledgers describe one physical store. The legacy stream
 * (subcontractor_deliveries -> receipts -> consumptions) is keyed on a free-text
 * description and never touches `batches` or the movement ledger, so material in
 * it gets none of what this system is good at: FIFO, bins, QR, expiry, reorder
 * alerts, one physical count. Phase 1 added an owner to real stock; this is what
 * carries the existing rows across instead of stranding or discarding them.
 *
 * Three things make this harder than it looks, and the tool refuses to paper
 * over any of them:
 *
 * 1. The legacy line has no material_id. Guessing which material a free-text
 *    description means is how you corrupt a stock file. Only an exact match on
 *    item code or description is ever proposed, and every conversion needs an
 *    explicit mapping the operator reviewed.
 *
 * 2. On-hand is POOLED across subcontractors. If two of them delivered an
 *    identically-described item to the same site, the data genuinely does not
 *    say whose the remainder is. Those lines are reported as undecidable rather
 *    than assigned to whoever happens to sort first.
 *
 * 3. On-hand is derived (receipts minus consumptions), so there is no row to
 *    stamp as done. Conversion records itself in subcontractor_ledger_convergence
 *    in the same transaction as the batch, which is what stops a second run
 *    doubling the site's stock.
 *
 *   node scripts/converge-subcontractor-ledger.js --db /app/data/wms.db
 *   node scripts/converge-subcontractor-ledger.js --db ... --mapping map.json
 *   node scripts/converge-subcontractor-ledger.js --db ... --mapping map.json --apply
 *
 * The mapping file is { "<warehouse>|<description>|<category_id>|<uom>": <material_id> }
 * using the exact key the report prints. The report writes a starter file with
 * --write-mapping.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (key === 'apply') { args.apply = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const lineKey = (r) => `${r.warehouse_code}|${r.description}|${r.category_id === null ? '' : r.category_id}|${r.uom}`;

/**
 * Every legacy line with its net on-hand and who contributed to it.
 *
 * Deliberately the same grouping the /reconciliation endpoint uses, so the
 * numbers an operator sees on screen are the numbers this converts.
 */
function legacyLines(db) {
  return db.prepare(`
    WITH received AS (
      SELECT r.warehouse_code, dl.description, dl.category_id, dl.uom,
             SUM(rl.quantity_received) AS qty,
             COUNT(DISTINCT d.subcontractor_id) AS contributors,
             MIN(d.subcontractor_id) AS only_subcontractor
      FROM subcontractor_receipt_lines rl
      JOIN subcontractor_receipts r ON r.id = rl.receipt_id
      JOIN subcontractor_delivery_lines dl ON dl.id = rl.delivery_line_id
      JOIN subcontractor_deliveries d ON d.id = dl.delivery_id
      WHERE rl.quantity_received > 0
      GROUP BY r.warehouse_code, dl.description, dl.category_id, dl.uom
    ),
    consumed AS (
      SELECT warehouse_code, description, category_id, uom, SUM(quantity_issued) AS qty
      FROM subcontractor_consumptions
      GROUP BY warehouse_code, description, category_id, uom
    )
    SELECT rec.warehouse_code, rec.description, rec.category_id, rec.uom,
           rec.qty AS received, COALESCE(con.qty, 0) AS consumed,
           rec.qty - COALESCE(con.qty, 0) AS on_hand,
           rec.contributors, rec.only_subcontractor,
           (SELECT name FROM subcontractors WHERE id = rec.only_subcontractor) AS subcontractor_name,
           (SELECT c.id FROM subcontractor_ledger_convergence c
             WHERE c.warehouse_code = rec.warehouse_code AND c.description = rec.description
               AND COALESCE(c.category_id, -1) = COALESCE(rec.category_id, -1)
               AND c.uom = rec.uom) AS converged_id
    FROM received rec
    LEFT JOIN consumed con ON con.warehouse_code = rec.warehouse_code
      AND con.description = rec.description
      AND con.category_id IS rec.category_id AND con.uom = rec.uom
    ORDER BY rec.warehouse_code, rec.description
  `).all();
}

/**
 * An EXACT match only — on item code or on description, case-insensitively.
 * Fuzzy matching a description to a material is how a stock file gets corrupted,
 * and a wrong match here is invisible afterwards: the quantity looks right and
 * sits against the wrong item forever.
 */
function proposeMaterial(db, description) {
  return db.prepare(`
    SELECT id, item_code, description FROM materials
    WHERE LOWER(item_code) = LOWER(?) OR LOWER(description) = LOWER(?)
    LIMIT 2
  `).all(description, description);
}

function classify(db, row) {
  if (row.converged_id) return { state: 'CONVERGED', note: 'already converted' };
  if (row.on_hand <= 0.0001) return { state: 'NOTHING_TO_MOVE', note: 'fully consumed — history only' };
  if (row.contributors > 1) {
    return { state: 'UNDECIDABLE', note: `${row.contributors} subcontractors delivered this description here; the data does not say whose the remainder is` };
  }
  const matches = proposeMaterial(db, row.description);
  if (matches.length === 1) return { state: 'READY', note: `exact match: ${matches[0].item_code}`, materialId: matches[0].id };
  if (matches.length > 1) return { state: 'NEEDS_MAPPING', note: 'more than one material matches exactly' };
  return { state: 'NEEDS_MAPPING', note: 'no exact material match' };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { fail(e.message); }

  const dbPath = path.resolve(args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wms.db'));
  if (!fs.existsSync(dbPath)) fail(`No database at ${dbPath}.`);

  const db = new Database(dbPath);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='subcontractor_ledger_convergence'").get()) {
    fail('This database has not run migration 025. Apply migrations before converging.');
  }

  let mapping = {};
  if (args.mapping) {
    if (!fs.existsSync(args.mapping)) fail(`No mapping file at ${args.mapping}.`);
    try { mapping = JSON.parse(fs.readFileSync(args.mapping, 'utf8')); }
    catch (e) { fail(`Mapping file is not valid JSON: ${e.message}`); }
  }

  const rows = legacyLines(db);
  console.log('');
  console.log(`  Database    : ${dbPath}`);
  console.log(`  Legacy lines: ${rows.length}`);

  if (rows.length === 0) {
    console.log('\n  Nothing in the legacy subcontractor ledger. No conversion needed.\n');
    db.close();
    return;
  }

  const buckets = { READY: [], NEEDS_MAPPING: [], UNDECIDABLE: [], NOTHING_TO_MOVE: [], CONVERGED: [] };
  rows.forEach((row) => {
    const verdict = classify(db, row);
    const key = lineKey(row);
    const mapped = Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : undefined;
    if (mapped === 'SKIP') {
      buckets.NOTHING_TO_MOVE.push({ row, verdict: { state: 'NOTHING_TO_MOVE', note: 'skipped by the reviewed mapping' } });
      return;
    }
    // A mapping entry is either a material id, or { material_id, subcontractor_id }.
    // The second form is the ONLY way to resolve a pooled line: the data cannot
    // say whose the remainder is, but the site manager can. Without it an
    // undecidable line would be stranded forever, which is the same as
    // discarding it — exactly what this conversion exists to avoid.
    const materialId = mapped && typeof mapped === 'object' ? mapped.material_id : mapped;
    const ownerOverride = mapped && typeof mapped === 'object' ? mapped.subcontractor_id : undefined;

    if (materialId !== undefined && materialId !== null && verdict.state !== 'CONVERGED' && row.on_hand > 0.0001) {
      if (row.contributors > 1 && ownerOverride === undefined) {
        buckets.UNDECIDABLE.push({ row, verdict: { ...verdict,
          note: `${verdict.note}; map it to { "material_id": …, "subcontractor_id": … } to say whose it is` } });
        return;
      }
      buckets.READY.push({ row,
        verdict: { ...verdict, state: 'READY',
          note: ownerOverride !== undefined
            ? `mapped to material ${materialId}, owner set to subcontractor ${ownerOverride} by the reviewed mapping`
            : `mapped to material ${materialId}`,
          materialId, ownerOverride } });
      return;
    }
    buckets[verdict.state].push({ row, verdict });
  });

  const show = (title, list, extra) => {
    if (!list.length) return;
    console.log(`\n  ${title} — ${list.length}`);
    list.forEach(({ row, verdict }) => {
      console.log(`    ${row.warehouse_code} · ${row.description} (${row.uom})`);
      console.log(`      on hand ${row.on_hand}  received ${row.received}  consumed ${row.consumed}`
        + (row.subcontractor_name ? `  owner ${row.subcontractor_name}` : ''));
      console.log(`      ${verdict.note}`);
      if (extra) console.log(`      key: ${lineKey(row)}`);
    });
  };

  show('READY to convert', buckets.READY);
  show('NEEDS A MAPPING — no safe automatic match', buckets.NEEDS_MAPPING, true);
  show('UNDECIDABLE — ownership is not in the data', buckets.UNDECIDABLE, true);
  show('NOTHING TO MOVE', buckets.NOTHING_TO_MOVE);
  show('ALREADY CONVERGED', buckets.CONVERGED);

  if (args['write-mapping']) {
    const starter = {};
    [...buckets.NEEDS_MAPPING, ...buckets.UNDECIDABLE].forEach(({ row }) => { starter[lineKey(row)] = null; });
    fs.writeFileSync(args['write-mapping'], `${JSON.stringify(starter, null, 2)}\n`);
    console.log(`\n  Starter mapping written to ${args['write-mapping']}.`);
    console.log('  Replace each null with a material id, or with "SKIP" to leave that line behind.');
  }

  if (!args.apply) {
    console.log(`\n  DRY RUN — nothing was written. ${buckets.READY.length} line(s) would convert.`);
    console.log('  Re-run with --apply once the mapping has been reviewed.\n');
    db.close();
    return;
  }

  if (!buckets.READY.length) {
    console.log('\n  Nothing is ready to convert. Nothing written.\n');
    db.close();
    return;
  }

  const by = args.by || process.env.USER || 'converge-subcontractor-ledger';
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;

  const convert = db.transaction(() => {
    buckets.READY.forEach(({ row, verdict }) => {
      const material = db.prepare('SELECT * FROM materials WHERE id=?').get(verdict.materialId);
      if (!material) throw new Error(`Mapping points at material ${verdict.materialId}, which does not exist.`);
      const subcontractorId = verdict.ownerOverride !== undefined ? verdict.ownerOverride : row.only_subcontractor;
      if (!db.prepare('SELECT 1 FROM subcontractors WHERE id=?').get(subcontractorId)) {
        throw new Error(`Mapping points at subcontractor ${subcontractorId}, which does not exist.`);
      }

      // Unique across runs, not just within one. `created` restarts at zero every
      // run, so a counter alone collided with an earlier conversion onto the same
      // material and warehouse — batches is UNIQUE on exactly that triple.
      const stem = `SC-CONV-${row.warehouse_code}-${String(material.item_code).slice(0, 12)}`;
      let batchNumber = `${stem}-1`;
      let suffix = 1;
      while (db.prepare('SELECT 1 FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=?')
        .get(material.id, batchNumber, row.warehouse_code)) {
        suffix += 1;
        batchNumber = `${stem}-${suffix}`;
      }
      const info = db.prepare(`
        INSERT INTO batches
          (batch_number, material_id, material_code, material_description,
           po_number, receiving_date, received_quantity, remaining_quantity,
           warehouse_code, quality_status, fifo_date,
           owner_type, owner_subcontractor_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'SUBCONTRACTOR',?)
      `).run(batchNumber, material.id, material.item_code, material.description,
        `LEGACY-LEDGER`, today, row.on_hand, row.on_hand,
        row.warehouse_code, 'RELEASED', today, subcontractorId);

      // Deliberately NOT a receipt movement. Nothing arrived on site today; this
      // material was received long ago through the legacy stream and counting it
      // as an inbound movement now would corrupt every consumption rate and
      // reorder point that reads the ledger by date.
      db.prepare(`
        INSERT INTO subcontractor_ledger_convergence
          (warehouse_code, description, category_id, uom, subcontractor_id,
           material_id, quantity, batch_id, converged_by)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(row.warehouse_code, row.description, row.category_id, row.uom,
        subcontractorId, material.id, row.on_hand, info.lastInsertRowid, by);

      db.prepare(`
        INSERT INTO audit_trail (entity_type, entity_id, action, old_value, new_value, changed_by_name, source_screen)
        VALUES ('Batch', ?, 'LEDGER_CONVERGED', ?, ?, ?, 'converge-subcontractor-ledger')
      `).run(info.lastInsertRowid,
        JSON.stringify({ legacy_line: lineKey(row), on_hand: row.on_hand }),
        JSON.stringify({ batch: batchNumber, material: material.item_code, owner_subcontractor_id: subcontractorId }),
        by);
      created += 1;
    });
  });

  try { convert(); } catch (e) { db.close(); fail(e.message); }
  db.close();

  console.log(`\n  ✓ Converted ${created} legacy line(s) into subcontractor-owned batches.\n`);
  console.log('    No inbound movement was recorded: this material arrived long ago, and');
  console.log('    booking it as received today would corrupt consumption rates and reorder');
  console.log('    points. The batches carry their real quantity and their real owner.\n');
}

main();
