/** Materials management: searchable paginated table + add/edit/delete. */
window.Pages = window.Pages || {};

Pages.materials = {
  state: { page: 1, search: '' },

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="mat-search" placeholder="Search code, description, group…"
                 value="${UI.esc(this.state.search)}" />
          <div class="spacer"></div>
          <span id="mat-export"></span>
          <button class="btn secondary" id="mat-upload">⬆ Mass Upload</button>
          <button class="btn" id="mat-add">+ Add Material</button>
        </div>
        <div class="table-wrap" id="mat-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="mat-pagination"></div>
      </div>`;

    el.querySelector('#mat-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value;
      this.state.page = 1;
      this.load();
    }, 300));
    el.querySelector('#mat-export').appendChild(UI.exportControl({
      filename: 'materials', title: 'Materials',
      // Export the full filtered list (not just the current page).
      rows: async () => (await Api.get(`/api/materials?page=1&limit=5000&search=${encodeURIComponent(this.state.search)}`)).materials,
      columns: [
        { key: 'item_code', label: 'Item Code' }, { key: 'description', label: 'Description' },
        { key: 'unit', label: 'Unit' }, { key: 'material_type', label: 'Type' },
        { key: 'material_group', label: 'Group' }, { key: 'plant', label: 'Plant' },
        { key: 'price', label: 'Price' }, { key: 'currency', label: 'Currency' },
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
    const { page, search } = this.state;
    const tableEl = this.el.querySelector('#mat-table');
    try {
      const data = await Api.get(`/api/materials?page=${page}&limit=10&search=${encodeURIComponent(search)}`);
      tableEl.innerHTML = `
        <table>
          <thead><tr>
            <th>Plant</th><th>Item Code</th><th>Description</th><th>Unit</th>
            <th class="text-right">Price</th><th>Currency</th><th>Type</th><th>Group</th>
            <th class="text-right">Stock</th><th></th>
          </tr></thead>
          <tbody>
            ${data.materials.map((m) => `
              <tr>
                <td>${UI.esc(m.plant)}</td>
                <td><strong>${UI.esc(m.item_code)}</strong>${m.is_stock_item === 0 ? ' <span class="badge OUT" title="Non-stock item — no reservations/allocations">non-stock</span>' : ''}</td>
                <td class="wrap">${UI.esc(m.description)}</td>
                <td>${UI.esc(m.unit)}</td>
                <td class="text-right">${Number(m.price).toFixed(2)}</td>
                <td>${UI.esc(m.currency)}</td>
                <td>${UI.esc(m.material_type)}</td>
                <td>${UI.esc(m.material_group)}</td>
                <td class="text-right">${UI.fmtQty(m.total_stock)}</td>
                <td>
                  <button class="btn secondary sm" data-edit="${m.id}">Edit</button>
                  <button class="btn danger sm" data-del="${m.id}" data-code="${UI.esc(m.item_code)}">Delete</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="10" class="muted">No materials found</td></tr>'}
          </tbody>
        </table>`;

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
