/**
 * App shell: session handling, hash router, sidebar/topbar layout,
 * permission-based menu visibility.
 *
 * To add a new screen: create public/js/pages/<name>.js registering
 * Pages.<name>, add a MENU entry with its permission key, seed the
 * permission key in server/db/seed.js and protect its API routes.
 */
window.Pages = window.Pages || {};

const MENU = [
  { section: 'General' },
  { route: 'dashboard', label: 'Dashboard', icon: '📊', permission: 'dashboard' },
  { route: 'kpi', label: 'KPI Dashboard', icon: '📈', permission: 'kpi_dashboard' },
  { route: 'ai', label: 'AI Stock Analytics', icon: '🤖', permission: 'ai_analytics' },
  { route: 'notifications', label: 'Notifications', icon: '🔔', permission: 'notifications' },
  { section: 'Material Requests' },
  { route: 'create-request', label: 'Create Request', icon: '📝', permission: 'create_request' },
  { route: 'requests', label: 'Requests', icon: '📋', permission: 'material_requests' },
  { route: 'approvals', label: 'Approvals', icon: '✅', permission: 'approvals' },
  { route: 'erp-operator', label: 'ERP Operator', icon: '🔗', permission: 'erp_operator' },
  { section: 'Warehouse Execution' },
  { route: 'warehouse', label: 'Warehouse Dashboard', icon: '🏭', permission: 'warehouse_dashboard' },
  { route: 'allocation', label: 'Bin & Batch Assign', icon: '🧭', permission: 'bin_batch_assignment' },
  { route: 'picker-assign', label: 'Picker Assignment', icon: '🧑‍🏭', permission: 'picker_assignment' },
  { route: 'picking', label: 'My Picking Tasks', icon: '📲', permission: 'picking' },
  { route: 'gi-posting', label: 'Goods Issue Posting', icon: '📦', permission: 'gi_posting' },
  { section: 'Receiving & Quality' },
  { route: 'receiving', label: 'Goods Receipt & QR', icon: '📥', permission: ['goods_receipt', 'erp_operator', 'picking'] },
  { route: 'qr-printing', label: 'QR Label Printing', icon: '🏷️', permission: 'qr_printing' },
  { route: 'batches', label: 'Batch Tracking', icon: '🧫', permission: 'batch_tracking' },
  { route: 'expiry', label: 'Expiry Alerts', icon: '⏰', permission: 'expiry_alerts' },
  { route: 'quality', label: 'Quality', icon: '🔬', permission: 'quality' },
  { section: 'Inventory' },
  // Stock In = Goods Receipt, Stock Out = Goods Issuance (handled by the
  // warehouse workflow above), so the basic stock screens are retired.
  { route: 'all-locations', label: 'All Locations', icon: '🗺️', permission: 'all_locations' },
  { route: 'empty-locations', label: 'Empty Locations', icon: '🕳️', permission: 'empty_locations' },
  { section: 'Master Data' },
  { route: 'materials', label: 'Materials', icon: '📦', permission: 'materials' },
  { route: 'locations', label: 'Locations', icon: '📍', permission: 'locations' },
  { route: 'warehouses-master', label: 'Warehouses', icon: '🏬', permission: 'warehouses_master' },
  { route: 'bins-master', label: 'Bin Locations', icon: '🗄️', permission: 'bins_master' },
  { route: 'movement-types', label: 'Movement Types', icon: '↔️', permission: 'movement_types_master' },
  { section: 'Administration' },
  { route: 'audit', label: 'Audit Trail', icon: '📜', permission: 'audit_trail' },
  { route: 'users', label: 'Users Management', icon: '👥', permission: 'users_management' },
  { route: 'permissions', label: 'Permissions', icon: '🔐', permission: 'permissions_management' },
];

