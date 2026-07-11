/** Batch tracking, expiry alerts, quality, and master-data screens. */
window.Pages = window.Pages || {};

const ALERT_BADGE = { EXPIRED: 'OUT', NEAR_EXPIRY: 'OUT', CRITICAL: 'pending', EARLY_WARNING: 'pending', OK: 'active' };

Pages.batches = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card">
      <div class="toolbar"><h3 class="mb-0">Batch Tracking</h3><div class="spacer"></div>
        <input type="text" class="search-input" id="bt-search" placeholder="Search batch / material / warehouse…"></div>
      <div class="table-wrap" id="bt-table"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#bt-search').addEventListener('input', UI.debounce((e) => this.load(e.target.value), 300));
    await this.load('');
  },
  async load(q) {
    const { batches } = await Api.get(`/api/master/batches?search=${encodeURIComponent(q || '')}`);
    this.el.querySelector('#bt-table').innerHTML = `
      <table><thead><tr><th>Batch</th><th>Material</th><th>WH / Bin</th><th class="text-right">On hand</th>
        <th class="text-right">Reserved</th><th class="text-right">Available</th><th>Expiry</th><th>Quality</th><th>Alert</th></tr></thead>
      <tbody>${batches.map((b) => `
        <tr><td><strong>${UI.esc(b.batch_number)}</strong></td><td>${UI.esc(b.material_code)}</td>
          <td>${UI.esc(b.warehouse_code || '')} / ${UI.esc(b.bin_location || '—')}</td>
          <td class="text-right">${UI.fmtQty(b.remaining_quantity)}</td>
          <td class="text-right">${UI.fmtQty(b.reserved_quantity)}</td>
          <td class="text-right">${UI.fmtQty(b.available_quantity)}</td>
          <td>${b.expiry_date || '—'}${b.days_to_expiry != null ? ` <span class="muted">(${b.days_to_expiry}d)</span>` : ''}</td>
          <td><span class="badge ${b.quality_status === 'RELEASED' ? 'active' : 'OUT'}">${UI.esc(b.quality_status)}</span></td>
          <td>${b.alert_level && b.alert_level !== 'OK' ? `<span class="badge ${ALERT_BADGE[b.alert_level]}">${b.alert_level}</span>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">No batches</td></tr>'}
      </tbody></table>`;
  },
};

Pages.expiry = {
  async render(el) {
    el.innerHTML = '<div class="loading">Loading expiry alerts…</div>';
    const { alerts, summary } = await Api.get('/api/master/expiry-alerts');
    el.innerHTML = `
      <div class="grid kpis" style="margin-bottom:16px">
        <div class="kpi red"><div class="label">Expired</div><div class="value">${summary.EXPIRED || 0}</div></div>
        <div class="kpi red"><div class="label">Near Expiry (≤7d)</div><div class="value">${summary.NEAR_EXPIRY || 0}</div></div>
        <div class="kpi amber"><div class="label">Critical (≤30d)</div><div class="value">${summary.CRITICAL || 0}</div></div>
        <div class="kpi amber"><div class="label">Early Warning (≤90d)</div><div class="value">${summary.EARLY_WARNING || 0}</div></div>
      </div>
      <div class="card"><h3>Expiry Alerts</h3><div class="table-wrap"><table>
        <thead><tr><th>Batch</th><th>Material</th><th>WH / Bin</th><th class="text-right">Qty</th><th>Expiry</th><th>Days</th><th>Level</th></tr></thead>
        <tbody>${alerts.map((a) => `
          <tr><td><strong>${UI.esc(a.batch_number)}</strong></td><td>${UI.esc(a.material_code)}</td>
            <td>${UI.esc(a.warehouse_code || '')} / ${UI.esc(a.bin_location || '—')}</td>
            <td class="text-right">${UI.fmtQty(a.remaining_quantity)}</td><td>${a.expiry_date}</td>
            <td>${a.days_to_expiry}</td><td><span class="badge ${ALERT_BADGE[a.alert_level]}">${a.alert_level}</span></td></tr>`).join('')
          || '<tr><td colspan="7" class="muted">No expiry alerts 🎉</td></tr>'}</tbody>
      </table></div></div>`;
  },
};

