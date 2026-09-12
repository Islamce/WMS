/**
 * The Arabic gate: untranslated strings may go down, never up.
 *
 * The product is sold into a market whose storekeepers do not read English, and
 * it is currently ~1,300 hardcoded English strings deep. A gate that demanded
 * zero would have to be switched off on the day it was written, and a gate that
 * is off proves nothing. So this one is a ratchet against a checked-in baseline:
 * adopt it today at the number it actually is, fail any pull request that adds a
 * hardcoded string, and let the number fall screen by screen.
 *
 * Per file, not in total, so a page that is being translated cannot pay for a
 * page that is being regressed.
 *
 * When a file improves, lower its baseline — this test prints the exact line.
 *
 * It also bans `const t = …` in the frontend. Four pages had shadowed the
 * translation function with a local, which would have thrown the moment anyone
 * translated them; that landmine should not come back.
 */
const fs = require('fs');
const path = require('path');
const { scan, targetFiles } = require('./../scripts/i18n-scan');

const ROOT = path.join(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'i18n-baseline.json');

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { passed += 1; console.log('PASS:', name); }
  else { failed += 1; fails.push(name); console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
const { byFile, total, ignored } = scan();

console.log(`Untranslated: ${total} occurrence(s) across ${Object.keys(byFile).length} file(s); ` +
  `${ignored} suppressed by an i18n-ignore comment.`);

// ===== 1. No file may get worse =====
const regressions = [];
const improvements = [];
for (const [file, rows] of Object.entries(byFile)) {
  const allowed = baseline.files[file];
  if (allowed === undefined) {
    regressions.push(`${file}: ${rows.length} untranslated string(s) and no baseline entry`);
  } else if (rows.length > allowed) {
    const sample = rows.slice(0, 5).map((r) => `    line ${r.line}: ${r.text}`).join('\n');
    regressions.push(`${file}: ${rows.length} > baseline ${allowed}\n${sample}`);
  } else if (rows.length < allowed) {
    improvements.push(`  "${file}": ${rows.length},   (was ${allowed})`);
  }
}
check('no file added an untranslated user-facing string', regressions.length === 0,
  regressions.length ? '\n  ' + regressions.join('\n  ') : '');

// A file that disappeared from the findings is fully translated (or deleted).
for (const file of Object.keys(baseline.files)) {
  if (!byFile[file] && baseline.files[file] > 0) improvements.push(`  "${file}": 0,   (was ${baseline.files[file]})`);
}
if (improvements.length) {
  console.log('\nThese files improved. Lower their baseline in tests/i18n-baseline.json:');
  console.log(improvements.sort().join('\n'));
}

// ===== 2. The total may not drift up either =====
check('the total did not rise', total <= baseline.total, `${total} > ${baseline.total}`);

// ===== 3. t() must not be shadowed =====
const shadowed = [];
for (const file of targetFiles()) {
  if (!file.endsWith('.js')) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/\b(?:const|let|var)\s+t\s*=/.test(line)) shadowed.push(`${path.relative(ROOT, file)}:${i + 1}`);
  });
}
check('nothing shadows the translation function t()', shadowed.length === 0, shadowed.join(', '));

// ===== 4. The escape hatch stays rare =====
check('i18n-ignore is not being used as the default', ignored <= baseline.maxIgnored,
  `${ignored} > ${baseline.maxIgnored}`);

console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (fails.length) console.log('Failed:', fails.join(', '));
process.exit(failed ? 1 : 0);
