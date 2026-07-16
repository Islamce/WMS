/** Stock Reallocation — move batch stock between warehouses / bins / projects
 *  with full movement history. Partial quantities split the batch. */
window.Pages = window.Pages || {};

Pages.reallocation = {
  state: { page: 1, search: '' },

  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${t('Stock Reallocation')}</h3>
          <div class="spacer"></div>
          <button class="btn" id="ra-new">+ ${t('New reallocation')}</button>
        </div>
        <p class="muted" style="margin-top:6px">${t('Move stock between warehouses, bins and projects. Reserved stock never moves; partial moves split the batch with a new QR label.')}</p>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="ra-search" placeholder="${t('Search reallocation #, material, batch…')}">
        </div>
        <div class="table-wrap" id="ra-table"><div class="loading">${t('Loading…')}</div></div>
        <div class="pagination" id="ra-pagination"></div>
      </div>`;
    el.querySelector('#ra-new').addEventListener('click', () => this.openForm());
    el.querySelector('#ra-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value; this.state.page = 1; this.load();
    }, 300));
    await this.load();
  },

  async load() {
    const box = this.el.querySelector('#ra-table');
    const data = await Api.get(`/api/reallocation?page=${this.state.page}&search=${encodeURIComponent(this.state.search)}`);
    box.innerHTML = `<table>
      <thead><tr><th>#</th><th>Material</th><th>Batch</th><th class="text-right">Qty</th>
        <th>From</th><th>To</th><th>Project</th><th>By</th><th>When</th></tr></thead>
      <tbody>${data.moves.map((m) => `
        <tr>
          <td><strong>${UI.esc(m.realloc_number)}</strong></td>
          <td>${UI.esc(m.material_code || '')}</td><td>${UI.esc(m.batch_number || '')}</td>
          <td class="text-right">${UI.fmtQty(m.quantity)}</td>
          <td>${UI.esc(m.from_warehouse || '')} / ${UI.esc(m.from_bin || '—')}</td>
          <td>${UI.esc(m.to_warehouse || '')} / ${UI.esc(m.to_bin || '—')}</td>
          <td>${UI.esc(m.to_project || '—')}</td>
          <td>${UI.esc(m.moved_by_name || '')}</td><td>${UI.fmtDate(m.created_at)}</td>
        </tr>`).join('') || `<tr><td colspan="9" class="muted">${t('No reallocations yet')}</td></tr>`}
      </tbody></table>`;
    UI.pagination(this.el.querySelector('#ra-pagination'), data, (p) => { this.state.page = p; this.load(); });
  },

  openForm() {
    let batch = null;
    UI.modal({
      title: t('New reallocation'), wide: true, submitLabel: t('Move stock'),
      bodyHtml: `
        <div class="form-group"><label>${t('Batch (search by number or material)')}</label>
          <input type="text" id="ra-batch" placeholder="${t('Type to search…')}" autocomplete="off">
          <div id="ra-batch-list"></div>
          <div class="hint" id="ra-batch-info"></div></div>
        <div class="form-row">
          <div class="form-group"><label>${t('Quantity to move')} *</label><input type="number" id="ra-qty" min="0" step="any"></div>
          <div class="form-group"><label>${t('Target warehouse')} *</label>
            <select id="ra-wh">${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}">${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${t('Target bin')}</label><select id="ra-bin"><option value="">${t('No bin / assign later')}</option></select></div>
          <div class="form-group"><label>${t('Project / WBS')}</label><input type="text" id="ra-project" placeholder="${t('Optional')}"></div>
        </div>
        <div class="form-group"><label>${t('Reason')}</label><input type="text" id="ra-reason"></div>`,
      onSubmit: async (ov, close) => {
        if (!batch) return UI.toast(t('Pick a batch first.'), 'error');
        try {
          const r = await Api.post('/api/reallocation', {
            batch_id: batch.id,
            quantity: Number(ov.querySelector('#ra-qty').value),
            to_warehouse: ov.querySelector('#ra-wh').value,
            to_bin: ov.querySelector('#ra-bin').value,
            to_project: ov.querySelector('#ra-project').value,
            reason: ov.querySelector('#ra-reason').value,
          });
          UI.toast(r.message); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });

    const ov = document.querySelector('.modal-overlay');
    const input = ov.querySelector('#ra-batch');
    const list = ov.querySelector('#ra-batch-list');
    const info = ov.querySelector('#ra-batch-info');
    const whSel = ov.querySelector('#ra-wh');
    const binSel = ov.querySelector('#ra-bin');

    const loadBins = async () => {
      const { bins } = await Api.get(`/api/meta/warehouses/${whSel.value}/bins`).catch(() => ({ bins: [] }));
      binSel.innerHTML = `<option value="">${t('No bin / assign later')}</option>`
        + bins.map((b) => `<option value="${UI.esc(b.bin_code)}">${UI.esc(b.bin_code)}</option>`).join('');
    };
    whSel.addEventListener('change', loadBins);
    loadBins();

    const search = UI.debounce(async () => {
      const q = input.value.trim();
      if (!q) { list.innerHTML = ''; return; }
      const { batches } = await Api.get(`/api/master/batches?search=${encodeURIComponent(q)}&limit=8`).catch(() => ({ batches: [] }));
      list.innerHTML = batches.map((b) => `
        <button type="button" class="btn secondary sm" style="margin:3px 3px 0 0" data-pick="${b.id}">
          ${UI.esc(b.batch_number)} · ${UI.esc(b.material_code)} · ${UI.fmtQty(b.remaining_quantity)} @ ${UI.esc(b.warehouse_code)}/${UI.esc(b.bin_location || '—')}
        </button>`).join('') || `<span class="muted">${t('No matching batches')}</span>`;
      list.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => {
        batch = batches.find((b) => b.id === Number(btn.dataset.pick));
        input.value = `${batch.batch_number} — ${batch.material_code}`;
        const movable = batch.remaining_quantity - (batch.reserved_quantity || 0);
        info.textContent = `${t('On hand')}: ${UI.fmtQty(batch.remaining_quantity)} · ${t('Reserved')}: ${UI.fmtQty(batch.reserved_quantity || 0)} · ${t('Movable')}: ${UI.fmtQty(movable)} — ${batch.warehouse_code}/${batch.bin_location || '—'}`;
        ov.querySelector('#ra-qty').value = movable;
        list.innerHTML = '';
      }));
    }, 250);
    input.addEventListener('input', search);
  },
};
