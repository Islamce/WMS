/**
 * Users Management (admin): list/filter users, approve/reject/disable,
 * change role, edit per-user screen permissions.
 */
window.Pages = window.Pages || {};

Pages.users = {
  state: { status: '' },
  roles: [],

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <select id="u-filter" style="max-width:200px">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="rejected">Rejected</option>
            <option value="disabled">Disabled</option>
          </select>
          <div class="spacer"></div>
        </div>
        <div class="table-wrap" id="u-table"><div class="loading">Loading…</div></div>
      </div>`;

    const filter = el.querySelector('#u-filter');
    filter.value = this.state.status;
    filter.addEventListener('change', () => {
      this.state.status = filter.value;
      this.load();
    });

    try {
      ({ roles: this.roles } = await Api.get('/api/users/roles'));
    } catch (err) { UI.toast(err.message, 'error'); }

    await this.load();
  },

  async load() {
    const tableEl = this.el.querySelector('#u-table');
    try {
      const url = this.state.status ? `/api/users?status=${this.state.status}` : '/api/users';
      const { users } = await Api.get(url);
      tableEl.innerHTML = `
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th style="min-width:320px">Actions</th></tr></thead>
          <tbody>
            ${users.map((u) => this.rowHtml(u)).join('') ||
              '<tr><td colspan="6" class="muted">No users found</td></tr>'}
          </tbody>
        </table>`;

      tableEl.querySelectorAll('[data-action]').forEach((b) => {
        b.addEventListener('click', () => this.action(b.dataset.action, Number(b.dataset.id), b.dataset.name));
      });
      tableEl.querySelectorAll('select[data-role-user]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            const { message } = await Api.patch(`/api/users/${sel.dataset.roleUser}/role`, { role_id: Number(sel.value) });
            UI.toast(message);
          } catch (err) {
            UI.toast(err.message, 'error');
            this.load();
          }
        });
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
    }
  },

  rowHtml(u) {
    const isSelf = u.id === App.user.id;
    const roleSelect = isSelf
      ? `<span class="badge role">${UI.esc(u.role)}</span>`
      : `<select data-role-user="${u.id}" style="max-width:120px">
          ${this.roles.map((r) => `<option value="${r.id}" ${r.id === u.role_id ? 'selected' : ''}>${UI.esc(r.name)}</option>`).join('')}
        </select>`;

    let actions = '';
    if (!isSelf) {
      if (u.status === 'pending') {
        actions += `<button class="btn success sm" data-action="active" data-id="${u.id}">Approve</button>
                    <button class="btn danger sm" data-action="rejected" data-id="${u.id}">Reject</button> `;
      }
      if (u.status === 'active') {
        actions += `<button class="btn danger sm" data-action="disabled" data-id="${u.id}">Disable</button> `;
      }
      if (u.status === 'disabled' || u.status === 'rejected') {
        actions += `<button class="btn success sm" data-action="active" data-id="${u.id}">Activate</button> `;
      }
      actions += `<button class="btn secondary sm" data-action="permissions" data-id="${u.id}" data-name="${UI.esc(u.name)}">Permissions</button> `;
      actions += `<button class="btn secondary sm" data-action="reset-pw" data-id="${u.id}" data-name="${UI.esc(u.name)}">Reset password</button>`;
    } else {
      actions = '<span class="muted">This is you</span>';
    }

    return `
      <tr>
        <td><strong>${UI.esc(u.name)}</strong></td>
        <td>${UI.esc(u.email)}</td>
        <td>${roleSelect}</td>
        <td><span class="badge ${u.status}">${u.status}</span></td>
        <td>${UI.fmtDate(u.created_at)}</td>
        <td>${actions}</td>
      </tr>`;
  },

  async action(action, userId, userName) {
    if (action === 'permissions') return this.openPermissions(userId, userName);
    if (action === 'reset-pw') return this.openResetPassword(userId, userName);
    try {
      const { message } = await Api.patch(`/api/users/${userId}/status`, { status: action });
      UI.toast(message);
      this.load();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  },

  openResetPassword(userId, userName) {
    UI.modal({
      title: `Reset password — ${userName}`,
      submitLabel: 'Reset password',
      bodyHtml: `
        <p class="muted" style="margin-bottom:12px">Set a new password for this user. They can change it themselves afterwards.</p>
        <div class="form-group"><label>New password</label><input type="password" id="rp-new"><div class="hint">At least 8 characters.</div></div>
        <div class="form-group"><label>Confirm new password</label><input type="password" id="rp-confirm"></div>`,
      onSubmit: async (overlay, close) => {
        const nw = overlay.querySelector('#rp-new').value;
        const cf = overlay.querySelector('#rp-confirm').value;
        if (nw.length < 8) return UI.toast('Password must be at least 8 characters.', 'error');
        if (nw !== cf) return UI.toast('Passwords do not match.', 'error');
        try {
          const { message } = await Api.patch(`/api/users/${userId}/password`, { new_password: nw });
          UI.toast(message);
          close();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  async openPermissions(userId, userName) {
    let permissions;
    try {
      ({ permissions } = await Api.get(`/api/users/${userId}/permissions`));
    } catch (err) { return UI.toast(err.message, 'error'); }

    UI.modal({
      title: `Screen permissions — ${userName}`,
      wide: true,
      submitLabel: 'Save permissions',
      bodyHtml: `
        <p class="muted" style="margin-bottom:12px">
          Checked screens are granted directly to this user. Permissions inherited
          from the user's role are marked and always apply.
        </p>
        <div class="perm-grid">
          ${permissions.map((p) => `
            <label class="perm-item">
              <input type="checkbox" value="${p.id}" ${p.direct ? 'checked' : ''} />
              <span>${UI.esc(p.label)}
                ${p.from_role ? '<div class="via-role">✓ via role</div>' : ''}
              </span>
            </label>`).join('')}
        </div>`,
      onSubmit: async (overlay, close) => {
        const ids = [...overlay.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
        try {
          const { message } = await Api.put(`/api/users/${userId}/permissions`, { permission_ids: ids });
          UI.toast(message);
          close();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};
