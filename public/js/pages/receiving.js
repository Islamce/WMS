/** Goods Receipt & QR generation, plus QR label printing. */
window.Pages = window.Pages || {};

Pages.receiving = {
  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    // Steps are role-gated: receive (warehouse), GR # (store ERP operator),
    // bin (picker/dispatcher). Users only see the tabs they may perform.
    const tabs = [];
    if (App.can('goods_receipt')) tabs.push(['receive', '1 · Receive']);
    if (App.can(['erp_operator', 'goods_receipt'])) tabs.push(['gr', '2 · Assign GR #']);
    if (App.can(['picking', 'goods_receipt'])) tabs.push(['bin', '3 · Assign Bin']);
    if (!tabs.length) { el.innerHTML = '<div class="inline-alert error">No receiving steps available for your role.</div>'; return; }

    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          ${tabs.map(([k, label], i) => `<button class="btn ${i ? 'secondary ' : ''}sm" data-tab="${k}">${label}</button>`).join('')}
        </div>
      </div>
      <div id="gr-tab"></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.className = 'btn secondary sm');
      b.className = 'btn sm';
      this.tab(b.dataset.tab);
    }));
    this.tab(tabs[0][0]);
  },

  tab(name) {
    if (name === 'receive') return this.renderReceive();
    if (name === 'gr') return this.renderPendingGr();
    if (name === 'bin') return this.renderPendingBin();
  },

  // --- Step 1: receive ------------------------------------------------------
  renderReceive() {
    const box = this.el.querySelector('#gr-tab');
    box.innerHTML = `
      <div class="card" style="max-width:820px">
        <h3>Goods Receipt from Supplier</h3>
        <p class="muted">Batch number is generated automatically. GR number and bin location are assigned in the next steps.</p>
        <form id="gr-form" novalidate>
          <div class="form-group autocomplete"><label>Material *</label>
            <input type="text" id="gr-material" placeholder="Click to browse or type to search…" autocomplete="off"></div>
          <div class="form-row">
            <div class="form-group"><label>PO Number * (mandatory)</label><input type="text" id="gr-po"></div>
            <div class="form-group"><label>Received Quantity *</label><input type="number" id="gr-qty" min="0" step="any"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Warehouse *</label>
              <select id="gr-wh">${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}">${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Bin Location (optional — can be assigned later)</label>
              <select id="gr-bin"><option value="">— assign later —</option></select></div>
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
          <div class="inline-alert" style="background:var(--warning-bg);color:var(--warning)">
            🔬 Received batches go on <strong>Quality Hold</strong> automatically. Only the Quality team can
            release them for issue (Quality screen → Pending Inspection).</div>
          <button type="submit" class="btn success block">Receive &amp; Generate QR</button>
        </form>
      </div>
      <div id="gr-result"></div>`;

    this.selected = null;
    UI.materialAutocomplete(box.querySelector('#gr-material'), (m) => { this.selected = m; });
    box.querySelector('#gr-form').addEventListener('submit', (e) => { e.preventDefault(); this.receive(); });

    // Bin dropdown follows the selected warehouse (compact codes only).
    const whSel = box.querySelector('#gr-wh');
    const binSel = box.querySelector('#gr-bin');
    const loadBins = async () => {
      binSel.innerHTML = '<option value="">— assign later —</option>';
      try {
        const { bins } = await Api.get(`/api/meta/warehouses/${encodeURIComponent(whSel.value)}/bins`);
        binSel.innerHTML += bins.map((x) =>
          `<option value="${UI.esc(x.bin_code)}">${UI.esc(x.bin_code)}${x.zone ? ` · ${UI.esc(x.zone)}` : ''}</option>`).join('');
      } catch { /* bins are optional here */ }
    };
    whSel.addEventListener('change', loadBins);
    loadBins();
  },

  async receive() {
    if (!this.selected) return UI.toast('Select a material from the list.', 'error');
    const box = this.el.querySelector('#gr-tab');
    const payload = {
      material_id: this.selected.id,
      received_quantity: Number(box.querySelector('#gr-qty').value), warehouse_code: box.querySelector('#gr-wh').value,
      po_number: box.querySelector('#gr-po').value, supplier_code: box.querySelector('#gr-supcode').value,
      supplier_name: box.querySelector('#gr-supname').value, manufacturing_date: box.querySelector('#gr-mfg').value || null,
      expiry_date: box.querySelector('#gr-exp').value || null, shelf_life_period: box.querySelector('#gr-slp').value || null,
      shelf_life_unit: box.querySelector('#gr-slu').value,
      bin_location: box.querySelector('#gr-bin').value || null,
    };
    try {
      const { qr, batch_number, warehouse_code, bin_location } = await Api.post('/api/receiving', payload);
      UI.toast(`Received. Batch ${batch_number} + QR generated.`);
      box.querySelector('#gr-result').innerHTML = `<div class="card">
        <h3>Batch ${UI.esc(batch_number)}</h3>
        <div class="details-list">
          <div class="item"><div class="k">Warehouse</div><div class="v">${UI.esc(warehouse_code || '')}</div></div>
          <div class="item"><div class="k">Bin Location</div><div class="v">${bin_location
            ? `<strong>${UI.esc(bin_location)}</strong>`
            : '<span class="badge OUT">not assigned — use step 3 · Assign Bin</span>'}</div></div>
        </div>
        ${Pages.qrPrinting.qrCard(qr)}</div>`;
      const btn = box.querySelector('#gr-result [data-print]');
      if (btn) btn.addEventListener('click', () => Pages.qrPrinting.print(btn.dataset.print));
      box.querySelector('#gr-form').reset();
      this.selected = null;
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  // --- Step 2: assign GR number (store ERP operator) ------------------------
  async renderPendingGr() {
    const box = this.el.querySelector('#gr-tab');
    box.innerHTML = '<div class="card"><h3>Assign GR Number</h3><div id="gr-pending"><div class="loading">Loading…</div></div></div>';
    const { batches } = await Api.get('/api/receiving/pending-gr');
    box.querySelector('#gr-pending').innerHTML = `
      <p class="muted">Received batches awaiting the ERP GR document number.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Batch</th><th>Material</th><th>PO</th><th>WH</th><th class="text-right">Qty</th><th style="width:220px">GR Number</th></tr></thead>
        <tbody>${batches.map((b) => `
          <tr><td><strong>${UI.esc(b.batch_number)}</strong></td><td>${UI.esc(b.material_code)}</td>
            <td>${UI.esc(b.po_number || '')}</td><td>${UI.esc(b.warehouse_code || '')}</td>
            <td class="text-right">${UI.fmtQty(b.received_quantity)}</td>
            <td><div style="display:flex;gap:6px"><input type="text" class="gr-num" data-id="${b.id}" placeholder="GR document #">
              <button class="btn sm" data-savegr="${b.id}">Save</button></div></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">Nothing awaiting a GR number 🎉</td></tr>'}
        </tbody></table></div>`;
    box.querySelectorAll('[data-savegr]').forEach((btn) => btn.addEventListener('click', async () => {
      const inp = box.querySelector(`.gr-num[data-id="${btn.dataset.savegr}"]`);
      try { const { message } = await Api.patch(`/api/receiving/batches/${btn.dataset.savegr}/gr`, { gr_number: inp.value });
        UI.toast(message); this.renderPendingGr(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  },

  // --- Step 3: assign bin (picker / dispatcher) -----------------------------
  async renderPendingBin() {
    const box = this.el.querySelector('#gr-tab');
    box.innerHTML = '<div class="card"><h3>Assign Bin Location</h3><div id="gr-pbin"><div class="loading">Loading…</div></div></div>';
    const { batches } = await Api.get('/api/receiving/pending-bin');
    // Preload bins per warehouse for the dropdowns.
    const whCodes = [...new Set(batches.map((b) => b.warehouse_code))];
    const binsByWh = {};
    for (const wh of whCodes) {
      try { const { bins } = await Api.get(`/api/meta/warehouses/${wh}/bins`); binsByWh[wh] = bins; }
      catch { binsByWh[wh] = []; }
    }
    box.querySelector('#gr-pbin').innerHTML = `
      <p class="muted">Batches with stock but no bin yet — assigned by the picker / dispatcher.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Batch</th><th>Material</th><th>WH</th><th class="text-right">Qty</th><th style="width:280px">Bin Location</th></tr></thead>
        <tbody>${batches.map((b) => `
          <tr><td><strong>${UI.esc(b.batch_number)}</strong></td><td>${UI.esc(b.material_code)}</td>
            <td>${UI.esc(b.warehouse_code || '')}</td><td class="text-right">${UI.fmtQty(b.remaining_quantity)}</td>
            <td><div style="display:flex;gap:6px">
              <select class="bin-sel" data-id="${b.id}">
                <option value="">Select bin…</option>
                ${(binsByWh[b.warehouse_code] || []).map((x) => `<option value="${UI.esc(x.bin_code)}">${UI.esc(x.bin_code)}${x.zone ? ` · ${UI.esc(x.zone)}` : ''}</option>`).join('')}
              </select>
              <button class="btn sm" data-savebin="${b.id}">Save</button></div></td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">Nothing awaiting a bin 🎉</td></tr>'}
        </tbody></table></div>`;
    box.querySelectorAll('[data-savebin]').forEach((btn) => btn.addEventListener('click', async () => {
      const sel = box.querySelector(`.bin-sel[data-id="${btn.dataset.savebin}"]`);
      if (!sel.value) return UI.toast('Select a bin.', 'error');
      try { const { message } = await Api.patch(`/api/receiving/batches/${btn.dataset.savebin}/bin`, { bin_location: sel.value });
        UI.toast(message); this.renderPendingBin(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  },
};

Pages.qrPrinting = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card">
        <div class="toolbar"><h3 class="mb-0">QR Label Printing</h3><div class="spacer"></div>
          <input type="text" class="search-input" id="qr-search" placeholder="Search material / batch / QR…">
          <button class="btn sm" id="qr-pdf-all">📄 PDF — all shown</button></div>
        <div id="qr-list"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#qr-search').addEventListener('input', UI.debounce((e) => this.load(e.target.value), 300));
    el.querySelector('#qr-pdf-all').addEventListener('click', () => {
      if (!this.shownIds || !this.shownIds.length) return UI.toast('No labels to print.', 'error');
      this.pdf(this.shownIds);
    });
    await this.load('');
  },

  async load(q) {
    const { qr_codes } = await Api.get(`/api/receiving/qr?search=${encodeURIComponent(q || '')}`);
    this.shownIds = qr_codes.map((x) => x.id);
    this.el.querySelector('#qr-list').innerHTML =
      qr_codes.map((qr) => this.qrCard(qr)).join('') || '<p class="muted">No QR codes.</p>';
    this.el.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => this.print(b.dataset.print)));
    this.el.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => this.pdf([Number(b.dataset.pdf)])));
  },

  /** Download/open a printable PDF for one or more labels (auth-safe blob). */
  async pdf(ids) {
    try {
      const blob = await Api.blob(`/api/receiving/qr/pdf?ids=${ids.join(',')}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank') || (() => {   // popup blocked -> download
        const a = document.createElement('a');
        a.href = url; a.download = 'qr-labels.pdf'; a.click();
      })();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      UI.toast(`PDF generated for ${ids.length} label(s).`);
      if (this.el.querySelector('#qr-list')) this.load(this.el.querySelector('#qr-search').value);
    } catch (err) { UI.toast(err.message, 'error'); }
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
          ${App.can('qr_printing') ? `
            <div style="margin-top:8px;display:flex;gap:6px">
              <button class="btn sm" data-pdf="${qr.id}">📄 PDF label</button>
              <button class="btn secondary sm" data-print="${qr.id}">🖨️ Mark printed</button>
            </div>` : ''}
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
