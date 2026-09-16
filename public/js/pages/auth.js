/**
 * Login page.
 *
 * Self-registration used to live here too. It was unauthenticated on a public
 * host and the role it assigned could remove stock, so it is gone: an
 * administrator creates accounts in Users Management.
 */
window.Pages = window.Pages || {};

Pages.auth = {
  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <img class="logo-mark" src="/img/kynox-mark.png" alt="KYNOX" />
          <div class="logo">KYNOX WMS</div>
          <p class="subtitle">Warehouse Management System</p>
          <div id="auth-alert"></div>
          <form id="login-form" novalidate>
            <div class="form-group">
              <label for="li-email">Email</label>
              <input type="email" id="li-email" required autocomplete="email" />
            </div>
            <div class="form-group">
              <label for="li-password">Password</label>
              <input type="password" id="li-password" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn block">Login</button>
          </form>
          <div class="switch muted">Need an account? Ask your administrator to create one.</div>
        </div>
      </div>`;
    document.getElementById('login-form').addEventListener('submit', (e) => this.login(e));
  },

  alert(message, type = 'error') {
    document.getElementById('auth-alert').innerHTML =
      `<div class="inline-alert ${type}">${UI.esc(message)}</div>`;
  },

  async login(e) {
    e.preventDefault();
    const email = document.getElementById('li-email').value.trim();
    const password = document.getElementById('li-password').value;
    if (!email || !password) return this.alert('Email and password are required.');
    try {
      const { token, user, tenant } = await Api.post('/api/auth/login', { email, password });
      Api.setToken(token);
      App.user = user;
      // The edition decides which modules exist for this organisation, so it has
      // to be in place before defaultRoute() picks a landing screen below.
      App.tenant = tenant || null;
      // Changing the hash triggers routing via the hashchange event; only
      // route directly when the hash is already the target (no event fires).
      const target = `#/${App.defaultRoute() || ''}`;
      if (location.hash === target) App.route();
      else location.hash = target;
    } catch (err) {
      this.alert(err.message);
    }
  },
};
