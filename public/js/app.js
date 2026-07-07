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
  { section: 'Warehouse' },
  { route: 'stock-in', label: 'Stock In', icon: '📥', permission: 'stock_in' },
  { route: 'stock-out', label: 'Stock Out', icon: '📤', permission: 'stock_out' },
  { route: 'all-locations', label: 'All Locations', icon: '🗺️', permission: 'all_locations' },
  { route: 'empty-locations', label: 'Empty Locations', icon: '🕳️', permission: 'empty_locations' },
  { section: 'Master Data' },
  { route: 'materials', label: 'Materials', icon: '📦', permission: 'materials' },
  { route: 'locations', label: 'Locations', icon: '📍', permission: 'locations' },
  { section: 'Administration' },
  { route: 'users', label: 'Users Management', icon: '👥', permission: 'users_management' },
  { route: 'permissions', label: 'Permissions', icon: '🔐', permission: 'permissions_management' },
];

const ROUTE_PAGES = {
  'dashboard': { title: 'Dashboard', page: 'dashboard', permission: 'dashboard' },
  'stock-in': { title: 'Stock In', page: 'stockin', permission: 'stock_in' },
  'stock-out': { title: 'Stock Out', page: 'stockout', permission: 'stock_out' },
  'all-locations': { title: 'All Locations', page: 'alllocations', permission: 'all_locations' },
  'empty-locations': { title: 'Empty Locations', page: 'emptylocations', permission: 'empty_locations' },
  'materials': { title: 'Materials', page: 'materials', permission: 'materials' },
  'locations': { title: 'Locations', page: 'locations', permission: 'locations' },
  'users': { title: 'Users Management', page: 'users', permission: 'users_management' },
  'permissions': { title: 'Permissions Management', page: 'permissions', permission: 'permissions_management' },
};

const App = {
  user: null,

  can(permission) {
    if (!this.user) return false;
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
    const hash = location.hash.replace(/^#\//, '') || '';

    if (!this.user) {
      if (hash === 'signup') return Pages.auth.render('signup');
      return Pages.auth.render('login');
    }

    let def = ROUTE_PAGES[hash];
    if (!def || !this.can(def.permission)) {
      const fallback = this.defaultRoute();
      if (!fallback) return this.renderNoAccess();
      if (hash !== fallback) { location.hash = `#/${fallback}`; return; }
      def = ROUTE_PAGES[fallback];
    }

    this.renderLayout(hash, def.title);
    Pages[def.page].render(document.getElementById('page-content'));
  },

  renderNoAccess() {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="logo">📦 WMS</div>
        <p class="subtitle">Your account has no screen permissions yet.<br>Ask an administrator to grant you access.</p>
        <button class="btn block" onclick="App.logout()">Back to login</button>
      </div></div>`;
  },

  renderLayout(activeRoute, title) {
    // Menu items are filtered by permission; sections with no visible
    // items are dropped.
    const items = [];
    let pendingSection = null;
    MENU.forEach((entry) => {
      if (entry.section) { pendingSection = entry.section; return; }
      if (!this.can(entry.permission)) return;
      if (pendingSection) { items.push(`<div class="section">${UI.esc(pendingSection)}</div>`); pendingSection = null; }
      items.push(`
        <a href="#/${entry.route}" class="${entry.route === activeRoute ? 'active' : ''}">
          <span>${entry.icon}</span> ${UI.esc(entry.label)}
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
              <span class="page-title">${UI.esc(title)}</span>
            </div>
            <div class="user-box">
              <div>
                <div class="user-name">${UI.esc(this.user.name)}</div>
                <div class="user-role">${UI.esc(this.user.role)}</div>
              </div>
              <button class="btn secondary sm" id="logout-btn">Logout</button>
            </div>
          </header>
          <main class="content" id="page-content">
            <div class="loading">Loading…</div>
          </main>
        </div>
      </div>`;

    document.getElementById('logout-btn').addEventListener('click', () => this.logout());

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
