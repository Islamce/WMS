#!/usr/bin/env node
'use strict';

/**
 * Every screen an edition does not include is a screen NOBODY on that tenant
 * can open — admins included, because App.can() checks the edition before the
 * admin short-circuit. That is correct for a module the tenant did not buy and
 * catastrophic for one they need, and the two look identical in the code: a key
 * simply absent from a list.
 *
 * This has now bitten twice. The phase 2/3 authorities were missing from the
 * contracting profile and would have hidden the new screens from the tenant who
 * bought the edition. Then `erp_operator` turned out to be in NO profile at all,
 * which dead-ended the request workflow on every provisioned tenant: manager
 * approval moves a request to APPROVED_PENDING_ERP and the ERP Operator queue is
 * the only screen that advances it.
 *
 * Both were found by hand, late. The failure mode is structural — a profile is
 * an allow-list, so any permission added later is excluded from every edition by
 * default and nothing says so. This test is the deterministic control for it:
 * a permission that gates a CLIENT ROUTE must be in every profile, or be listed
 * below as a reviewed, deliberate exclusion.
 *
 * Scope is routes on purpose. A permission that gates no route (approvals_high_value,
 * movement_import_finalize, the attestation pair) is checked server-side against
 * the user's own permissions and is unaffected by the edition, so requiring those
 * would be noise that trains people to add entries without thinking.
 */

const fs = require('fs');
const path = require('path');
const { PROFILES, CORE_MODULES } = require('../../server/services/tenantProfile');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;
const fails = [];

function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log('PASS:', name); }
  else { failed += 1; fails.push(name); console.log('FAIL:', name, detail); }
}

/**
 * Deliberately outside every edition, with the reason. An entry here is a
 * decision someone made; an omission from a profile is not.
 */
const DELIBERATELY_EXCLUDED = {
  // Sold as an add-on rather than bundled. Listed here so the exclusion is a
  // recorded decision instead of an accident, and so the owner can move it into
  // the profiles when the pricing question is settled.
  ai_analytics: 'Analytics add-on — bundling is an open pricing decision.',
};

/** Permission keys that gate a route in the client's route table. */
function routePermissions() {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const keys = new Set();
  // Matches both the nav entries and the ROUTES map: permission: 'x' or ['x','y'].
  const single = /permission:\s*'([a-z0-9_]+)'/g;
  const many = /permission:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = single.exec(app)) !== null) keys.add(m[1]);
  while ((m = many.exec(app)) !== null) {
    m[1].split(',').forEach((part) => {
      const k = part.trim().replace(/^'|'$/g, '');
      if (/^[a-z0-9_]+$/.test(k)) keys.add(k);
    });
  }
  return [...keys].sort();
}

const routeKeys = routePermissions();
check('the client route table was parsed', routeKeys.length > 10, routeKeys.length);

// A route gated by SEVERAL permissions is reachable if any ONE of them is in the
// edition, so those are checked as a group. A route gated by a single permission
// has no such fallback and is checked on its own.
//
// Solo keys are collected from their own matches rather than by subtracting the
// grouped ones: `erp_operator` gates the ERP queue alone AND appears inside the
// Goods Receipt group, and subtracting would have dropped it from the strict
// check — which is exactly the key this test exists for.
const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const groups = [];
let g;
const groupRe = /permission:\s*\[([^\]]+)\]/g;
while ((g = groupRe.exec(app)) !== null) {
  const keys = g[1].split(',').map((p) => p.trim().replace(/^'|'$/g, '')).filter((k) => /^[a-z0-9_]+$/.test(k));
  if (keys.length) groups.push(keys);
}
const soloKeys = [];
let s1;
const soloRe = /permission:\s*'([a-z0-9_]+)'/g;
while ((s1 = soloRe.exec(app)) !== null) {
  if (!soloKeys.includes(s1[1])) soloKeys.push(s1[1]);
}

// Rule 1 — the one that catches this class of bug. A route reachable on NO
// edition is broken; a route reachable on SOME editions is a product decision.
// The subcontractor screens are Contracting-only on purpose: a Manufacturing
// tenant did not buy subcontractor custody. `erp_operator` was in no edition at
// all, which is a different thing entirely.
const anyProfile = new Set(Object.values(PROFILES).flatMap((p) => p.modules));

const orphanSolo = soloKeys.filter((k) => !anyProfile.has(k) && !DELIBERATELY_EXCLUDED[k]);
check('every single-permission route is reachable on at least one edition',
  orphanSolo.length === 0,
  orphanSolo.length ? `in no edition: ${orphanSolo.join(', ')}` : '');

const orphanGroups = groups.filter((keys) =>
  keys.every((k) => !anyProfile.has(k) && !DELIBERATELY_EXCLUDED[k]));
check('every multi-permission route is reachable on at least one edition',
  orphanGroups.length === 0,
  orphanGroups.length ? `in no edition: ${orphanGroups.map((k) => k.join('|')).join(' ; ')}` : '');

// Rule 2 — a route gated only by core permissions must work on every edition.
// Editions differentiate what a tenant bought; they must never break the spine
// of the product that every warehouse needs.
const core = new Set(CORE_MODULES);
const coreSolo = soloKeys.filter((k) => core.has(k));
const coreGroups = groups.filter((keys) => keys.every((k) => core.has(k)));

Object.entries(PROFILES).forEach(([profileKey, profile]) => {
  const modules = new Set(profile.modules);

  const missing = coreSolo.filter((k) => !modules.has(k));
  check(`${profileKey}: every core route is reachable`,
    missing.length === 0,
    missing.length ? `core route unreachable on this edition: ${missing.join(', ')}` : '');

  const deadCore = coreGroups.filter((keys) => keys.every((k) => !modules.has(k)));
  check(`${profileKey}: no core route is reachable by nobody`,
    deadCore.length === 0,
    deadCore.length ? `unreachable: ${deadCore.map((k) => k.join('|')).join(' ; ')}` : '');
});

// The specific break this test was written for, pinned by name so a future
// refactor that drops it fails with an obvious message rather than a diff.
Object.entries(PROFILES).forEach(([profileKey, profile]) => {
  check(`${profileKey}: the ERP Operator queue is reachable`,
    profile.modules.includes('erp_operator'),
    'Approved requests stop at APPROVED_PENDING_ERP with no screen to advance them.');
});

// An exclusion must be a real permission, or the list rots into a set of typos
// that silently excuse nothing.
Object.keys(DELIBERATELY_EXCLUDED).forEach((key) => {
  check(`the deliberate exclusion '${key}' is a real route permission`,
    routeKeys.includes(key), routeKeys.slice(0, 5));
});

console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (fails.length) console.log('Failed:', fails);
process.exit(failed ? 1 : 0);
