/**
 * Vertical (industry) profiles.
 *
 * The product is sold as different editions — Contracting and Manufacturing —
 * but there is exactly ONE codebase. A profile is configuration, never a fork:
 * it decides which optional modules a tenant gets, what the workflow stages are
 * called in that industry, and which request fields are mandatory.
 *
 * Why this exists as data rather than as a second repository: a fork doubles
 * every security fix, every migration and every test run, and the two copies
 * diverge until they can no longer be merged. One codebase with profiles is how
 * SAP, Odoo and Infor ship industry editions.
 *
 * Rules for adding to this file:
 *  - Permission keys MUST already exist in the permissions table (see
 *    server/db/seed2.js). A profile can only turn EXISTING modules on or off;
 *    it can never invent access that the permission system does not know about.
 *  - `terminology` only renames what the user sees. It must never be used to
 *    change behaviour — two tenants with different labels still run identical
 *    code paths, which is what keeps one codebase honest.
 */

/**
 * Modules every tenant gets regardless of industry — the core request-to-issue
 * workflow plus the governance screens. Kept separate from the per-profile
 * additions so it is obvious what the shared product actually is.
 */
const CORE_MODULES = [
  'dashboard', 'notifications',
  // erp_operator is core, not optional. Manager approval moves a request to
  // APPROVED_PENDING_ERP and the ERP Operator queue is the ONLY screen that
  // advances it. Leaving it out of an edition does not remove a feature, it
  // dead-ends the request workflow: every approved request sits in a queue no
  // user can open, admins included, because App.can() checks the edition before
  // the admin short-circuit. The contracting profile even renames this screen
  // to "Procurement Officer" — you do not rename a screen you meant to remove.
  'material_requests', 'create_request', 'approvals', 'erp_operator',
  'warehouse_dashboard', 'bin_batch_assignment', 'picker_assignment', 'picking', 'gi_posting',
  'goods_receipt', 'qr_printing', 'batch_tracking',
  'materials', 'locations', 'warehouses_master', 'bins_master',
  'stock_in', 'stock_out', 'all_locations', 'empty_locations',
  'cycle_count', 'inventory_count',
  'audit_trail', 'users_management', 'permissions_management',
  'kpi_dashboard',
];

const PROFILES = {
  contracting: {
    key: 'contracting',
    label: 'Contracting & Projects',
    label_ar: 'المقاولات والمشاريع',
    /**
     * Site stores issue material against a project/WBS, and a large share of
     * material is consumed by subcontractors whose custody must be reconciled.
     * That reconciliation is the differentiator for this edition.
     *
     * `quality` was briefly left out of this edition on the assumption that
     * incoming inspection is a manufacturing concern. A contractor corrected
     * that directly: material received from a subcontractor is inspected by the
     * company against the project's specifications and approved submittals
     * before it is accepted. Conformance-to-approvals IS the contracting
     * inspection case, so the module belongs here.
     */
    modules: [
      ...CORE_MODULES,
      'subcontractor_admin', 'subcontractor_receiving', 'subcontractor_quality_inspection',
      // Phase 2/3 authorities. They must be listed here or the edition gate
      // would hide the return queue and the subcontractor approval step from a
      // contracting tenant that has explicitly bought this edition — a user
      // holding the permission would still see nothing.
      'subcontractor_return_approval', 'project_management_approval',
      'quality',
      'reallocation', 'shipping', 'expiry_alerts',
    ],
    terminology: {
      'Cost Center': 'Project Cost Code',
      'Plant': 'Site',
      'Warehouse': 'Site Store',
      'ERP Operator': 'Procurement Officer',
      'Movement Type': 'Issue Category',
    },
    /** Project attribution is the whole point of a site store — enforce it. */
    requiredRequestFields: ['wbs_element', 'plant'],
  },

  manufacturing: {
    key: 'manufacturing',
    label: 'Manufacturing & Plants',
    label_ar: 'المصانع والمنشآت',
    /**
     * The existing deployment's shape: plant stores feeding production, where
     * shelf life and quality holds matter more than subcontractor custody.
     */
    modules: [
      ...CORE_MODULES,
      'quality', 'expiry_alerts', 'reallocation', 'shipping',
      'movement_types_master',
    ],
    terminology: {},
    requiredRequestFields: ['cost_center', 'plant'],
  },
};

const DEFAULT_PROFILE = 'manufacturing';

/** All selectable profile keys, for CLI validation and the admin UI. */
function profileKeys() {
  return Object.keys(PROFILES);
}

/**
 * Resolve a profile by key.
 *
 * Unknown keys throw rather than silently falling back: a tenant provisioned
 * against a profile that does not exist would get the wrong modules enabled,
 * and that is a licensing and access-control problem, not a display glitch.
 *
 * @param {string} key profile key
 * @returns {object} the profile definition
 */
function getProfile(key) {
  const profile = PROFILES[String(key || '').trim().toLowerCase()];
  if (!profile) {
    throw new Error(`Unknown industry profile '${key}'. Valid profiles: ${profileKeys().join(', ')}.`);
  }
  return profile;
}

/**
 * True when a module is part of the given profile. Callers that gate a screen
 * must still check the user's permission — the profile decides what the tenant
 * bought, the permission decides what this user may open.
 *
 * @param {string} profileKey profile key
 * @param {string} moduleKey permission key
 * @returns {boolean}
 */
function profileHasModule(profileKey, moduleKey) {
  return getProfile(profileKey).modules.includes(moduleKey);
}

/**
 * Apply a profile's label overrides to an English term.
 *
 * @param {string} profileKey profile key
 * @param {string} term the canonical English term
 * @returns {string} the tenant-facing term
 */
function term(profileKey, term_) {
  return getProfile(profileKey).terminology[term_] || term_;
}

module.exports = {
  CORE_MODULES,
  PROFILES,
  DEFAULT_PROFILE,
  profileKeys,
  getProfile,
  profileHasModule,
  term,
};
