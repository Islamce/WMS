/**
 * App shell: session, hash router, and an enterprise-style layout —
 * collapsible hierarchical sidebar, breadcrumbs, global command-palette search
 * and a user menu. Screens are permission-gated; each page module renders into
 * #page-content, so page logic is untouched by this shell.
 *
 * To add a screen: create public/js/pages/<name>.js registering Pages.<name>,
 * add it to MODULES + ROUTE_PAGES with its permission key, seed the key in
 * server/db/seed.js and protect its API routes.
 */
window.Pages = window.Pages || {};

// --- Inline icon set (feather-style, stroke = currentColor) ----------------
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  key: '<path d="M21 2l-2 2"/><path d="M14.5 6.5l3 3"/><path d="M13.4 7.6a5.5 5.5 0 1 0-7.8 7.8 5.5 5.5 0 0 0 7.8-7.8zm0 0L19 2l3 3-3.5 3.5"/>',
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  dot: '<circle cx="12" cy="12" r="2.5"/>',
};
function svg(name, extra) {
  return `<svg class="ico${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;
}

// --- Navigation model: modules → items (hierarchical) ----------------------
const MODULES = [
  { key: 'overview', label: 'Overview', icon: 'grid', items: [
    { route: 'dashboard', label: 'Dashboard', icon: 'grid', permission: 'dashboard' },
    { route: 'kpi', label: 'KPI Dashboard', icon: 'bar-chart', permission: 'kpi_dashboard' },
    { route: 'ai', label: 'AI Stock Analytics', icon: 'cpu', permission: 'ai_analytics' },
    { route: 'notifications', label: 'Notifications', icon: 'bell', permission: 'notifications' },
  ] },
  { key: 'requests', label: 'Material Requests', icon: 'file-text', items: [
    { route: 'create-request', label: 'Create Request', icon: 'file-plus', permission: 'create_request' },
    { route: 'requests', label: 'Requests', icon: 'list', permission: 'material_requests' },
    { route: 'approvals', label: 'Approvals', icon: 'check-circle', permission: 'approvals' },
    { route: 'erp-operator', label: 'ERP Operator', icon: 'link', permission: 'erp_operator' },
  ] },
  { key: 'warehouse', label: 'Warehouse Execution', icon: 'truck', items: [
    { route: 'warehouse', label: 'Warehouse Dashboard', icon: 'home', permission: 'warehouse_dashboard' },
    { route: 'allocation', label: 'Bin & Batch Assign', icon: 'compass', permission: 'bin_batch_assignment' },
    { route: 'picker-assign', label: 'Picker Assignment', icon: 'user-plus', permission: 'picker_assignment' },
    { route: 'picking', label: 'My Picking Tasks', icon: 'smartphone', permission: 'picking' },
    { route: 'gi-posting', label: 'Goods Issue Posting', icon: 'send', permission: 'gi_posting' },
  ] },
  { key: 'receiving', label: 'Receiving & Quality', icon: 'download', items: [
    { route: 'receiving', label: 'Goods Receipt & QR', icon: 'download', permission: ['goods_receipt', 'erp_operator', 'picking'] },
    { route: 'qr-printing', label: 'QR Label Printing', icon: 'printer', permission: 'qr_printing' },
    { route: 'batches', label: 'Batch Tracking', icon: 'layers', permission: 'batch_tracking' },
    { route: 'expiry', label: 'Expiry Alerts', icon: 'clock', permission: 'expiry_alerts' },
    { route: 'cycle-count', label: 'Cycle Counting', icon: 'clipboard', permission: 'cycle_count' },
    { route: 'quality', label: 'Quality', icon: 'shield', permission: 'quality' },
  ] },
  { key: 'inventory', label: 'Inventory', icon: 'map', items: [
    { route: 'all-locations', label: 'All Locations', icon: 'map', permission: 'all_locations' },
    { route: 'empty-locations', label: 'Empty Locations', icon: 'square', permission: 'empty_locations' },
  ] },
  { key: 'master', label: 'Master Data', icon: 'database', items: [
    { route: 'materials', label: 'Materials', icon: 'box', permission: 'materials' },
    { route: 'locations', label: 'Locations', icon: 'pin', permission: 'locations' },
    { route: 'warehouses-master', label: 'Warehouses', icon: 'home', permission: 'warehouses_master' },
    { route: 'bins-master', label: 'Bin Locations', icon: 'archive', permission: 'bins_master' },
    { route: 'movement-types', label: 'Movement Types', icon: 'shuffle', permission: 'movement_types_master' },
    { route: 'import', label: 'Import Data', icon: 'download', permission: ['materials', 'locations', 'warehouses_master', 'bins_master', 'movement_types_master', 'goods_receipt'] },
  ] },
  { key: 'admin', label: 'Administration', icon: 'shield', items: [
    { route: 'audit', label: 'Audit Trail', icon: 'file-text', permission: 'audit_trail' },
    { route: 'users', label: 'Users', icon: 'users', permission: 'users_management' },
    { route: 'permissions', label: 'Permissions', icon: 'lock', permission: 'permissions_management' },
  ] },
];

// Flattened lookups (route → item, route → module).
const NAV_ITEMS = [];
const ROUTE_MODULE = {};
MODULES.forEach((m) => m.items.forEach((it) => { NAV_ITEMS.push(Object.assign({ module: m }, it)); ROUTE_MODULE[it.route] = m; }));
ROUTE_MODULE['request-detail'] = ROUTE_MODULE['requests'];

const ROUTE_PAGES = {
  'home': { title: 'Home', page: 'home', permission: null }, // launchpad — any signed-in user
  'dashboard': { title: 'Dashboard', page: 'dashboard', permission: 'dashboard' },
  'kpi': { title: 'KPI Dashboard', page: 'kpi', permission: 'kpi_dashboard' },
  'ai': { title: 'AI Stock Analytics', page: 'ai', permission: 'ai_analytics' },
  'notifications': { title: 'Notifications', page: 'notifications', permission: 'notifications' },
  'create-request': { title: 'Create Material Request', page: 'createRequest', permission: 'create_request' },
  'requests': { title: 'Material Requests', page: 'requests', permission: 'material_requests' },
  'request-detail': { title: 'Request Detail', page: 'requestDetail', permission: 'material_requests' },
  'approvals': { title: 'Manager Approvals', page: 'approvals', permission: 'approvals' },
  'erp-operator': { title: 'ERP Operator Queue', page: 'erpOperator', permission: 'erp_operator' },
  'warehouse': { title: 'Warehouse Dashboard', page: 'warehouse', permission: 'warehouse_dashboard' },
  'allocation': { title: 'Bin & Batch Assignment', page: 'allocation', permission: 'bin_batch_assignment' },
  'picker-assign': { title: 'Picker Assignment', page: 'pickerAssign', permission: 'picker_assignment' },
  'picking': { title: 'My Picking Tasks', page: 'picking', permission: 'picking' },
  'gi-posting': { title: 'Goods Issue Posting', page: 'giPosting', permission: 'gi_posting' },
  'receiving': { title: 'Goods Receipt & QR', page: 'receiving', permission: ['goods_receipt', 'erp_operator', 'picking'] },
  'qr-printing': { title: 'QR Label Printing', page: 'qrPrinting', permission: 'qr_printing' },
  'batches': { title: 'Batch Tracking', page: 'batches', permission: 'batch_tracking' },
  'expiry': { title: 'Expiry Alerts', page: 'expiry', permission: 'expiry_alerts' },
  'cycle-count': { title: 'Cycle Counting', page: 'cycleCount', permission: 'cycle_count' },
  'quality': { title: 'Quality Management', page: 'quality', permission: 'quality' },
  'stock-in': { title: 'Stock In', page: 'stockin', permission: 'stock_in' },
  'stock-out': { title: 'Stock Out', page: 'stockout', permission: 'stock_out' },
  'all-locations': { title: 'All Locations', page: 'alllocations', permission: 'all_locations' },
  'empty-locations': { title: 'Empty Locations', page: 'emptylocations', permission: 'empty_locations' },
  'materials': { title: 'Materials', page: 'materials', permission: 'materials' },
  'locations': { title: 'Locations', page: 'locations', permission: 'locations' },
  'warehouses-master': { title: 'Warehouse Master', page: 'warehousesMaster', permission: 'warehouses_master' },
  'bins-master': { title: 'Bin Location Master', page: 'binsMaster', permission: 'bins_master' },
  'movement-types': { title: 'Movement Type Config', page: 'movementTypes', permission: 'movement_types_master' },
  'import': { title: 'Import Center', page: 'importCenter', permission: ['materials', 'locations', 'warehouses_master', 'bins_master', 'movement_types_master', 'goods_receipt'] },
  'audit': { title: 'Audit Trail', page: 'audit', permission: 'audit_trail' },
  'users': { title: 'Users Management', page: 'users', permission: 'users_management' },
  'permissions': { title: 'Permissions Management', page: 'permissions', permission: 'permissions_management' },
};

const LS = { collapsed: 'wms_nav_collapsed', groups: 'wms_nav_groups' };

const App = {
  user: null,

  can(permission) {
    if (!this.user) return false;
    if (Array.isArray(permission)) return permission.some((p) => this.can(p));
    if (this.user.role === 'admin') return true;
    return this.user.permissions.includes(permission);
  },

  async init() {
    window.addEventListener('hashchange', () => this.route());
    if (Api.token) {
      try {
        const { user } = await Api.get('/api/auth/me');
        this.user = user;
      } catch { /* handled by onSessionExpired */ }
    }
    this.route();
  },

  onSessionExpired() { this.user = null; this.route(); },

  logout() {
    Api.setToken(null);
    this.user = null;
    location.hash = '#/login';
  },

  /** The launchpad (Home) is the landing page for every signed-in user. */
  defaultRoute() { return 'home'; },

  route() {
    const raw = location.hash.replace(/^#\//, '') || '';
    const [hash, param] = raw.split('/');

    if (!this.user) {
      if (hash === 'signup') return Pages.auth.render('signup');
      return Pages.auth.render('login');
    }

    // Force a password change (e.g. the seeded default admin) before anything else.
    if (this.user.must_change_password) return this.renderForcedPasswordChange();

    let routeKey = hash;
    let def = ROUTE_PAGES[hash];
    // A route with permission `null` (the Home launchpad) is open to any user.
    if (!def || (def.permission && !this.can(def.permission))) {
      const fallback = this.defaultRoute();
      if (!fallback) return this.renderNoAccess();
      if (hash !== fallback) { location.hash = `#/${fallback}`; return; }
      routeKey = fallback;
      def = ROUTE_PAGES[fallback];
    }

    const activeMenu = routeKey === 'request-detail' ? 'requests' : routeKey;
    this.renderLayout(activeMenu, def.title);
    Pages[def.page].render(document.getElementById('page-content'), param);
    this.refreshNotificationBadge();
  },

  async refreshNotificationBadge() {
    if (!this.can('notifications')) return;
    try {
      const { unread } = await Api.get('/api/notifications/unread-count');
      const targets = [
        document.querySelector('.nav-item[href="#/notifications"]'),
        document.getElementById('topbar-bell'),
      ];
      targets.forEach((el) => {
        if (!el) return;
        let badge = el.querySelector('.notif-badge');
        if (unread > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'notif-badge'; el.appendChild(badge); }
          badge.textContent = unread > 99 ? '99+' : unread;
        } else if (badge) { badge.remove(); }
      });
    } catch { /* ignore */ }
  },

  /** Full-screen gate shown until a forced password change is completed. */
  renderForcedPasswordChange() {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="logo">🔒 ${t('Set a new password')}</div>
        <p class="subtitle">${t('For security, please change the default password before continuing.')}</p>
        <div class="form-group"><label>${t('Current password')}</label><input type="password" id="fp-cur"></div>
        <div class="form-group"><label>${t('New password')}</label><input type="password" id="fp-new"><div class="hint">${t('At least 8 characters.')}</div></div>
        <div class="form-group"><label>${t('Confirm new password')}</label><input type="password" id="fp-cf"></div>
        <button class="btn block" id="fp-save">${t('Update password')}</button>
        <p class="switch"><a href="#" id="fp-logout">${t('Sign out')}</a></p>
      </div></div>`;
    const $ = (s) => document.getElementById(s);
    $('fp-logout').addEventListener('click', (e) => { e.preventDefault(); this.logout(); });
    $('fp-save').addEventListener('click', async () => {
      const cur = $('fp-cur').value, nw = $('fp-new').value, cf = $('fp-cf').value;
      if (!cur || !nw) return UI.toast(t('Fill in all fields.'), 'error');
      if (nw.length < 8) return UI.toast(t('At least 8 characters.'), 'error');
      if (nw !== cf) return UI.toast(t('Passwords do not match.'), 'error');
      try {
        await Api.patch('/api/auth/password', { current_password: cur, new_password: nw });
        this.user.must_change_password = false;
        UI.toast(t('Password changed.'));
        location.hash = '#/home';
        this.route();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('fp-cur').focus();
  },

  renderNoAccess() {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="logo">▦ WMS</div>
        <p class="subtitle">Your account has no screen permissions yet.<br>Ask an administrator to grant you access.</p>
        <button class="btn block" id="no-access-logout">Back to login</button>
      </div></div>`;
    document.getElementById('no-access-logout').addEventListener('click', () => App.logout());
  },

  // --- Sidebar preferences (persisted) -------------------------------------
  isCollapsed() { return localStorage.getItem(LS.collapsed) === '1'; },
  openGroups() {
    try { const v = JSON.parse(localStorage.getItem(LS.groups)); if (Array.isArray(v)) return new Set(v); } catch { /* default */ }
    return new Set(MODULES.map((m) => m.key)); // all open by default
  },
  saveOpenGroups(set) { localStorage.setItem(LS.groups, JSON.stringify([...set])); },

  renderLayout(activeRoute, title) {
    const open = this.openGroups();
    open.add(ROUTE_MODULE[activeRoute]?.key); // keep the active module open

    // Build hierarchical nav for permitted modules/items.
    const groups = MODULES.map((m) => {
      const items = m.items.filter((it) => this.can(it.permission));
      if (!items.length) return '';
      const isOpen = open.has(m.key);
      const links = items.map((it) => `
        <a href="#/${it.route}" class="nav-item ${it.route === activeRoute ? 'active' : ''}" title="${UI.esc(t(it.label))}">
          ${svg(it.icon)}<span class="lbl">${UI.esc(t(it.label))}</span>
        </a>`).join('');
      return `
        <div class="nav-group ${isOpen ? 'open' : ''}" data-key="${m.key}">
          <button class="nav-group-head" title="${UI.esc(t(m.label))}">
            ${svg(m.icon)}<span class="lbl">${UI.esc(t(m.label))}</span>${svg('chevron-right', 'chev')}
          </button>
          <div class="nav-group-body">${links}</div>
        </div>`;
    }).join('');

    // Standalone Home (launchpad) link above the module groups.
    const homeLink = `
      <a href="#/home" class="nav-item nav-home ${activeRoute === 'home' ? 'active' : ''}" title="${t('Home')}">
        ${svg('home')}<span class="lbl">${t('Home')}</span>
      </a>`;

    // Breadcrumbs: Home / Module / Page.
    const mod = ROUTE_MODULE[activeRoute];
    const crumbs = [`<a href="#/home" class="crumb">${t('Home')}</a>`];
    if (mod) crumbs.push(`<span class="crumb muted">${UI.esc(t(mod.label))}</span>`);
    if (activeRoute !== 'home') crumbs.push(`<span class="crumb current">${UI.esc(t(title))}</span>`);
    else crumbs[0] = `<span class="crumb current">${t('Home')}</span>`;

    const initials = (this.user.name || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

    document.getElementById('app').innerHTML = `
      <a href="#page-content" class="skip-link">${t('Skip to content')}</a>
      <div class="layout" id="layout">
        <aside class="sidebar" id="sidebar" aria-label="${t('Main navigation')}">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true">▦</span><span class="brand-name">WMS</span>
            <button class="rail-toggle" id="sidebar-close" title="${t('Close')}" aria-label="${t('Close')}">${svg('x')}</button>
          </div>
          <button class="nav-search" id="nav-search">${svg('search')}<span class="lbl">${t('Search')}…</span><kbd>/</kbd></button>
          <nav class="nav-tree" aria-label="${t('Modules')}"><div class="nav-top">${homeLink}</div>${groups}</nav>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="left">
              <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">${svg('menu')}</button>
              <nav class="breadcrumbs" aria-label="Breadcrumb">${crumbs.join(`<span class="sep">${svg('chevron-right')}</span>`)}</nav>
            </div>
            <div class="right">
              <button class="icon-btn" id="topbar-search" aria-label="${t('Search')}">${svg('search')}</button>
              ${this.can('notifications') ? `<a class="icon-btn" id="topbar-bell" href="#/notifications" aria-label="${t('Notifications')}">${svg('bell')}</a>` : ''}
              <button class="icon-btn" id="theme-toggle" aria-label="${t('Theme')}">${svg(Theme.current === 'dark' ? 'sun' : 'moon')}</button>
              <select id="lang-select" class="lang-select" title="${UI.esc(t('Language'))}">
                <option value="en" ${Lang.current === 'en' ? 'selected' : ''}>EN</option>
                <option value="ar" ${Lang.current === 'ar' ? 'selected' : ''}>عربي</option>
                <option value="fr" ${Lang.current === 'fr' ? 'selected' : ''}>FR</option>
              </select>
              <div class="user-menu">
                <button class="user-trigger" id="user-trigger">
                  <span class="avatar">${UI.esc(initials)}</span>
                  <span class="user-meta"><span class="user-name">${UI.esc(this.user.name)}</span><span class="user-role">${UI.esc(this.user.role)}</span></span>
                </button>
                <div class="user-dropdown" id="user-dropdown" hidden>
                  <div class="ud-head"><span class="avatar lg">${UI.esc(initials)}</span><div><div class="user-name">${UI.esc(this.user.name)}</div><div class="user-role">${UI.esc(this.user.email || this.user.role)}</div></div></div>
                  <button class="ud-item" id="menu-change-pw">${svg('key')}<span>${t('Change password')}</span></button>
                  <button class="ud-item danger" id="menu-logout">${svg('log-out')}<span>${t('Sign out')}</span></button>
                </div>
              </div>
            </div>
          </header>
          <main class="content" id="main-content" role="main"><div id="page-content" tabindex="-1"><div class="loading">${t('Loading…')}</div></div></main>
        </div>
      </div>`;

    this.wireLayout(activeRoute);
  },

  wireLayout(activeRoute) {
    const layout = document.getElementById('layout');
    const sidebar = document.getElementById('sidebar');

    // The sidebar is an off-canvas drawer, hidden until the menu button is
    // pressed (at every screen width) so the content gets full width.
    const closeDrawer = () => { layout.classList.remove('nav-open'); document.querySelector('.scrim')?.remove(); document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false'); };
    const openDrawer = () => {
      layout.classList.add('nav-open');
      document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'true');
      if (!document.querySelector('.scrim')) {
        const scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.addEventListener('click', closeDrawer);
        layout.appendChild(scrim);
      }
    };
    document.getElementById('menu-toggle').addEventListener('click', () => {
      layout.classList.contains('nav-open') ? closeDrawer() : openDrawer();
    });
    document.getElementById('sidebar-close').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

    // Collapsible groups — persisted.
    sidebar.querySelectorAll('.nav-group-head').forEach((head) => {
      head.addEventListener('click', () => {
        const group = head.closest('.nav-group');
        group.classList.toggle('open');
        const set = new Set([...sidebar.querySelectorAll('.nav-group.open')].map((g) => g.dataset.key));
        this.saveOpenGroups(set);
      });
    });

    // Selecting a destination closes the drawer.
    sidebar.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', closeDrawer));

    // Topbar controls.
    document.getElementById('theme-toggle').addEventListener('click', () => Theme.toggle());
    document.getElementById('lang-select').addEventListener('change', (e) => Lang.set(e.target.value));
    document.getElementById('nav-search').addEventListener('click', () => this.openSearch());
    document.getElementById('topbar-search').addEventListener('click', () => this.openSearch());

    // User menu dropdown.
    const trigger = document.getElementById('user-trigger');
    const dropdown = document.getElementById('user-dropdown');
    trigger.addEventListener('click', (e) => { e.stopPropagation(); dropdown.hidden = !dropdown.hidden; });
    document.addEventListener('click', (e) => { if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== trigger) dropdown.hidden = true; });
    document.getElementById('menu-logout').addEventListener('click', () => this.logout());
    document.getElementById('menu-change-pw').addEventListener('click', () => { dropdown.hidden = true; this.openChangePassword(); });

    // Global shortcuts: "/" or Ctrl/Cmd+K opens search.
    if (!this._shortcuts) {
      this._shortcuts = true;
      document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
        if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
          e.preventDefault(); this.openSearch();
        }
      });
    }
  },

  // --- Global command-palette search ---------------------------------------
  openSearch() {
    let overlay = document.getElementById('cmd-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cmd-overlay';
      overlay.className = 'cmd-overlay';
      overlay.innerHTML = `
        <div class="cmd-panel" role="dialog" aria-modal="true">
          <div class="cmd-input-row">${svg('search')}<input id="cmd-input" type="text" placeholder="${t('Jump to…')}" autocomplete="off"></div>
          <div class="cmd-results" id="cmd-results"></div>
        </div>`;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeSearch(); });
      document.body.appendChild(overlay);
    }
    overlay.classList.add('show');
    const input = document.getElementById('cmd-input');
    input.value = '';
    this._cmdActive = 0;
    this.renderSearch('');
    input.focus();
    input.oninput = () => { this._cmdActive = 0; this.renderSearch(input.value); };
    input.onkeydown = (e) => {
      const rows = [...document.querySelectorAll('#cmd-results .cmd-row')];
      if (e.key === 'Escape') return this.closeSearch();
      if (e.key === 'ArrowDown') { e.preventDefault(); this._cmdActive = Math.min(this._cmdActive + 1, rows.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._cmdActive = Math.max(this._cmdActive - 1, 0); }
      else if (e.key === 'Enter') { rows[this._cmdActive]?.click(); return; }
      rows.forEach((r, i) => r.classList.toggle('active', i === this._cmdActive));
      rows[this._cmdActive]?.scrollIntoView({ block: 'nearest' });
    };
  },
  closeSearch() { document.getElementById('cmd-overlay')?.classList.remove('show'); },
  renderSearch(q) {
    const query = q.trim().toLowerCase();
    const results = NAV_ITEMS
      .filter((it) => this.can(it.permission))
      .filter((it) => !query || t(it.label).toLowerCase().includes(query) || t(it.module.label).toLowerCase().includes(query))
      .slice(0, 12);
    const box = document.getElementById('cmd-results');
    if (!results.length) { box.innerHTML = `<div class="cmd-empty">${t('No matches')}</div>`; return; }
    box.innerHTML = results.map((it, i) => `
      <a href="#/${it.route}" class="cmd-row ${i === 0 ? 'active' : ''}">
        ${svg(it.icon)}<span class="cmd-label">${UI.esc(t(it.label))}</span>
        <span class="cmd-module">${UI.esc(t(it.module.label))}</span>
      </a>`).join('');
    box.querySelectorAll('.cmd-row').forEach((row) => row.addEventListener('click', () => this.closeSearch()));
  },

  // --- Change my password (reuses UI.modal) --------------------------------
  openChangePassword() {
    UI.modal({
      title: t('Change password'),
      submitLabel: t('Update password'),
      bodyHtml: `
        <div class="form-group"><label>${t('Current password')}</label><input type="password" id="cp-current"></div>
        <div class="form-group"><label>${t('New password')}</label><input type="password" id="cp-new"><div class="hint">${t('At least 8 characters.')}</div></div>
        <div class="form-group"><label>${t('Confirm new password')}</label><input type="password" id="cp-confirm"></div>`,
      onSubmit: async (overlay, close) => {
        const cur = overlay.querySelector('#cp-current').value;
        const nw = overlay.querySelector('#cp-new').value;
        const cf = overlay.querySelector('#cp-confirm').value;
        if (!cur || !nw) return UI.toast(t('Fill in all fields.'), 'error');
        if (nw.length < 8) return UI.toast(t('At least 8 characters.'), 'error');
        if (nw !== cf) return UI.toast(t('Passwords do not match.'), 'error');
        try {
          await Api.patch('/api/auth/password', { current_password: cur, new_password: nw });
          UI.toast(t('Password changed.'));
          close();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};

// Exposed for the Home launchpad (Pages.home) so it can render the same
// permission-filtered module/item model and icon set as the sidebar.
App.modules = MODULES;
App.icon = svg;

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
