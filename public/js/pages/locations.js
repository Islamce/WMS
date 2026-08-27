/** Locations management: searchable paginated table + add/edit/delete. */
window.Pages = window.Pages || {};

Pages.locations = {
  state: { page: 1, search: '' },

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="loc-search" placeholder="Search location code…"
                 value="${UI.esc(this.state.search)}" />
          <div class="spacer"></div>
          <button class="btn" id="loc-add">+ Add Location</button>
        </div>
        <div class="table-wrap" id="loc-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="loc-pagination"></div>
      </div>`;

    el.querySelector('#loc-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value;
      this.state.page = 1;
      this.load();
    }, 300));
    el.querySelector('#loc-add').addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const { page, search } = this.state;
    const tableEl = this.el.querySelector('#loc-table');
    try {
      const data = await Api.get(`/api/locations?page=${page}&limit=10&search=${encodeURIComponent(search)}`);
      tableEl.innerHTML = `
        <table>
          <thead><tr><th>ID</th><th>Code</th><th class="text-right">Total Stock</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${data.locations.map((l) => `
              <tr>
                <td>${l.id}</td>
                <td><span class="chip">${UI.esc(l.code)}</span></td>
                <td class="text-right">${UI.fmtQty(l.total_stock)}</td>
                <td>${UI.fmtDate(l.created_at)}</td>
                <td>
                  <button class="btn secondary sm" data-edit="${l.id}" data-code="${UI.esc(l.code)}">Edit</button>
                  <button class="btn danger sm" data-del="${l.id}" data-code="${UI.esc(l.code)}">Delete</button>
                </td>
              </tr>`).join('') || `<tr><td colspan="5">${UI.meaningfulEmptyState({ title: this.state.search ? 'No locations match this search' : 'No locations yet', description: this.state.search ? 'Try a different search term.' : 'Add a location to get started.', actionHtml: this.state.search ? '' : '<button class="btn secondary sm" id="loc-empty-add" style="margin-top:8px">+ Add Location</button>' })}</td></tr>`}
          </tbody>
        </table>`;

      tableEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        this.openForm({ id: Number(b.dataset.edit), code: b.dataset.code });
      }));
      tableEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        UI.confirm(`Delete location ${b.dataset.code}? This is only possible if it has no stock or transactions.`, async () => {
          try {
            const { message } = await Api.delete(`/api/locations/${b.dataset.del}`);
            UI.toast(message);
            this.load();
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }));

      tableEl.querySelector('#loc-empty-add')?.addEventListener('click', () => this.openForm());
      UI.pagination(this.el.querySelector('#loc-pagination'), data, (p) => {
        this.state.page = p;
        this.load();
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
    }
  },

  openForm(loc) {
    UI.modal({
      title: loc ? `Edit location ${loc.code}` : 'Add location',
      bodyHtml: `
        <div class="form-group">
          <label>Location code *</label>
          <input type="text" id="f-loc-code" required value="${UI.esc(loc ? loc.code : '')}" placeholder="e.g. A-01-03" />
          <div class="hint">Must be unique.</div>
        </div>`,
      onSubmit: async (overlay, close) => {
        const code = overlay.querySelector('#f-loc-code').value;
        try {
          const { message } = loc
            ? await Api.put(`/api/locations/${loc.id}`, { code })
            : await Api.post('/api/locations', { code });
          UI.toast(message);
          close();
          this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};
