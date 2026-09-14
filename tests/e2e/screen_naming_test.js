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

// The seeded permission labels still differ from the navigation names for this
// many screens. They are no longer USER-VISIBLE — the permissions screen
// resolves the name through MODULES at render — so this is now a tidiness
// measure on seed data rather than a defect a customer can see. It may fall and
// must never rise.
const KNOWN_PERMISSION_LABEL_CLASHES = 17;
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

// ===== 3. No THIRD table names a screen =====
// Deleting the sidebar's table was not enough. ROUTE_PAGES carried a `title`
// rendered as the breadcrumb above the page, so 19 screens showed the sidebar
// name and the breadcrumb name at the same moment, on the same screen. Titles
// now come from MODULES; only routes with no MODULES entry may carry one.
{
  const routePages = app.slice(app.indexOf('const ROUTE_PAGES = {'));
  const withTitle = [...routePages.matchAll(/'?([a-z0-9-]+)'?:\s*\{[^}]*title: '([^']+)'/g)];
  const shadowing = withTitle.filter(([, route]) => byRoute.has(route))
    .map(([, route, title]) => `${route}: MODULES says "${byRoute.get(route)}", ROUTE_PAGES says "${title}"`);
  check('no route carries a second name of its own', shadowing.length === 0, shadowing.join('; '));
  check('the breadcrumb reads its name from the one table',
    /renderLayout\(activeMenu, routeTitle\(/.test(app));
}

// ===== 4. The names people disagreed about are settled =====
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

// ===== 5. The fourth table, MEASURED but not yet enforced =====
// permissions.label names the same screens again, and is rendered as the
// screen's name on Roles & Permissions. It is not gated yet for one reason: the
// labels are ROWS IN EACH TENANT'S DATABASE, seeded once. Correcting the seed
// changes nothing on a tenant that already exists, so closing this needs an
// additive migration against live data — a separate, separately reviewed
// change. Counted here so it cannot be forgotten a third time, and so the
// number can only be seen to fall.
{
  const seed = fs.readFileSync(path.join(ROOT, 'server/db/seed2.js'), 'utf8');
  // Parse each item as a whole rather than assuming the field order. An
  // order-sensitive pattern silently matched 28 of 39 routes and undercounted
  // this gap — a guard that measures the wrong number is worse than none.
  const byPermission = new Map();
  for (const entry of modules.matchAll(/\{ route: '([^']+)',([^}]*)\}/g)) {
    const label = /label: '([^']+)'/.exec(entry[2]);
    const perms = [...entry[2].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const permission = /permission: '([a-z_]+)'/.exec(entry[2]);
    const keys = permission ? [permission[1]] : perms;
    if (label) keys.forEach((k) => { if (!byPermission.has(k)) byPermission.set(k, label[1]); });
  }
  const clashes = [];
  for (const m of seed.matchAll(/key: '([a-z_]+)', label: '([^']+)'/g)) {
    const navName = byPermission.get(m[1]);
    if (navName && navName !== m[2]) clashes.push(`${m[1]}: nav "${navName}" vs permission "${m[2]}"`);
  }
  console.log(`\nSEED TIDINESS: ${clashes.length} seeded permission label(s) differ from the `
    + 'navigation name.\nNot user-visible — the permissions screen resolves through MODULES '
    + 'at render, which\nis why no migration against live tenant rows was needed. '
    + 'It must only go DOWN.');
  if (clashes.length > KNOWN_PERMISSION_LABEL_CLASHES) {
    failed += 1;
    fails.push('permission label clashes increased');
    console.log('FAIL: the known gap grew —', clashes.slice(0, 5).join('; '));
  }
}

// The resolution is what keeps the fourth table off the screen. If it is
// removed, the seeded labels become visible again and this whole class of defect
// returns silently.
{
  const perms = fs.readFileSync(path.join(ROOT, 'public/js/pages/permissions.js'), 'utf8');
  const raw = [...perms.matchAll(/UI\.esc\(p\.label\)/g)].length;
  check('the permissions screen never renders a stored label directly', raw === 0,
    `${raw} place(s) still render p.label without resolving it`);
  check('and the resolver is exposed on App', /permissionScreenName\(key, storedLabel\)/.test(app));
}

console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (fails.length) console.log('Failed:', fails.join(', '));
process.exit(failed ? 1 : 0);
