#!/usr/bin/env node
/**
 * List the user-facing strings that are not translated yet.
 *
 * Reporting only — writes nothing. Run it to see where the gap is, or with
 * --stubs to emit a flat dictionary block a translator can fill in without
 * reading a diff.
 *
 *   node scripts/i18n-extract.js                 # summary + worst files
 *   node scripts/i18n-extract.js --file public/js/pages/receiving.js
 *   node scripts/i18n-extract.js --stubs > /tmp/stubs.js
 *
 * The count is a heuristic (see scripts/i18n-scan.js) and errs toward
 * reporting. Treat the number as a direction of travel, not an exact census.
 */
const { scan } = require('./i18n-scan');

const args = process.argv.slice(2);
const only = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const stubs = args.includes('--stubs');

const { byFile, total, ignored } = scan();

if (stubs) {
  const distinct = new Set();
  Object.values(byFile).forEach((rows) => rows.forEach((r) => distinct.add(r.text)));
  console.log('// Untranslated strings, one key per line. Fill in the Arabic and');
  console.log('// paste into the ar block of public/js/i18n.js.');
  [...distinct].sort().forEach((s) => console.log(`  ${JSON.stringify(s)}: '',`));
  process.exit(0);
}

if (only) {
  const rows = byFile[only] || [];
  rows.forEach((r) => console.log(`${only}:${r.line}  ${r.text}`));
  console.log(`\n${rows.length} untranslated string(s) in ${only}.`);
  process.exit(0);
}

const distinct = new Set();
Object.values(byFile).forEach((rows) => rows.forEach((r) => distinct.add(r.text)));
const ranked = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);

console.log(`Untranslated: ${total} occurrence(s), ${distinct.size} distinct string(s).`);
console.log(`Suppressed by an i18n-ignore comment: ${ignored}.`);
console.log('\nWorst files:');
ranked.slice(0, 15).forEach(([f, rows]) => console.log(`  ${String(rows.length).padStart(4)}  ${f}`));
console.log('\nRun with --file <path> for the lines, or --stubs for a translator handoff.');
