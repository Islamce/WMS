/** Goods Receipt & QR generation, plus QR label printing. */
window.Pages = window.Pages || {};

Pages.receiving = {
  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    el.innerHTML = `
      <div class="card" style="max-width:820px">
        <h3>Goods Receipt from Supplier</h3>
        <form id="gr-form" novalidate>
          <div class="form-group autocomplete"><label>Material *</label>
            <input type="text" id="gr-material" placeholder="Search item code / description…" autocomplete="off"></div>
          <div class="form-row">
            <div class="form-group"><label>Batch Number * (mandatory)</label><input type="text" id="gr-batch"></div>
            <div class="form-group"><label>Received Quantity *</label><input type="number" id="gr-qty" min="0" step="any"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Warehouse *</label>
              <select id="gr-wh">${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}">${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Bin Location</label><input type="text" id="gr-bin" placeholder="e.g. R-03-02-23"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>PO Number</label><input type="text" id="gr-po"></div>
            <div class="form-group"><label>GR Number</label><input type="text" id="gr-gr"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Supplier Code</label><input type="text" id="gr-supcode"></div>
            <div class="form-group"><label>Supplier Name</label><input type="text" id="gr-supname"></div>
          </div>
          <h3 style="margin-top:8px">Shelf life (for expiry-managed materials)</h3>
          <div class="form-row">
            <div class="form-group"><label>Manufacturing Date</label><input type="date" id="gr-mfg"></div>
            <div class="form-group"><label>Expiry Date (or leave blank to auto-calc)</label><input type="date" id="gr-exp"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Shelf Life Period</label><input type="number" id="gr-slp" min="0"></div>
            <div class="form-group"><label>Shelf Life Unit</label>
              <select id="gr-slu"><option>MONTHS</option><option>DAYS</option><option>YEARS</option></select></div>
          </div>
          <div class="form-group"><label>Quality Status</label>
            <select id="gr-quality"><option>RELEASED</option><option>QUALITY_HOLD</option><option>BLOCKED</option></select></div>
          <button type="submit" class="btn success block">Receive & Generate QR</button>
        </form>
      </div>
      <div id="gr-result"></div>`;

    this.selected = null;
    UI.materialAutocomplete(el.querySelector('#gr-material'), (m) => { this.selected = m; });
    el.querySelector('#gr-form').addEventListener('submit', (e) => { e.preventDefault(); this.receive(); });
  },

  async receive() {
    if (!this.selected) return UI.toast('Select a material.', 'error');
    const el = this.el;
    const payload = {
      material_id: this.selected.id, batch_number: el.querySelector('#gr-batch').value,
      received_quantity: Number(el.querySelector('#gr-qty').value), warehouse_code: el.querySelector('#gr-wh').value,
      bin_location: el.querySelector('#gr-bin').value, po_number: el.querySelector('#gr-po').value,
      gr_number: el.querySelector('#gr-gr').value, supplier_code: el.querySelector('#gr-supcode').value,
      supplier_name: el.querySelector('#gr-supname').value, manufacturing_date: el.querySelector('#gr-mfg').value || null,
      expiry_date: el.querySelector('#gr-exp').value || null, shelf_life_period: el.querySelector('#gr-slp').value || null,
      shelf_life_unit: el.querySelector('#gr-slu').value, quality_status: el.querySelector('#gr-quality').value,
    };
    try {
      const { qr } = await Api.post('/api/receiving', payload);
      UI.toast('Goods received; QR generated.');
      el.querySelector('#gr-result').innerHTML = Pages.qrPrinting.qrCard(qr);
      const btn = el.querySelector('#gr-result [data-print]');
      if (btn) btn.addEventListener('click', () => Pages.qrPrinting.print(btn.dataset.print));
    } catch (err) { UI.toast(err.message, 'error'); }
  },
};

Pages.qrPrinting = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card">
        <div class="toolbar"><h3 class="mb-0">QR Label Printing</h3><div class="spacer"></div>
          <input type="text" class="search-input" id="qr-search" placeholder="Search material / batch / QR…"></div>
        <div id="qr-list"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#qr-search').addEventListener('input', UI.debounce((e) => this.load(e.target.value), 300));
    await this.load('');
  },

  async load(q) {
    const { qr_codes } = await Api.get(`/api/receiving/qr?search=${encodeURIComponent(q || '')}`);
    this.el.querySelector('#qr-list').innerHTML =
      qr_codes.map((qr) => this.qrCard(qr)).join('') || '<p class="muted">No QR codes.</p>';
    this.el.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => this.print(b.dataset.print)));
  },

  qrCard(qr) {
    // Simple visual QR stand-in (grid) + full traceability data.
    return `
      <div class="card" style="display:flex;gap:16px;align-items:flex-start">
        <div class="qr-visual" title="${UI.esc(qr.qr_code_value)}"></div>
        <div style="flex:1">
          <strong>${UI.esc(qr.material_code)} — ${UI.esc(qr.material_description || '')}</strong>
          <div class="details-list" style="margin-top:8px">
            <div class="item"><div class="k">QR Value</div><div class="v" style="font-size:12px">${UI.esc(qr.qr_code_value)}</div></div>
            <div class="item"><div class="k">Batch</div><div class="v">${UI.esc(qr.batch_number || '—')}</div></div>
            <div class="item"><div class="k">Warehouse / Bin</div><div class="v">${UI.esc(qr.warehouse_code || '')} / ${UI.esc(qr.bin_location || '—')}</div></div>
            <div class="item"><div class="k">Qty</div><div class="v">${UI.fmtQty(qr.remaining_quantity)} ${UI.esc(qr.uom || '')}</div></div>
            <div class="item"><div class="k">PO / GR</div><div class="v">${UI.esc(qr.po_number || '—')} / ${UI.esc(qr.gr_number || '—')}</div></div>
            <div class="item"><div class="k">Expiry</div><div class="v">${qr.expiry_date || '—'}</div></div>
            <div class="item"><div class="k">Quality</div><div class="v">${UI.esc(qr.quality_status || '')}</div></div>
            <div class="item"><div class="k">Prints</div><div class="v">${qr.print_count}</div></div>
          </div>
          ${App.can('qr_printing') ? `<button class="btn secondary sm" data-print="${qr.id}" style="margin-top:8px">🖨️ Print / Reprint</button>` : ''}
        </div>
      </div>`;
  },

  async print(id) {
    try { const { print_count } = await Api.post(`/api/receiving/qr/${id}/print`, {});
      UI.toast(`Printed (count ${print_count}).`);
      if (this.el.querySelector('#qr-list')) this.load(this.el.querySelector('#qr-search').value); }
    catch (err) { UI.toast(err.message, 'error'); }
  },
};
