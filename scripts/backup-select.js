#!/usr/bin/env node
/**
 * Deterministic backup-set selection & structural validation.
 *
 *   node scripts/backup-select.js <dir> [--manifest <name>] [--json]
 *
 * Given a directory holding one or more backup sets, resolve exactly ONE
 * complete set from its MANIFEST (never from mtime) and prove its internal
 * consistency:
 *   - the manifest parses and has the expected fields
 *   - the referenced db_file exists, and its stamp matches the manifest stamp
 *     (manifest and database belong to the same set)
 *   - when attachment_count > 0, the referenced attachments_dir exists
 *
 * With --manifest, that specific manifest is selected (used after a backup run
 * to pick the set this run produced). Without it, the directory must contain
 * exactly one manifest, otherwise the call fails (ambiguous — never guess).
 *
 * Prints a JSON descriptor of the set (stamp, manifest, db, attachments_dir,
 * files[]) on success; exits non-zero with a clear FAIL reason otherwise. It
 * does NOT open the database (that is verify-backup.js's job) so it can run on
 * any Node without native modules.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_RE = /^wms-(\d+)\.manifest\.json$/;

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

function stampOf(name, re) { const m = name.match(re); return m ? m[1] : null; }

function select(dir, chosenManifest) {
  if (!fs.existsSync(dir)) fail(`directory not found: ${dir}`);
  const manifests = fs.readdirSync(dir).filter((f) => MANIFEST_RE.test(f)).sort();
  if (!manifests.length) fail(`no manifest found in ${dir}`);

  let manifestName = chosenManifest;
  if (manifestName) {
    if (!manifests.includes(manifestName)) fail(`requested manifest not present: ${manifestName}`);
  } else {
    if (manifests.length !== 1) {
      fail(`expected exactly one manifest, found ${manifests.length}: ${manifests.join(', ')} — pass --manifest to disambiguate`);
    }
    [manifestName] = manifests;
  }

  const manifestStamp = stampOf(manifestName, MANIFEST_RE);
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, manifestName), 'utf8')); }
  catch (e) { return fail(`manifest is not valid JSON (${manifestName}): ${e.message}`); }

  for (const field of ['db_file', 'db_sha256', 'db_bytes', 'attachment_count']) {
    if (!(field in m)) fail(`manifest missing required field '${field}'`);
  }
  if (typeof m.db_sha256 !== 'string' || m.db_sha256.length !== 64) fail('manifest db_sha256 is malformed');

  // db_file must exist and share the manifest's stamp (same set).
  const dbStamp = stampOf(m.db_file, /^wms-(\d+)\.db$/);
  if (dbStamp !== manifestStamp) fail(`db_file '${m.db_file}' stamp does not match manifest stamp '${manifestStamp}'`);
  const dbPath = path.join(dir, m.db_file);
  if (!fs.existsSync(dbPath)) fail(`referenced db_file missing: ${m.db_file}`);

  const files = [manifestName, m.db_file];
  let attachmentsDir = null;
  if (m.attachment_count > 0) {
    if (!m.attachments_dir) fail('attachment_count > 0 but attachments_dir is null');
    const aStamp = stampOf(m.attachments_dir, /^attachments-(\d+)$/);
    if (aStamp !== manifestStamp) fail(`attachments_dir stamp does not match manifest stamp`);
    const aPath = path.join(dir, m.attachments_dir);
    if (!fs.existsSync(aPath)) fail(`referenced attachments_dir missing: ${m.attachments_dir}`);
    attachmentsDir = m.attachments_dir;
    files.push(m.attachments_dir);
  }

  return { stamp: manifestStamp, manifest: manifestName, db: m.db_file, attachments_dir: attachmentsDir, files };
}

module.exports = { select };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const mi = args.indexOf('--manifest');
  const chosen = mi >= 0 ? args[mi + 1] : null;
  if (!dir) fail('usage: backup-select.js <dir> [--manifest <name>] [--json]');
  const set = select(dir, chosen);
  if (args.includes('--json')) console.log(JSON.stringify(set));
  else console.log(`SELECTED set stamp=${set.stamp} db=${set.db} manifest=${set.manifest} attachments=${set.attachments_dir || 'none'}`);
}
