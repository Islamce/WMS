/**
 * First-run auto-seed policy.
 *
 * Auto-seeding writes a demo dataset AND a default administrator account. On a
 * real deployment that is a destructive-by-omission operation: if the live
 * database is ever observed empty, seeding seals over the void with demo data
 * and resets the administrator to a known default.
 *
 * This policy is therefore OPT-IN. Absence of configuration means "refuse".
 *
 * Why it is written this way (INC-2026-07-25-01, issue #40):
 *
 * The previous guard was opt-OUT and keyed on NODE_ENV:
 *
 *     if (NODE_ENV === 'production' && ALLOW_AUTO_SEED !== '1') refuse; else seed;
 *
 * That fails OPEN. A production host whose runtime environment does not export
 * NODE_ENV — which is easy to do under a managed Node.js/Passenger setup, and
 * was observed on this project — falls through to the `else` and seeds. The
 * symptoms are indistinguishable from "the admin password reset itself":
 * healthy health check, working application, demo data, default credentials.
 *
 * Safety must not depend on a variable being present. It now depends on a
 * variable being explicitly set to enable the dangerous path.
 */

/**
 * Decide whether the first-run seed may run.
 *
 * @param {object} env process.env (or any equivalent map) — injected so the
 *   policy is testable without mutating the real environment.
 * @returns {{allowed: boolean, reason: string}} `reason` is safe to log.
 */
function shouldAutoSeed(env) {
  const e = env || {};

  // Explicit kill switch wins over everything, including ALLOW_AUTO_SEED.
  if (e.SKIP_AUTO_SEED === '1') {
    return { allowed: false, reason: 'SKIP_AUTO_SEED=1 (explicitly disabled)' };
  }

  // Fail-safe default: seeding requires an explicit, deliberate opt-in.
  if (e.ALLOW_AUTO_SEED !== '1') {
    return { allowed: false, reason: 'ALLOW_AUTO_SEED is not set to 1 (auto-seed is opt-in)' };
  }

  return { allowed: true, reason: 'ALLOW_AUTO_SEED=1' };
}

/**
 * Operator-facing warning for an empty database that will NOT be seeded.
 * Deliberately alarming: on an established deployment an empty users table
 * means data loss or a mispointed DB_PATH, not a fresh install.
 *
 * @param {string} dbPath resolved database path
 * @param {string} reason from shouldAutoSeed()
 * @returns {string}
 */
function emptyDatabaseWarning(dbPath, reason) {
  return [
    '[CRITICAL] The database contains ZERO users and will NOT be auto-seeded.',
    `  Reason: ${reason}`,
    `  Database: ${dbPath}`,
    '  If this is an ESTABLISHED deployment, this is a DATA-LOSS or',
    '  WRONG-DATABASE condition. Do NOT seed and do NOT reset accounts as a',
    '  first response — diagnose read-only first (see WMS-PRODUCTION-RUNBOOK.md).',
    '  Check that DB_PATH points at the intended file and that the volume is mounted.',
    '  If this genuinely IS a first install, run `npm run seed` deliberately,',
    '  or start once with ALLOW_AUTO_SEED=1.',
  ].join('\n');
}

module.exports = { shouldAutoSeed, emptyDatabaseWarning };
