/** Login and Signup pages. */
window.Pages = window.Pages || {};

Pages.auth = {
  render(mode) {
    const app = document.getElementById('app');
    if (mode === 'signup') {
      app.innerHTML = `
        <div class="auth-wrap">
          <div class="auth-card">
            <div class="logo">📦 WMS</div>
            <p class="subtitle">Create your account</p>
            <div id="auth-alert"></div>
            <form id="signup-form" novalidate>
              <div class="form-group">
                <label for="su-name">Full name</label>
                <input type="text" id="su-name" required autocomplete="name" />
              </div>
              <div class="form-group">
                <label for="su-email">Email</label>
                <input type="email" id="su-email" required autocomplete="email" />
              </div>
              <div class="form-group">
                <label for="su-password">Password</label>
                <input type="password" id="su-password" required minlength="8" autocomplete="new-password" />
                <div class="hint">At least 8 characters.</div>
              </div>
              <button type="submit" class="btn block">Sign up</button>
            </form>
            <div class="switch">Already have an account? <a href="#/login">Login</a></div>
          </div>
        </div>`;
      document.getElementById('signup-form').addEventListener('submit', (e) => this.signup(e));
    } else {
      app.innerHTML = `
        <div class="auth-wrap">
          <div class="auth-card">
            <div class="logo">📦 WMS</div>
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
            <div class="switch">No account yet? <a href="#/signup">Sign up</a></div>
          </div>
        </div>`;
      document.getElementById('login-form').addEventListener('submit', (e) => this.login(e));
    }
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
      const { token, user } = await Api.post('/api/auth/login', { email, password });
      Api.setToken(token);
      App.user = user;
      // Changing the hash triggers routing via the hashchange event; only
      // route directly when the hash is already the target (no event fires).
      const target = `#/${App.defaultRoute() || ''}`;
      if (location.hash === target) App.route();
      else location.hash = target;
    } catch (err) {
      this.alert(err.message);
    }
  },

  async signup(e) {
    e.preventDefault();
    const name = document.getElementById('su-name').value.trim();
    const email = document.getElementById('su-email').value.trim();
    const password = document.getElementById('su-password').value;
    if (!name || !email) return this.alert('Name and email are required.');
    if (password.length < 8) return this.alert('Password must be at least 8 characters.');
    try {
      const { message } = await Api.post('/api/auth/signup', { name, email, password });
      this.alert(message, 'success');
      document.getElementById('signup-form').reset();
    } catch (err) {
      this.alert(err.message);
    }
  },
};
