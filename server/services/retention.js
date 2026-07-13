/**
 * Data retention — prune high-volume operational logs after a configurable age.
 *
 * Applies to notification_log and erp_integration_log, which grow without bound
 * and have no long-term legal value. The audit_trail is deliberately NEVER
 * pruned — it is the permanent, append-only record of who changed what (and is
 * protected by DB triggers). Controlled by RETENTION_DAYS (0 = keep forever).
 */
const db = require('./../db/connection');

const PRUNABLE = [
  { table: 'notification_log', column: 'sent_at' },
  { table: 'erp_integration_log', column: 'created_at' },
];

/**
 * Delete prunable rows older than `days`. Returns per-table counts and a total.
 * A non-positive `days` is a no-op.
 * @param {number} days override RETENTION_DAYS (mainly for testing).
 */
function pruneRetention(days = Number(process.env.RETENTION_DAYS) || 0) {
  const result = { total: 0, byTable: {} };
  if (!days || days <= 0) return result;
  const cutoff = `-${Math.floor(days)} days`;
  PRUNABLE.forEach(({ table, column }) => {
    const info = db.prepare(
      `DELETE FROM ${table} WHERE ${column} IS NOT NULL AND ${column} < datetime('now', ?)`
    ).run(cutoff);
    result.byTable[table] = info.changes;
    result.total += info.changes;
  });
  return result;
}

module.exports = { pruneRetention, PRUNABLE };
