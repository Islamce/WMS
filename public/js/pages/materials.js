/** Materials management: searchable paginated table + add/edit/delete. */
window.Pages = window.Pages || {};

Pages.materials = {
  state: { page: 1, search: '', group: '', type: '', stock: '', sort: 'item_code', dir: 'asc' },

  query() {
    const s = this.state;
    return `page=${s.page}&search=${encodeURIComponent(s.search)}&group=${encodeURIComponent(s.group)}`
      + `&type=${encodeURIComponent(s.type)}&stock=${encodeURIComponent(s.stock)}&sort=${s.sort}&dir=${s.dir}`;
  },

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="mat-search" placeholder="Search code, description, group…"
                 value="${UI.esc(this.state.search)}" />
          <select id="mat-f-group" aria-label="Filter by group"><option value="">All groups</option></select>
          <select id="mat-f-type" aria-label="Filter by type"><option value="">All types</option></select>
          <select id="mat-f-stock" aria-label="Filter by stock">
            <option value="">All stock</option>
            <option value="in" ${this.state.stock === 'in' ? 'selected' : ''}>In stock</option>
            <option value="out" ${this.state.stock === 'out' ? 'selected' : ''}>Out of stock</option>
            <option value="low" ${this.state.stock === 'low' ? 'selected' : ''}>Fully reserved</option>
          </select>
          <span class="muted" id="mat-count" aria-live="polite"></span>
          <div class="spacer"></div>
          <span id="mat-export"></span>
          <button class="btn secondary" id="mat-upload">⬆ Mass Upload</button>
          <button class="btn" id="mat-add">+ Add Material</button>
        </div>
        <p class="muted" style="margin:4px 0 8px">Stock is live: goods receipts, issues, counts and reallocations update it automatically. Click a column header to sort.</p>
        <div class="table-wrap" id="mat-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="mat-pagination"></div>
      </div>`;

    el.querySelector('#mat-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value;
      this.state.page = 1;
      this.load();
    }, 300));
    ['group', 'type', 'stock'].forEach((f) => {
      el.querySelector(`#mat-f-${f}`).addEventListener('change', (e) => {
        this.state[f] = e.target.value;
        this.state.page = 1;
        this.load();
      });
    });
    el.querySelector('#mat-export').appendChild(UI.exportControl({
      filename: 'materials', title: 'Materials',
      // Export the full filtered list (not just the current page).
      rows: async () => (await Api.get(`/api/materials?limit=100&${this.query().replace(/page=\d+/, 'page=1')}`)).materials,
      columns: [
        { key: 'item_code', label: 'Item Code' }, { key: 'description', label: 'Description' },
        { key: 'unit', label: 'Unit' }, { key: 'material_type', label: 'Type' },
        { key: 'material_group', label: 'Group' }, { key: 'plant', label: 'Plant' },
        { key: 'price', label: 'Price' }, { key: 'currency', label: 'Currency' },
        { key: 'total_stock', label: 'Stock' }, { key: 'available_stock', label: 'Available' },
      ],
    }));
    el.querySelector('#mat-add').addEventListener('click', () => this.openForm());
    el.querySelector('#mat-upload').addEventListener('click', () => UI.csvUploadModal({
      title: 'Mass upload materials (CSV)',
      headersHint: 'plant,item_code,description,unit,price,currency,material_type,material_group',
      example: 'plant,item_code,description,unit,price,currency,material_type,material_group\nP100,MAT-0500,Hex Bolt M10,EA,0.5,USD,RAW,FASTENERS',
      onUpload: async (rows) => {
        const r = await Api.post('/api/materials/bulk', { rows });
        this.load();
        return r;
      },
    }));

    await this.load();
  },

  async load() {
    const tableEl = this.el.querySelector('#mat-table');
    const th = (key, label, cls = '') => {
      const active = this.state.sort === key;
      const arrow = active ? (this.state.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="sortable ${cls}" data-sort="${key}" role="button" tabindex="0" aria-sort="${active ? (this.state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}${arrow}</th>`;
    };
    try {
      const data = await Api.get(`/api/materials?limit=10&${this.query()}`);
      const countEl = this.el.querySelector('#mat-count');
      if (countEl) countEl.textContent = data.total != null ? `${UI.fmtQty(data.total)} material${data.total === 1 ? '' : 's'}` : '';

      // Populate the filter dropdowns once (values come from the server).
      const gSel = this.el.querySelector('#mat-f-group');
      if (data.filters && gSel.options.length === 1) {
        data.filters.groups.forEach((g) => gSel.add(new Option(g, g, false, g === this.state.group)));
        const tSel = this.el.querySelector('#mat-f-type');
        data.filters.types.forEach((v) => tSel.add(new Option(v, v, false, v === this.state.type)));
      }

      tableEl.innerHTML = data.materials.length ? `
        <table>
          <thead><tr>
            ${th('plant', 'Plant')}${th('item_code', 'Item Code')}${th('description', 'Description')}${th('unit', 'Unit')}
            ${th('price', 'Price', 'text-right')}<th>Currency</th>${th('material_type', 'Type')}${th('material_group', 'Group')}
            ${th('total_stock', 'Stock', 'text-right')}${th('available_stock', 'Available', 'text-right')}<th></th>
          </tr></thead>
          <tbody>
            ${data.materials.map((m) => `
              <tr>
                <td>${UI.esc(m.plant)}</td>
                <td><span class="chip">${UI.esc(m.item_code)}</span>${m.is_stock_item === 0 ? ' <span class="badge OUT" title="Non-stock item — no reservations/allocations">non-stock</span>' : ''}</td>
                <td class="wrap">${UI.esc(m.description)}</td>
                <td>${UI.esc(m.unit)}</td>
                <td class="text-right">${Number(m.price).toFixed(2)}</td>
                <td>${UI.esc(m.currency)}</td>
                <td>${UI.esc(m.material_type)}</td>
                <td>${UI.esc(m.material_group)}</td>
                <td class="text-right">${UI.fmtQty(m.total_stock)}</td>
                <td class="text-right">${UI.fmtQty(m.available_stock)}${Number(m.reserved_stock) > 0 ? ` <span class="muted" title="Reserved for open picks">(${UI.fmtQty(m.reserved_stock)} res.)</span>` : ''}</td>
                <td>
                  <button class="btn secondary sm" data-edit="${m.id}">Edit</button>
                  <button class="btn danger sm" data-del="${m.id}" data-code="${UI.esc(m.item_code)}">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : UI.meaningfulEmptyState({
        title: (this.state.search || this.state.group || this.state.type || this.state.stock) ? 'No materials match these filters' : 'No materials yet',
        description: (this.state.search || this.state.group || this.state.type || this.state.stock) ? 'Try a different search term or clear a filter.' : 'Add a material or import a master-data file to get started.',
        actionHtml: '<button class="btn secondary sm" id="mat-empty-add" style="margin-top:8px">+ Add Material</button>',
      });
      tableEl.querySelector('#mat-empty-add')?.addEventListener('click', () => this.openForm());

      // Header click / Enter toggles server-side sorting.
      tableEl.querySelectorAll('th.sortable').forEach((h) => {
        const apply = () => {
          const key = h.dataset.sort;
          this.state.dir = this.state.sort === key && this.state.dir === 'asc' ? 'desc' : 'asc';
          this.state.sort = key;
          this.state.page = 1;
          this.load();
        };
        h.addEventListener('click', apply);
        h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
      });

      tableEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const material = data.materials.find((m) => m.id === Number(b.dataset.edit));
        this.openForm(material);
      }));
      tableEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        UI.confirm(`Delete material ${b.dataset.code}? This is only possible if it has no stock or transactions.`, async () => {
          try {
            const { message } = await Api.delete(`/api/materials/${b.dataset.del}`);
            UI.toast(message);
            this.load();
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }));

      UI.pagination(this.el.querySelector('#mat-pagination'), data, (p) => {
        this.state.page = p;
        this.load();
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
    }
  },

  openForm(material) {
    const m = material || {};
    UI.modal({
      title: material ? `Edit material ${m.item_code}` : 'Add material',
      wide: true,
      bodyHtml: `
        <div class="form-row">
          <div class="form-group"><label>Plant</label><input type="text" id="f-plant" value="${UI.esc(m.plant || '')}" /></div>
          <div class="form-group"><label>Item Code *</label><input type="text" id="f-code" required value="${UI.esc(m.item_code || '')}" /></div>
        </div>
        <div class="form-group"><label>Description *</label><input type="text" id="f-desc" required value="${UI.esc(m.description || '')}" /></div>
        <div class="form-row">
          <div class="form-group"><label>Unit *</label><input type="text" id="f-unit" required value="${UI.esc(m.unit || 'EA')}" /></div>
          <div class="form-group"><label>Price</label><input type="number" id="f-price" min="0" step="0.01" value="${m.price ?? 0}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Currency</label><input type="text" id="f-currency" value="${UI.esc(m.currency || 'USD')}" /></div>
          <div class="form-group"><label>Material Type</label><input type="text" id="f-type" value="${UI.esc(m.material_type || '')}" /></div>
        </div>
        <div class="form-group"><label>Material Group</label><input type="text" id="f-group" value="${UI.esc(m.material_group || '')}" /></div>
        <label class="perm-item"><input type="checkbox" id="f-stock" ${m.is_stock_item === 0 ? '' : 'checked'}>
          <span>Stock item — <span class="muted">untick for non-stock items (services / direct purchases): they can be requested but never receive an ERP reservation or warehouse allocation</span></span></label>`,
      onSubmit: async (overlay, close) => {
        const payload = {
          plant: overlay.querySelector('#f-plant').value,
          item_code: overlay.querySelector('#f-code').value,
          description: overlay.querySelector('#f-desc').value,
          unit: overlay.querySelector('#f-unit').value,
          price: overlay.querySelector('#f-price').value,
          currency: overlay.querySelector('#f-currency').value,
          material_type: overlay.querySelector('#f-type').value,
          material_group: overlay.querySelector('#f-group').value,
          is_stock_item: overlay.querySelector('#f-stock').checked ? 1 : 0,
        };
        try {
          const { message } = material
            ? await Api.put(`/api/materials/${m.id}`, payload)
            : await Api.post('/api/materials', payload);
          UI.toast(message);
          close();
          this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};
