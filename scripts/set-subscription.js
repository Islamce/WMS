#!/usr/bin/env node
/**
 * Set or renew the deployment's subscription.
 *
 * Run on the host by the supplier, not from inside the customer's application.
 * An endpoint that let an administrator extend their own term would make the
 * whole mechanism decorative, so there deliberately is not one.
 *
 * Dry run by default, like every other script here that changes a live database:
 * it prints the term, the state that term produces today, and the exact date the
 * system would become read-only, before anything is written.
 *
 *   node scripts/set-subscription.js --db ... --plan standard --months 12
 *   node scripts/set-subscription.js --db ... --plan standard --months 12 --apply
 *   node scripts/set-subscription.js --db ... --suspend --apply
 *   node scripts/set-subscription.js --db ... --remove --apply
 *
 * --remove deletes the row, which returns the deployment to UNRESTRICTED. That
 * is the correct escape hatch: if the licensing mechanism itself ever goes
 * wrong on a live site, one command takes it out of the way without touching a
 * single row of the customer's stock.
 */
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const out = { apply: false, graceDays: 14 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (a === '--db') out.db = next();
    else if (a === '--plan') out.plan = next();
    else if (a === '--months') out.months = Number(next());
    else if (a === '--expires') out.expires = next();
    else if (a === '--grace-days') out.graceDays = Number(next());
    else if (a === '--reference') out.reference = next();
    else if (a === '--by') out.by = next();
    else if (a === '--suspend') out.suspend = true;
    else if (a === '--resume') out.resume = true;
    else if (a === '--remove') out.remove = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return out;
}

const usage = `Usage:
  node scripts/set-subscription.js --db <wms.db> --plan <name> (--months N | --expires YYYY-MM-DD)
                                   [--grace-days N] [--reference TEXT] [--by NAME] [--apply]
  node scripts/set-subscription.js --db <wms.db> (--suspend | --resume | --remove) [--apply]

Without --apply nothing is written.`;

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.db) { console.log(usage); process.exit(args.help ? 0 : 2); }

  const dbPath = path.resolve(args.db);
  const db = new Database(dbPath);
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_subscription'").get();
  if (!exists) {
    console.error('REFUSED: this database has no tenant_subscription table. Run the migrations first.');
    process.exit(1);
  }
  const current = db.prepare('SELECT * FROM tenant_subscription WHERE id = 1').get() || null;
  const today = new Date().toISOString().slice(0, 10);

  console.log(`Database : ${dbPath}`);
  console.log(`Current  : ${current
    ? `${current.plan}, ${current.status}, ${current.starts_on} → ${current.expires_on}, grace ${current.grace_days}d`
    : 'none (unrestricted — no licence check applies)'}\n`);

  let action;
  if (args.remove) {
    action = { kind: 'remove' };
    console.log('Would REMOVE the subscription row.');
    console.log('The deployment returns to UNRESTRICTED: no licence check, exactly as it ships today.');
  } else if (args.suspend || args.resume) {
    if (!current) { console.error('REFUSED: there is no subscription to change.'); process.exit(1); }
    action = { kind: 'status', status: args.suspend ? 'SUSPENDED' : 'ACTIVE' };
    console.log(`Would set status to ${action.status}.`);
    if (args.suspend) console.log('Writes stop immediately. Reads, exports and login keep working.');
  } else {
    if (!args.plan) { console.error(`REFUSED: --plan is required.\n\n${usage}`); process.exit(1); }
    if (!args.months && !args.expires) { console.error(`REFUSED: pass --months or --expires.\n\n${usage}`); process.exit(1); }
    const startsOn = current ? current.starts_on : today;
    const expiresOn = args.expires || addMonths(
      // A renewal extends the existing term rather than restarting it, so
      // renewing early never costs the customer the days they already paid for.
      current && current.expires_on > today ? current.expires_on : today,
      args.months
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) { console.error('REFUSED: --expires must be YYYY-MM-DD.'); process.exit(1); }
    if (expiresOn <= today) { console.error(`REFUSED: ${expiresOn} is not in the future.`); process.exit(1); }
    action = { kind: 'set', plan: args.plan, startsOn, expiresOn, graceDays: args.graceDays,
      reference: args.reference || null };
    const readOnlyFrom = new Date(Date.parse(`${expiresOn}T00:00:00Z`) + (args.graceDays + 1) * 86400000)
      .toISOString().slice(0, 10);
    console.log(`Would set : ${args.plan}, ${startsOn} → ${expiresOn}, grace ${args.graceDays} day(s)`);
    console.log(`Warnings start   : ${expiresOn} minus 30 days`);
    console.log(`Still writes to  : ${readOnlyFrom} (exclusive)`);
    console.log(`READ-ONLY from   : ${readOnlyFrom}`);
    console.log('\nRead-only means reads, exports and login keep working. Nothing is ever deleted.');
  }

  if (!args.apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
    db.close();
    return;
  }

  const by = args.by || 'set-subscription';
  db.transaction(() => {
    if (action.kind === 'remove') {
      db.prepare('DELETE FROM tenant_subscription WHERE id = 1').run();
    } else if (action.kind === 'status') {
      db.prepare("UPDATE tenant_subscription SET status=?, updated_at=datetime('now'), updated_by=? WHERE id=1")
        .run(action.status, by);
    } else {
      db.prepare(`
        INSERT INTO tenant_subscription (id, plan, status, starts_on, expires_on, grace_days, reference, updated_by)
        VALUES (1, @plan, 'ACTIVE', @startsOn, @expiresOn, @graceDays, @reference, @by)
        ON CONFLICT(id) DO UPDATE SET
          plan=@plan, status='ACTIVE', starts_on=@startsOn, expires_on=@expiresOn,
          grace_days=@graceDays, reference=@reference,
          updated_at=datetime('now'), updated_by=@by
      `).run({ ...action, by });
    }
    db.prepare(`
      INSERT INTO audit_trail (entity_type, action, old_value, new_value, changed_by_name, source_screen)
      VALUES ('Subscription', ?, ?, ?, ?, 'set-subscription')
    `).run(
      action.kind === 'remove' ? 'SUBSCRIPTION_REMOVED'
        : action.kind === 'status' ? `SUBSCRIPTION_${action.status}` : 'SUBSCRIPTION_SET',
      JSON.stringify(current), JSON.stringify(action), by
    );
  })();
  db.close();
  // The running process caches the subscription for the rest of the UTC day
  // (services/subscription.js), so a restart is REQUIRED, not optional. Saying
  // "or wait for the next request" would strand somebody using --remove to get
  // a warehouse out of read-only, at exactly the wrong moment.
  console.log('\nWritten. RESTART the application to pick it up:');
  console.log('  cd /opt/apps/wms && docker compose restart wms');
  console.log('The running process caches this until restart, so it is not optional.');
}

main();
