/**
 * Cross-process scheduler guard.
 *
 * The background sweeps (picking reminders/escalation, reservation timeout)
 * must run once per tick across the whole deployment, not once per process.
 * When the app is scaled out (PM2 cluster, a rolling deploy where old and new
 * containers briefly overlap) several event loops would otherwise fire the
 * same sweep at the same second and double-process the same rows.
 *
 * `acquireTick` claims a short DB lease keyed by job name. The claim is a
 * single atomic UPDATE guarded on the lease being expired, so exactly one
 * process wins each tick; the rest get `false` and skip. If the winner dies
 * mid-tick the lease simply expires and the next tick is claimable again.
 */
const crypto = require('crypto');
const db = require('./../db/connection');

// Unique per process instance so we can tell holders apart in the lock row.
const HOLDER_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

const upsert = db.prepare(`
  INSERT INTO scheduler_locks (job_name, locked_until, holder, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(job_name) DO UPDATE SET
    locked_until = excluded.locked_until,
    holder       = excluded.holder,
    updated_at   = excluded.updated_at
  WHERE scheduler_locks.locked_until < excluded.locked_until - ? -- only steal an expired lease
`);

/**
 * Try to claim the tick for `jobName`, leasing it for `leaseMs`.
 * Returns true if this process may run the job now, false if another holds it.
 */
function acquireTick(jobName, leaseMs = 55000, now = Date.now()) {
  // The guard compares the stored lease against (now + leaseMs) - leaseMs === now,
  // i.e. "claim only if the existing lease has already expired".
  const info = upsert.run(jobName, now + leaseMs, HOLDER_ID, leaseMs);
  return info.changes > 0;
}

module.exports = { acquireTick, HOLDER_ID };
