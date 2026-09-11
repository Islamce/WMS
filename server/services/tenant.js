/**
 * Runtime tenant context — who this deployment belongs to and which industry
 * edition (Contracting / Manufacturing) it runs.
 *
 * THE SAFETY RULE THAT SHAPES THIS WHOLE FILE:
 *
 *   No tenant_profile row  ==  no edition restriction.
 *
 * Migration 021 creates the table EMPTY. Every install that existed before
 * editions were introduced therefore has no row, and must keep behaving exactly
 * as it did — every module stays reachable, nothing is hidden, nothing 403s.
 * An edition can only ever REMOVE modules from a tenant that explicitly opted
 * into one by being provisioned (scripts/provision-tenant.js writes the row).
 *
 * This direction matters: the alternative — defaulting an unconfigured install
 * to some profile — would silently switch off screens on a live deployment the
 * first time it restarted after an upgrade. Locking a warehouse out of Goods
 * Issue because a config row was missing is an outage, not a licensing feature.
 *
 * Editions are also NOT a security boundary. Permissions decide what a user may
 * open; the edition only decides what the tenant bought. A module the tenant did
 * not buy is refused, but a module they did buy is still permission-checked as
 * before — the two are independent gates and neither replaces the other.
 */
const db = require('./../db/connection');
const { getProfile } = require('./tenantProfile');

/**
 * Cached because it is read on every authenticated request and changes only
 * when a tenant is provisioned or its edition is deliberately changed — both
 * of which happen out of band, not during a request.
 */
let cached;

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

/**
 * The tenant context for this deployment.
 *
 * @returns {{
 *   configured: boolean,       false on a pre-editions install (no row)
 *   name: string|null,
 *   profileKey: string|null,
 *   modules: string[]|null,    null means "unrestricted", NOT "no modules"
 * }}
 */
function getTenant() {
  if (cached) return cached;

  // The table is absent on a database that has not run migration 021 yet
  // (e.g. mid-upgrade). Treated exactly like an empty table: unrestricted.
  const row = tableExists('tenant_profile')
    ? db.prepare('SELECT tenant_name, industry_profile FROM tenant_profile WHERE id = 1').get()
    : null;

  if (!row) {
    cached = { configured: false, name: null, profileKey: null, modules: null };
    return cached;
  }

  let profile;
  try {
    profile = getProfile(row.industry_profile);
  } catch {
    // An unrecognised profile key (a downgrade, or a hand-edited row) must not
    // take the deployment down or silently restrict it. Stay unrestricted and
    // keep the name, so the misconfiguration is visible without being fatal.
    cached = { configured: false, name: row.tenant_name, profileKey: null, modules: null };
    return cached;
  }

  cached = {
    configured: true,
    name: row.tenant_name,
    profileKey: profile.key,
    modules: profile.modules,
  };
  return cached;
}

/** Drop the cache after provisioning or an edition change (and in tests). */
function refreshTenant() {
  cached = undefined;
  return getTenant();
}

/**
 * Whether this deployment's edition includes a module.
 *
 * @param {string} moduleKey a permission key (see server/db/seed2.js)
 * @returns {boolean} always true when the deployment has no configured edition
 */
function tenantHasModule(moduleKey) {
  const { modules } = getTenant();
  if (!modules) return true; // unconfigured install — unrestricted, see header
  return modules.includes(moduleKey);
}

/**
 * Express guard for routes belonging to an optional module.
 *
 * Returns 404 rather than 403 on purpose: a module the tenant did not buy does
 * not exist for them, and answering 403 would confirm the feature is there and
 * merely withheld, which is a licensing detail no tenant needs to enumerate.
 *
 * Mount it BEFORE requirePermission so an unsold module never reaches the
 * permission layer at all.
 *
 * @param {string} moduleKey permission key the route belongs to
 */
function requireModule(moduleKey) {
  return (req, res, next) => {
    if (tenantHasModule(moduleKey)) return next();
    return res.status(404).json({ error: 'This module is not enabled for your organisation.' });
  };
}

module.exports = { getTenant, refreshTenant, tenantHasModule, requireModule };
