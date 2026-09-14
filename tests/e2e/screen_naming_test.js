/**
 * One name per screen, defined in one place.
 *
 * The product carried two complete vocabularies: `app.js` named every screen for
 * the launchpad tiles, and `navigation-v2.js` named them again for the sidebar.
 * 33 of 39 disagreed — the sidebar said "Request Work Queue" while the tile
 * directly below it said "Requests" — and both were rendered on the home screen
 * at once. That is not a wording problem. It is the product looking to a buyer
 * like it was built twice by people who never spoke.
 *
 * The fix was structural, not cosmetic: the second table is gone, so the two
 * cannot drift apart again. This test exists to keep it gone, because a second
 * table is exactly the kind of thing that gets added back by someone who only
 * wants to rename one screen and does not know the first table exists.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { passed += 1; console.log('PASS:', name); }
  else { failed += 1; fails.push(name); console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const nav = fs.readFileSync(path.join(ROOT, 'public/js/navigation-v2.js'), 'utf8');

const modules = app.slice(app.indexOf('const MODULES'), app.indexOf('const NAV_ITEMS'));
const items = [...modules.matchAll(/\{ route: '([^']+)', label: '([^']+)'/g)];

check('app.js still defines the screens', items.length >= 30, items.length);

// ===== 1. No second naming table =====
check('navigation-v2.js defines no screen labels of its own',
  !/const\s+LABELS\s*=/.test(nav) && !/\bLABELS\[/.test(nav));

// The sidebar may group and order links; it may not rewrite their text.
check('and does not rewrite a rendered link label',
  !/\.lbl'\)\s*;[\s\S]{0,120}\.textContent\s*=\s*(?!t\(def\.label\))[A-Za-z]/.test(
    nav.slice(nav.indexOf('def.routes.forEach'), nav.indexOf('head.addEventListener'))),
  'a label is being overwritten inside the route loop');

// ===== 2. Every screen's name is unique and legible =====
const byRoute = new Map();
const seenLabels = new Map();
const duplicates = [];
const terse = [];
for (const [, route, label] of items) {
  byRoute.set(route, label);
  if (seenLabels.has(label)) duplicates.push(`${label}: ${seenLabels.get(label)} and ${route}`);
  seenLabels.set(label, route);
  // A bare word cannot distinguish four screens that all show locations.
  if (label.length < 5) terse.push(`${route}: "${label}"`);
}
check('no two screens share a name', duplicates.length === 0, duplicates.join('; '));
check('no screen name is too short to identify it', terse.length === 0, terse.join('; '));

// ===== 3. The names people disagreed about are settled =====
// Spot-checks on the worst offenders, so a silent revert to either vocabulary
// is caught rather than merely being inconsistent again.
const settled = {
  'create-request': 'Create Material Request',
  requests: 'Material Requests',
  allocation: 'Bin & Batch Assignment',
  materials: 'Material Master',
  quality: 'Quality Inspection',
};
const wrong = Object.entries(settled).filter(([route, label]) => byRoute.get(route) !== label)
  .map(([route, label]) => `${route}: expected "${label}", found "${byRoute.get(route)}"`);
check('the screens that had two names now have one', wrong.length === 0, wrong.join('; '));

console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (fails.length) console.log('Failed:', fails.join(', '));
process.exit(failed ? 1 : 0);
