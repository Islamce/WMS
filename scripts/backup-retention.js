#!/usr/bin/env node
/**
 * Local backup retention — keep the newest N complete/valid backup sets and
 * delete older ones as whole logical sets. Deliberately conservative:
 *
 *   node scripts/backup-retention.js <dir> [--keep N] [--dry-run]
 *
 * Rules:
 *   - A "valid set" has a parseable manifest whose referenced db_file exists
 *     (and attachments_dir when attachment_count > 0).
 *   - Valid sets are ranked by stamp (newest first); the newest N are kept.
 *   - The newest valid set is NEVER deleted (even if --keep 0 were passed).
 *   - Invalid / incomplete sets (missing/broken manifest relationships) are
 *     NEVER deleted — they are reported as warnings for a human to inspect.
 *   - A set is deleted as a unit: db + manifest + attachments dir together.
 *     No broad wildcard deletion is used.
 *   - --dry-run deletes nothing and lists the candidates.
 *
 * Intended to run only AFTER a verified offsite upload. Its failure must not
 * invalidate that upload, so the caller should treat a non-zero exit as a
 * warning, not a backup failure.
 */
const fs = require('fs');
const path = require('path');

const DB_RE = /^wms-(\d+)\.db$/;
const MANIFEST_RE = /^wms-(\d+)\.manifest\.json$/;
const ATTACH_RE = /^attachments-(\d+)$/;

function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`WARN: ${msg}`); }

/**
 * Defense-in-depth: refuse to act on a path that does not resolve to a direct
 * child of the (real) backup root. All names retention builds come from a
 * `\d+` stamp so they are already safe basenames — this guards against symlink
 * escape and any future change that might introduce an unexpected name.
 */
function assertChildOfRoot(root, name) {
  if (name !== path.basename(name) || name.includes('/') || name.includes('\\')) {
    warn(`refusing unsafe name '${name}'`); return false;
  }
  const target = path.join(root, name);
  const parent = path.dirname(path.resolve(target));
  if (parent !== path.resolve(root)) { warn(`refusing target outside backup root: ${name}`); return false; }
  // Never traverse a symlinked directory when deleting a set member.
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) { warn(`refusing to delete via symlink: ${name}`); return false; }
  } catch { /* missing is fine — nothing to delete */ }
  return true;
}

/**
 * Inspect a directory and classify every backup set. Returns
 * { valid: [{stamp, files[]}], invalid: [{stamp, reason}] }, valid sorted
 * newest-first by stamp.
 */
function scan(dir) {
  const entries = fs.readdirSync(dir);
  const stamps = new Set();
  for (const e of entries) {
    for (const re of [DB_RE, MANIFEST_RE, ATTACH_RE]) {
      const m = e.match(re); if (m) stamps.add(m[1]);
    }
  }
  const valid = []; const invalid = [];
  for (const stamp of stamps) {
    const manifestName = `wms-${stamp}.manifest.json`;
    const dbName = `wms-${stamp}.db`;
    const attachName = `attachments-${stamp}`;
    const manifestPath = path.join(dir, manifestName);
    if (!fs.existsSync(manifestPath)) { invalid.push({ stamp, reason: 'no manifest' }); continue; }
    let m;
    try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { invalid.push({ stamp, reason: `manifest parse error: ${e.message}` }); continue; }
    if (m.db_file !== dbName || !fs.existsSync(path.join(dir, dbName))) {
      invalid.push({ stamp, reason: 'manifest db_file missing/mismatched' }); continue;
    }
    const files = [manifestName, dbName];
    if (m.attachment_count > 0) {
      if (m.attachments_dir !== attachName || !fs.existsSync(path.join(dir, attachName))) {
        invalid.push({ stamp, reason: 'manifest attachments_dir missing/mismatched' }); continue;
      }
      files.push(attachName);
    } else if (fs.existsSync(path.join(dir, attachName))) {
      // Stray attachments dir not referenced by the manifest — keep the set but
      // include the dir so a delete removes it too.
      files.push(attachName);
    }
    valid.push({ stamp, files });
  }
  valid.sort((a, b) => (a.stamp < b.stamp ? 1 : -1)); // newest first
  return { valid, invalid };
}

function retain(dir, keep, dryRun) {
  if (!fs.existsSync(dir)) { console.error(`FAIL: directory not found: ${dir}`); process.exit(1); }
  const root = fs.realpathSync(dir); // resolve the backup root once, up front
  const { valid, invalid } = scan(root);
  invalid.forEach((s) => warn(`skipping invalid/incomplete set ${s.stamp}: ${s.reason} (never auto-deleted)`));

  const keepN = Math.max(1, keep); // never delete the newest set
  const kept = valid.slice(0, keepN);
  const candidates = valid.slice(keepN);
  log(`valid sets: ${valid.length}; keeping newest ${Math.min(keepN, valid.length)}; deletion candidates: ${candidates.length}${dryRun ? ' (dry-run)' : ''}`);
  kept.forEach((s) => log(`  KEEP  ${s.stamp}`));

  let deleted = 0; let failed = 0;
  for (const set of candidates) {
    // Extra guard: never delete the newest valid stamp.
    if (valid[0] && set.stamp === valid[0].stamp) { warn(`refusing to delete newest set ${set.stamp}`); continue; }
    for (const f of set.files) {
      if (!assertChildOfRoot(root, f)) { failed++; continue; }
      const p = path.join(root, f);
      if (dryRun) { log(`  DRYRUN would delete ${f}`); continue; }
      try { fs.rmSync(p, { recursive: true, force: true }); log(`  DELETE ${f}`); }
      catch (e) { warn(`could not delete ${f}: ${e.message}`); failed++; }
    }
    if (!dryRun) deleted++;
  }
  log(`retention complete: ${dryRun ? 0 : deleted} set(s) deleted, ${failed} file error(s), ${invalid.length} invalid set(s) left untouched`);
  if (failed > 0) process.exit(1);
}

module.exports = { scan, retain };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const ki = args.indexOf('--keep');
  const keep = ki >= 0 ? parseInt(args[ki + 1], 10) : 7;
  const dryRun = args.includes('--dry-run');
  if (!dir) { console.error('usage: backup-retention.js <dir> [--keep N] [--dry-run]'); process.exit(1); }
  retain(dir, Number.isFinite(keep) ? keep : 7, dryRun);
}
