/**
 * Permissions Management (admin): view all permission keys and edit the
 * default permission set of each role. Per-user overrides are managed
 * from the Users Management screen.
 */
window.Pages = window.Pages || {};

Pages.permissions = {
  async render(el) {
    el.innerHTML = '<div class="loading">Loading permissions…</div>';
    let permissions, roles;
    try {
      ({ permissions } = await Api.get('/api/permissions'));
      ({ roles } = await Api.get('/api/permissions/roles'));
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
        <h3>Screen permission keys</h3>
        <p class="muted" style="margin-bottom:12px">
          Every screen in the system is protected by one of these keys, on both
          the menu (frontend) and the API (backend).
        </p>
        <div class="table-wrap"><table>
          <thead><tr><th>Key</th><th>Screen</th></tr></thead>
          <tbody>
            ${permissions.map((p) => `<tr><td><code>${UI.esc(p.key)}</code></td><td>${UI.esc(p.label)}</td></tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      ${roles.map((role) => `
        <div class="card" data-role="${role.id}">
          <h3>Role: ${UI.esc(role.name)} <span class="muted" style="font-weight:400">— ${UI.esc(role.description || '')}</span></h3>
          ${role.name === 'admin'
            ? '<p class="muted">The admin role always has full access to every screen.</p>'
            : `
            <div class="perm-grid" style="margin-bottom:14px">
              ${permissions.map((p) => `
                <label class="perm-item">
                  <input type="checkbox" value="${p.id}" ${role.permission_ids.includes(p.id) ? 'checked' : ''} />
                  <span>${UI.esc(p.label)}</span>
                </label>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <button class="btn" data-save="${role.id}" disabled>Save role permissions</button>
              <span class="muted sm" data-dirty-note="${role.id}" style="display:none">Unsaved changes</span>
            </div>`}
        </div>`).join('')}`;

    // Unsaved-change feedback: Save stays disabled until a checkbox actually
    // changes from its loaded state, so it's never a no-op click.
    el.querySelectorAll('.card[data-role]').forEach((card) => {
      const roleId = card.dataset.role;
      const saveBtn = card.querySelector(`[data-save="${roleId}"]`);
      const dirtyNote = card.querySelector(`[data-dirty-note="${roleId}"]`);
      if (!saveBtn) return;
      card.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.addEventListener('change', () => {
          saveBtn.disabled = false;
          dirtyNote.style.display = '';
        });
      });
    });

    el.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = el.querySelector(`.card[data-role="${btn.dataset.save}"]`);
        const dirtyNote = card.querySelector(`[data-dirty-note="${btn.dataset.save}"]`);
        const ids = [...card.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
        btn.disabled = true;
        try {
          const { message } = await Api.put(`/api/permissions/roles/${btn.dataset.save}`, { permission_ids: ids });
          UI.toast(message);
          if (dirtyNote) dirtyNote.style.display = 'none';
        } catch (err) {
          UI.toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  },
};