const ROUTE_PAGES = {
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
  // Receiving hosts three steps: receive (goods_receipt), GR number
  // (erp_operator), and bin assignment (picking) — any of them may open it.
  'receiving': { title: 'Goods Receipt & QR', page: 'receiving', permission: ['goods_receipt', 'erp_operator', 'picking'] },
  'qr-printing': { title: 'QR Label Printing', page: 'qrPrinting', permission: 'qr_printing' },
  'batches': { title: 'Batch Tracking', page: 'batches', permission: 'batch_tracking' },
  'expiry': { title: 'Expiry Alerts', page: 'expiry', permission: 'expiry_alerts' },
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
  'audit': { title: 'Audit Trail', page: 'audit', permission: 'audit_trail' },
  'users': { title: 'Users Management', page: 'users', permission: 'users_management' },
  'permissions': { title: 'Permissions Management', page: 'permissions', permission: 'permissions_management' },
};

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

  onSessionExpired() {
    this.user = null;
    this.route();
  },

  logout() {
    Api.setToken(null);
    this.user = null;
    location.hash = '#/login';
  },

  /** First allowed route for this user (used after login / bad routes). */
  defaultRoute() {
    const entry = Object.entries(ROUTE_PAGES).find(([, def]) => this.can(def.permission));
    return entry ? entry[0] : null;
  },

  route() {
    const raw = location.hash.replace(/^#\//, '') || '';
    // Support "route/param" (e.g. request-detail/5).
    const [hash, param] = raw.split('/');

    if (!this.user) {
      if (hash === 'signup') return Pages.auth.render('signup');
      return Pages.auth.render('login');
    }

    let routeKey = hash;
    let def = ROUTE_PAGES[hash];
    if (!def || !this.can(def.permission)) {
      const fallback = this.defaultRoute();
      if (!fallback) return this.renderNoAccess();
      if (hash !== fallback) { location.hash = `#/${fallback}`; return; }
      routeKey = fallback;
      def = ROUTE_PAGES[fallback];
    }

    // Highlight the base menu entry even for detail sub-routes.
    const activeMenu = routeKey === 'request-detail' ? 'requests' : routeKey;
    this.renderLayout(activeMenu, def.title);
    Pages[def.page].render(document.getElementById('page-content'), param);
    this.refreshNotificationBadge();
  },

  /** Poll unread notification count and reflect it in the sidebar. */
  async refreshNotificationBadge() {
    if (!this.can('notifications')) return;
    try {
      const { unread } = await Api.get('/api/notifications/unread-count');
      const link = document.querySelector('.sidebar nav a[href="#/notifications"]');
      if (link) {
        let badge = link.querySelector('.notif-badge');
        if (unread > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'notif-badge'; link.appendChild(badge); }
          badge.textContent = unread;
        } else if (badge) { badge.remove(); }
      }
    } catch { /* ignore */ }
  },

  renderNoAccess() {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="logo">📦 WMS</div>
        <p class="subtitle">Your account has no screen permissions yet.<br>Ask an administrator to grant you access.</p>
        <button class="btn block" id="no-access-logout">Back to login</button>
      </div></div>`;
    document.getElementById('no-access-logout').addEventListener('click', () => App.logout());
  },

  renderLayout(activeRoute, title) {
    // Menu items are filtered by permission; sections with no visible
    // items are dropped.
    const items = [];
    let pendingSection = null;
    MENU.forEach((entry) => {
      if (entry.section) { pendingSection = entry.section; return; }
      if (!this.can(entry.permission)) return;
      if (pendingSection) { items.push(`<div class="section">${UI.esc(t(pendingSection))}</div>`); pendingSection = null; }
      items.push(`
        <a href="#/${entry.route}" class="${entry.route === activeRoute ? 'active' : ''}">
          <span>${entry.icon}</span> ${UI.esc(t(entry.label))}
        </a>`);
    });

    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="brand">📦 WMS</div>
          <nav>${items.join('')}</nav>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="left">
              <button class="menu-toggle" id="menu-toggle" aria-label="Toggle menu">☰</button>
              <span class="page-title">${UI.esc(t(title))}</span>
            </div>
            <div class="user-box">
              <div class="pref-controls">
                <select id="lang-select" title="${UI.esc(t('Language'))}">
                  <option value="en" ${Lang.current === 'en' ? 'selected' : ''}>EN</option>
                  <option value="ar" ${Lang.current === 'ar' ? 'selected' : ''}>عربي</option>
                  <option value="fr" ${Lang.current === 'fr' ? 'selected' : ''}>FR</option>
                </select>
                <button class="theme-btn" id="theme-toggle" title="${UI.esc(t('Theme'))}">${Theme.current === 'dark' ? '☀️' : '🌙'}</button>
              </div>
              <div>
                <div class="user-name">${UI.esc(this.user.name)}</div>
                <div class="user-role">${UI.esc(this.user.role)}</div>
              </div>
              <button class="btn secondary sm" id="logout-btn">${UI.esc(t('Logout'))}</button>
            </div>
          </header>
          <main class="content" id="page-content">
            <div class="loading">Loading…</div>
          </main>
        </div>
      </div>`;

    document.getElementById('logout-btn').addEventListener('click', () => this.logout());
    document.getElementById('lang-select').addEventListener('change', (e) => Lang.set(e.target.value));
    document.getElementById('theme-toggle').addEventListener('click', () => Theme.toggle());

    // Mobile/tablet sidebar toggle with backdrop.
    const sidebar = document.getElementById('sidebar');
    document.getElementById('menu-toggle').addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (sidebar.classList.contains('open')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        backdrop.addEventListener('click', () => { sidebar.classList.remove('open'); backdrop.remove(); });
        document.querySelector('.layout').appendChild(backdrop);
      } else {
        document.querySelector('.sidebar-backdrop')?.remove();
      }
    });
    sidebar.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', () => {
      sidebar.classList.remove('open');
      document.querySelector('.sidebar-backdrop')?.remove();
    }));
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