Pages.quality = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card"><h3>🔬 Pending Inspection <span class="badge pending" id="ql-count"></span></h3>
        <p class="muted">Every received batch lands here on Quality Hold. Only this step may change quality status;
        held/blocked batches are excluded from FIFO/FEFO allocation and QR validation.</p>
        <div class="table-wrap" id="ql-pending"><div class="loading">Loading…</div></div></div>
      <div class="card"><h3>All batches</h3>
        <div class="table-wrap" id="ql-table"><div class="loading">Loading…</div></div></div>`;
    await this.load();
  },

  decide(batchId, status) {
    UI.modal({
      title: `Set quality status: ${status}`, submitLabel: 'Confirm',
      bodyHtml: `<div class="form-group"><label>Reason ${status === 'RELEASED' ? '(optional)' : '(required)'}</label>
        <input type="text" id="ql-reason" placeholder="Inspection result / justification"></div>`,
      onSubmit: async (ov, close) => {
        const reason = ov.querySelector('#ql-reason').value.trim();
        if (status !== 'RELEASED' && !reason) return UI.toast('A reason is required for hold/block/reject.', 'error');
        try {
          await Api.post(`/api/master/batches/${batchId}/quality`, { quality_status: status, reason: reason || 'Inspection passed' });
          UI.toast(`Batch ${status === 'RELEASED' ? 'released' : 'set to ' + status}.`);
          close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  async load() {
    // Pending inspection queue (the quality step after goods receiving).
    const { batches: pending } = await Api.get('/api/master/batches?quality=QUALITY_HOLD');
    this.el.querySelector('#ql-count').textContent = pending.length;
    this.el.querySelector('#ql-pending').innerHTML = `
      <table><thead><tr><th>Batch</th><th>Material</th><th>PO / GR</th><th>WH</th><th class="text-right">Qty</th><th>Expiry</th><th>Decision</th></tr></thead>
      <tbody>${pending.map((b) => `
        <tr><td><strong>${UI.esc(b.batch_number)}</strong></td>
          <td>${UI.esc(b.material_code)} <span class="muted">${UI.esc(b.material_description || '')}</span></td>
          <td>${UI.esc(b.po_number || '—')} / ${UI.esc(b.gr_number || '—')}</td>
          <td>${UI.esc(b.warehouse_code || '')}</td>
          <td class="text-right">${UI.fmtQty(b.remaining_quantity)}</td>
          <td>${b.expiry_date || '—'}</td>
          <td>
            <button class="btn success sm" data-q="RELEASED" data-id="${b.id}">Release</button>
            <button class="btn secondary sm" data-q="BLOCKED" data-id="${b.id}">Block</button>
            <button class="btn danger sm" data-q="REJECTED" data-id="${b.id}">Reject</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing awaiting inspection 🎉</td></tr>'}
      </tbody></table>`;
    this.el.querySelectorAll('#ql-pending [data-q]').forEach((btn) =>
      btn.addEventListener('click', () => this.decide(btn.dataset.id, btn.dataset.q)));

    // Full batch list (read + re-decide, e.g. re-hold a released batch).
    const { batches } = await Api.get('/api/master/batches');
    this.el.querySelector('#ql-table').innerHTML = `
      <table><thead><tr><th>Batch</th><th>Material</th><th>WH</th><th class="text-right">On hand</th><th>Quality</th><th>Set status</th></tr></thead>
      <tbody>${batches.map((b) => `
        <tr><td><strong>${UI.esc(b.batch_number)}</strong></td><td>${UI.esc(b.material_code)}</td><td>${UI.esc(b.warehouse_code || '')}</td>
          <td class="text-right">${UI.fmtQty(b.remaining_quantity)}</td>
          <td><span class="badge ${b.quality_status === 'RELEASED' ? 'active' : b.quality_status === 'QUALITY_HOLD' ? 'pending' : 'OUT'}">${UI.esc(b.quality_status)}</span></td>
          <td><select class="ql-set" data-id="${b.id}" style="max-width:160px">
            ${['RELEASED', 'QUALITY_HOLD', 'BLOCKED', 'REJECTED'].map((s) => `<option ${s === b.quality_status ? 'selected' : ''}>${s}</option>`).join('')}
          </select></td></tr>`).join('')}
      </tbody></table>`;
    this.el.querySelectorAll('.ql-set').forEach((sel) => sel.addEventListener('change', async () => {
      try { await Api.post(`/api/master/batches/${sel.dataset.id}/quality`, { quality_status: sel.value, reason: 'Quality decision' });
        UI.toast('Quality status updated.'); this.load(); }
      catch (err) { UI.toast(err.message, 'error'); this.load(); }
    }));
  },
};

