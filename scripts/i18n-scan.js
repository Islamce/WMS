/**
 * Find user-facing strings in the frontend that are not wrapped in t().
 *
 * This is a heuristic, and it says so plainly: it reads JavaScript as text, so
 * it cannot know whether a literal reaches a screen. It errs toward reporting
 * and provides an escape hatch, because the alternative — a scanner that only
 * reports what it is certain about — would report almost nothing and the gate
 * built on it would pass an entirely English product.
 *
 * Used by scripts/i18n-extract.js (to list what needs translating) and by
 * tests/i18n_coverage_test.js (to stop the count going up).
 *
 * Escape hatch: put `i18n-ignore` in a comment on the line. Every use should be
 * justified in review; the reports print how many are in force so it cannot
 * quietly become the default.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'public/js/app.js',
  'public/js/ui.js',
  'public/js/navigation-v2.js',
  'public/index.html',
];

function targetFiles() {
  const files = TARGETS.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  const pagesDir = path.join(ROOT, 'public/js/pages');
  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir).filter((n) => n.endsWith('.js')).sort()) {
      files.push(path.join(pagesDir, f));
    }
  }
  return files;
}

// Shapes that are code, data or markup rather than something a person reads.
const NOT_A_LABEL = [
  /^[\d.\s,MLHVCZAmlhvcza+-]+$/,               // SVG path data
  /^[a-z0-9-]+(\s+[a-z0-9-]+)*$/,              // css class lists, enum-ish tokens
  /^[a-z]+([A-Z][a-z0-9]*)+$/,                 // camelCase identifiers
  /^[a-z0-9_]+$/,                              // snake_case / single tokens
  /^[A-Z0-9_]+$/,                              // SCREAMING enums: URGENT, HIGH
  /^(https?:)?\/\//,                           // urls
  /^[/#.]/,                                    // routes, selectors, anchors
  /^\w+\/[\w.+-]+$/,                           // mime types
  /^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/,
  /^\d/,                                       // starts with a digit
  /[{}$`]/,                                    // template plumbing
  /^&[a-z]+;$/,
  /[<>]/,                                      // inline svg / markup blobs
  /,\s*\w+:\s*$/,                              // object-literal fragment, not a sentence
  /[[\]()]/,                                   // css selectors, code fragments
  /^\s*\+|\+\s*$/,                             // concatenation caught mid-expression
  // KeyboardEvent.key values compared in handlers, not shown to anyone.
  /^(Escape|Enter|Tab|Backspace|Delete|Shift|Control|Alt|Meta|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End)$/,
];

// Strings that already have an Arabic translation are done, wherever they are
// written. app.js holds its nav labels in a data table and wraps them in t() at
// render, so they are translated without the literal ever sitting next to a
// t(). Checking the dictionary is what tells those apart from a hardcoded
// label, and it is also what makes the count fall when a translation lands.
const TRANSLATED = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  const block = src.slice(src.indexOf('  ar: {'), src.indexOf('  fr: {'));
  return new Set((block.match(/'((?:\\.|[^'\\])+)':/g) || [])
    .map((k) => k.slice(1, -2).replace(/\\'/g, "'")));
})();

function looksLikeLabel(s) {
  const v = s.trim();
  if (v.length < 3) return false;
  if (!/[A-Za-z]{3}/.test(v)) return false;
  if (NOT_A_LABEL.some((re) => re.test(v))) return false;
  if (TRANSLATED.has(v)) return false;
  // A label either contains a space or begins with a capital.
  return /\s/.test(v) || /^[A-Z]/.test(v);
}

const QUOTED = /'([^'\\\n]{3,})'|"([^"\\\n]{3,})"/g;
const TAG_TEXT = />([^<>{}\n]{3,})</g;
const ATTR = /\b(?:placeholder|title|alt|aria-label)\s*=\s*["']([^"'{\n]{3,})["']/g;

/** Scan one file. Returns { findings: [{line, text}], ignored: n }. */
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const findings = [];
  let ignored = 0;

  src.split('\n').forEach((raw, i) => {
    const line = raw;
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (/\bconsole\.(log|warn|error|info|debug)\b/.test(line)) return;
    if (/i18n-ignore/.test(line)) { ignored += 1; return; }

    // Anything this line already hands to t() is done; drop those spans so the
    // same literal is not reported from inside its own translation call.
    const stripped = line.replace(/\bt\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/g, 't(_)');

    const seen = new Set();
    const add = (v) => {
      const text = v.trim();
      if (!text || seen.has(text)) return;
      if (!looksLikeLabel(text)) return;
      seen.add(text);
      findings.push({ line: i + 1, text });
    };

    let m;
    QUOTED.lastIndex = 0;
    while ((m = QUOTED.exec(stripped))) add(m[1] || m[2]);
    TAG_TEXT.lastIndex = 0;
    while ((m = TAG_TEXT.exec(stripped))) add(m[1]);
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(stripped))) add(m[1]);
  });

  return { findings, ignored };
}

/** Scan everything. Returns { byFile: {rel: findings[]}, total, ignored }. */
function scan() {
  const byFile = {};
  let total = 0;
  let ignored = 0;
  for (const file of targetFiles()) {
    const { findings, ignored: ig } = scanFile(file);
    ignored += ig;
    if (findings.length) {
      byFile[path.relative(ROOT, file)] = findings;
      total += findings.length;
    }
  }
  return { byFile, total, ignored };
}

module.exports = { scan, scanFile, targetFiles, looksLikeLabel };