// --- Master data: warehouses, bins, movement types --------------------------
Pages.warehousesMaster = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><div class="toolbar"><h3 class="mb-0">Warehouse Master</h3><div class="spacer"></div>
      <button class="btn" id="wm-add">+ Add Warehouse</button></div>
      <div class="table-wrap" id="wm-table"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#wm-add').addEventListener('click', () => this.form());
    await this.load();
  },
  async load() {
    const { warehouses } = await Api.get('/api/master/warehouses');
    this.el.querySelector('#wm-table').innerHTML = `
      <table><thead><tr><th>Code</th><th>Name</th><th>Plant</th><th>Storage Loc</th><th>Type</th><th>Supervisor</th></tr></thead>
      <tbody>${warehouses.map((w) => `<tr><td><strong>${UI.esc(w.warehouse_code)}</strong></td><td>${UI.esc(w.warehouse_name)}</td>
        <td>${UI.esc(w.plant || '')}</td><td>${UI.esc(w.storage_location || '')}</td><td>${UI.esc(w.warehouse_type || '')}</td>
        <td>${UI.esc(w.supervisor_name || '—')}</td></tr>`).join('')}</tbody></table>`;
  },
  form() {
    UI.modal({ title: 'Add warehouse', submitLabel: 'Create',
      bodyHtml: `<div class="form-row"><div class="form-group"><label>Code *</label><input id="w-code"></div>
        <div class="form-group"><label>Name *</label><input id="w-name"></div></div>
        <div class="form-row"><div class="form-group"><label>Plant</label><input id="w-plant"></div>
        <div class="form-group"><label>Storage Location</label><input id="w-sloc"></div></div>
        <div class="form-group"><label>Type</label><input id="w-type" value="STANDARD"></div>`,
      onSubmit: async (ov, close) => {
        try { await Api.post('/api/master/warehouses', { warehouse_code: ov.querySelector('#w-code').value,
          warehouse_name: ov.querySelector('#w-name').value, plant: ov.querySelector('#w-plant').value,
          storage_location: ov.querySelector('#w-sloc').value, warehouse_type: ov.querySelector('#w-type').value });
          UI.toast('Warehouse created.'); close(); this.load(); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
  },
};

Pages.binsMaster = {
  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    el.innerHTML = `<div class="card"><div class="toolbar"><h3 class="mb-0">Bin Location Master</h3><div class="spacer"></div>
      <button class="btn secondary" id="bm-upload">⬆ Mass Upload</button>
      <button class="btn" id="bm-add">+ Add Bin</button></div>
      <p class="muted">Compact format e.g. <code>R-03-02-23</code>; expanded e.g. <code>WH01-ZA-R03-L02-C23</code>.</p>
      <div class="table-wrap" id="bm-table"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#bm-add').addEventListener('click', () => this.form());
    el.querySelector('#bm-upload').addEventListener('click', () => UI.csvUploadModal({
      title: 'Mass upload bin locations (CSV)',
      headersHint: 'warehouse_code,zone,rack,line_or_aisle,level,column_number,capacity',
      example: 'warehouse_code,zone,rack,line_or_aisle,level,column_number,capacity\nWH01,ZB,R05,03,01,07,1000',
      onUpload: async (rows) => {
        const r = await Api.post('/api/master/bins/bulk', { rows });
        this.load();
        return r;
      },
    }));
    await this.load();
  },
  async load() {
    const { bins } = await Api.get('/api/master/bins');
    this.el.querySelector('#bm-table').innerHTML = `
      <table><thead><tr><th>WH</th><th>Zone</th><th>Rack</th><th>Compact</th><th>Full</th><th class="text-right">Capacity</th></tr></thead>
      <tbody>${bins.map((b) => `<tr><td>${UI.esc(b.warehouse_code)}</td><td>${UI.esc(b.zone || '')}</td><td>${UI.esc(b.rack || '')}</td>
        <td><strong>${UI.esc(b.bin_code)}</strong></td><td>${UI.esc(b.full_bin_location)}</td><td class="text-right">${UI.fmtQty(b.capacity)}</td></tr>`).join('')}</tbody></table>`;
  },
  form() {
    UI.modal({ title: 'Add bin location', submitLabel: 'Create',
      bodyHtml: `<div class="form-group"><label>Warehouse *</label>
          <select id="b-wh">${this.meta.warehouses.map((w) => `<option>${w.warehouse_code}</option>`).join('')}</select></div>
        <div class="form-row"><div class="form-group"><label>Zone</label><input id="b-zone" value="ZA"></div>
        <div class="form-group"><label>Rack</label><input id="b-rack" value="R01"></div></div>
        <div class="form-row"><div class="form-group"><label>Line/Aisle</label><input id="b-line" value="01"></div>
        <div class="form-group"><label>Level</label><input id="b-level" value="01"></div></div>
        <div class="form-group"><label>Column</label><input id="b-col" value="01"></div>`,
      onSubmit: async (ov, close) => {
        try { await Api.post('/api/master/bins', { warehouse_code: ov.querySelector('#b-wh').value,
          zone: ov.querySelector('#b-zone').value, rack: ov.querySelector('#b-rack').value,
          line_or_aisle: ov.querySelector('#b-line').value, level: ov.querySelector('#b-level').value,
          column_number: ov.querySelector('#b-col').value });
          UI.toast('Bin created.'); close(); this.load(); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
  },
};

Pages.movementTypes = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><div class="toolbar"><h3 class="mb-0">Movement Type Configuration</h3><div class="spacer"></div>
      <button class="btn" id="mt-add">+ Add Movement Type</button></div>
      <div class="table-wrap" id="mt-table"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#mt-add').addEventListener('click', () => this.form());
    await this.load();
  },
  async load() {
    const { movement_types } = await Api.get('/api/master/movement-types');
    this.el.querySelector('#mt-table').innerHTML = `
      <table><thead><tr><th>Code</th><th>Description</th><th>Direction</th><th>Cost Object</th><th>Reversal</th></tr></thead>
      <tbody>${movement_types.map((m) => `<tr><td><strong>${UI.esc(m.code)}</strong></td><td>${UI.esc(m.description)}</td>
        <td>${UI.esc(m.direction)}</td><td>${UI.esc(m.cost_object || '—')}</td><td>${m.is_reversal ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table>`;
  },
  form() {
    UI.modal({ title: 'Add movement type', submitLabel: 'Create',
      bodyHtml: `<div class="form-row"><div class="form-group"><label>Code *</label><input id="m-code"></div>
        <div class="form-group"><label>Direction</label><select id="m-dir"><option>ISSUE</option><option>RECEIPT</option><option>TRANSFER</option><option>REVERSAL</option></select></div></div>
        <div class="form-group"><label>Description *</label><input id="m-desc"></div>
        <div class="form-group"><label>Cost Object</label><input id="m-co" placeholder="COST_CENTER / WBS / ORDER"></div>`,
      onSubmit: async (ov, close) => {
        try { await Api.post('/api/master/movement-types', { code: ov.querySelector('#m-code').value,
          description: ov.querySelector('#m-desc').value, direction: ov.querySelector('#m-dir').value,
          cost_object: ov.querySelector('#m-co').value }); UI.toast('Movement type created.'); close(); this.load(); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
  },
};
