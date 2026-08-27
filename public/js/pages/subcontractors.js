/**
 * Subcontractor materials — a SAP-free receiving stream for site/project
 * warehouses: log a delivery, inspect it for quality, then receive the
 * approved lines into a local on-hand view. No item code, no material master.
 */
window.Pages = window.Pages || {};

function subcQualityBadge(status) {
  if (status === 'Approved') return 'active';
  if (status === 'Approved with Remarks') return 'pending';
  if (status === 'Rejected') return 'OUT';
  return 'role';
}

// --- Admin: subcontractors + categories -------------------------------------
Pages.subcontractors = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar"><h3 class="mb-0">Subcontractors</h3><div class="spacer"></div>
          <button class="btn" id="sc-add">+ Add Subcontractor</button></div>
        <div class="table-wrap" id="sc-table"><div class="loading">Loading…</div></div>
      </div>
      <div class="card">
        <div class="toolbar"><h3 class="mb-0">Material Categories</h3><div class="spacer"></div>
          <button class="btn secondary" id="cat-add">+ Add Category</button></div>
        <div class="table-wrap" id="cat-table"><div class="loading">Loading…</div></div>
      </div>`;
    el.querySelector('#sc-add').addEventListener('click', () => this.form());
    el.querySelector('#cat-add').addEventListener('click', () => this.categoryForm());
    await Promise.all([this.load(), this.loadCategories()]);
  },

  async load() {
    const { subcontractors } = await Api.get('/api/subcontractor/subcontractors');
    this.el.querySelector('#sc-table').innerHTML = `
      <table><thead><tr><th>Name</th><th>Trade / Category</th><th>Contract Ref</th><th>Contact</th></tr></thead>
      <tbody>${subcontractors.map((s) => `
        <tr><td>${UI.esc(s.name)}</td><td>${UI.esc(s.trade_category || '—')}</td>
          <td>${s.contract_reference ? `<span class="chip">${UI.esc(s.contract_reference)}</span>` : '—'}</td>
          <td>${UI.esc(s.contact_name || '')}${s.contact_phone ? ` · ${UI.esc(s.contact_phone)}` : ''}</td></tr>`).join('')
        || `<tr><td colspan="4">${UI.meaningfulEmptyState({ title: 'No subcontractors yet', description: 'Add the subcontractors who deliver material to site so deliveries can be logged against them.' })}</td></tr>`}
      </tbody></table>`;
  },

  async loadCategories() {
    const { categories } = await Api.get('/api/subcontractor/categories');
    this.el.querySelector('#cat-table').innerHTML = `
      <table><thead><tr><th>Category</th></tr></thead>
      <tbody>${categories.map((c) => `<tr><td>${UI.esc(c.name)}</td></tr>`).join('')
        || `<tr><td>${UI.meaningfulEmptyState({ title: 'No categories yet', description: 'Add categories (e.g. Consumables, Fixtures, Piping) to classify subcontractor deliveries.' })}</td></tr>`}
      </tbody></table>`;
  },

  form() {
    UI.modal({
      title: 'Add subcontractor', submitLabel: 'Create',
      bodyHtml: `<div class="form-row"><div class="form-group"><label>Name *</label><input id="sc-name"></div>
        <div class="form-group"><label>Trade / Category</label><input id="sc-trade" placeholder="e.g. Electrical, Civil, MEP"></div></div>
        <div class="form-row"><div class="form-group"><label>Contract Reference</label><input id="sc-ref"></div>
        <div class="form-group"><label>Contact Name</label><input id="sc-contact"></div></div>
        <div class="form-group"><label>Contact Phone</label><input id="sc-phone"></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.post('/api/subcontractor/subcontractors', {
            name: ov.querySelector('#sc-name').value, trade_category: ov.querySelector('#sc-trade').value,
            contract_reference: ov.querySelector('#sc-ref').value, contact_name: ov.querySelector('#sc-contact').value,
            contact_phone: ov.querySelector('#sc-phone').value,
          });
          UI.toast('Subcontractor created.'); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  categoryForm() {
    UI.modal({
      title: 'Add category', submitLabel: 'Create',
      bodyHtml: `<div class="form-group"><label>Category name *</label><input id="cat-name" placeholder="e.g. Consumables"></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.post('/api/subcontractor/categories', { name: ov.querySelector('#cat-name').value });
          UI.toast('Category created.'); close(); this.loadCategories();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};

// --- Shared delivery queue: Site Warehouse Supervisor logs the delivery,
// Site Quality Supervisor inspects it. Approval records stock in the same
// step, so both roles look at the same queue — only the "+ Log Delivery"
// action and the per-line decision buttons are permission-gated.
const SubcontractorDeliveries = {
  state: { warehouse_code: '', status: '' },

  async render(el) {
    this.el = el;
    const canLog = App.can('subcontractor_receiving');
    const [{ subcontractors }, meta] = await Promise.all([
      Api.get('/api/subcontractor/subcontractors'), Api.get('/api/meta'),
    ]);
    this.subcontractors = subcontractors;
    this.warehouses = meta.warehouses;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h3 class="mb-0">Subcontractor Deliveries</h3>
          <select id="dq-warehouse" style="max-width:200px"><option value="">All warehouses</option>
            ${this.warehouses.map((w) => `<option value="${UI.esc(w.warehouse_code)}">${UI.esc(w.warehouse_code)} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select>
          <select id="dq-status" style="max-width:200px"><option value="">All statuses</option>
            ${['Pending Inspection', 'Received', 'Closed'].map((s) => `<option>${s}</option>`).join('')}</select>
          <div class="spacer"></div>
          ${canLog ? '<button class="btn" id="dq-log">+ Log Delivery</button>' : ''}
        </div>
        <div class="table-wrap" id="dq-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="dq-pagination"></div>
      </div>`;
    el.querySelector('#dq-warehouse').addEventListener('change', (e) => { this.state.warehouse_code = e.target.value; this.load(1); });
    el.querySelector('#dq-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(1); });
    el.querySelector('#dq-log')?.addEventListener('click', () => this.logForm());
    await this.load(1);
  },

  async load(page = 1) {
    const canLog = App.can('subcontractor_receiving');
    const q = new URLSearchParams({ page, ...(this.state.warehouse_code ? { warehouse_code: this.state.warehouse_code } : {}), ...(this.state.status ? { status: this.state.status } : {}) });
    const data = await Api.get(`/api/subcontractor/deliveries?${q}`);
    this.el.querySelector('#dq-table').innerHTML = data.deliveries.length ? `
      <table><thead><tr><th>Delivery</th><th>Warehouse</th><th>Subcontractor</th><th>Delivered</th><th>Lines</th><th>Status</th></tr></thead>
      <tbody>${data.deliveries.map((d) => `
        <tr class="row-link" data-id="${d.id}" role="button" tabindex="0" aria-label="Open delivery ${d.id}">
          <td><span class="chip accent">DEL-${d.id}</span></td><td>${UI.esc(d.warehouse_code)}</td>
          <td>${UI.esc(d.subcontractor_name)}</td><td>${UI.esc(d.delivered_date)}</td>
          <td>${d.line_count}${d.pending_lines ? ` <span class="muted">(${d.pending_lines} pending)</span>` : ''}</td>
          <td><span class="badge ${d.status === 'Pending Inspection' ? 'pending' : d.status === 'Received' ? 'active' : 'OUT'}">${UI.esc(d.status)}</span></td>
        </tr>`).join('')}</tbody></table>` : UI.meaningfulEmptyState({
      title: 'No deliveries logged yet',
      description: canLog ? 'Log what a subcontractor dropped off on site to start the quality-inspection queue.' : 'Deliveries the Site Warehouse Supervisor logs will appear here for quality inspection.',
      actionHtml: canLog ? '<button class="btn secondary sm" id="dq-empty-log" style="margin-top:8px">+ Log Delivery</button>' : '',
    });
    this.el.querySelector('#dq-empty-log')?.addEventListener('click', () => this.logForm());
    UI.makeRowsActionable(this.el.querySelectorAll('tr[data-id]'), (tr) => this.detail(tr.dataset.id));
    UI.pagination(this.el.querySelector('#dq-pagination'), data, (p) => this.load(p));
  },

  logForm() {
    let lineCount = 1;
    const lineRow = (i) => `<div class="form-row subc-line" data-line="${i}">
      <div class="form-group" style="flex:2"><label>Description *</label><input class="sl-desc" placeholder="e.g. PVC conduit 20mm"></div>
      <div class="form-group"><label>Qty *</label><input class="sl-qty" type="number" min="0.01" step="0.01"></div>
      <div class="form-group"><label>UoM</label><input class="sl-uom" value="EA"></div>
      <div class="form-group"><label>Category</label><select class="sl-cat"><option value="">—</option>${(this.categories || []).map((c) => `<option value="${c.id}">${UI.esc(c.name)}</option>`).join('')}</select></div>
    </div>`;

    Api.get('/api/subcontractor/categories').then((r) => { this.categories = r.categories; });

    UI.modal({
      title: 'Log subcontractor delivery', wide: true, submitLabel: 'Log Delivery',
      bodyHtml: `<div class="form-row">
          <div class="form-group"><label>Warehouse *</label><select id="dl-wh">${this.warehouses.map((w) => `<option value="${UI.esc(w.warehouse_code)}">${UI.esc(w.warehouse_code)} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Subcontractor *</label><select id="dl-sub">${this.subcontractors.map((s) => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Delivery Note Ref</label><input id="dl-ref"></div>
          <div class="form-group"><label>Delivered Date</label><input id="dl-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div id="dl-lines">${lineRow(0)}</div>
        <button type="button" class="btn secondary sm" id="dl-add-line" style="margin-top:6px">+ Add line</button>`,
      onSubmit: async (ov, close) => {
        const lines = [...ov.querySelectorAll('.subc-line')].map((row) => ({
          description: row.querySelector('.sl-desc').value.trim(),
          quantity_delivered: Number(row.querySelector('.sl-qty').value),
          uom: row.querySelector('.sl-uom').value.trim() || 'EA',
          category_id: row.querySelector('.sl-cat').value || null,
        })).filter((l) => l.description);
        if (!lines.length) return UI.toast('Add at least one line with a description.', 'error');
        try {
          await Api.post('/api/subcontractor/deliveries', {
            warehouse_code: ov.querySelector('#dl-wh').value, subcontractor_id: Number(ov.querySelector('#dl-sub').value),
            delivery_note_ref: ov.querySelector('#dl-ref').value, delivered_date: ov.querySelector('#dl-date').value, lines,
          });
          UI.toast('Delivery logged.'); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
    document.getElementById('dl-add-line')?.addEventListener('click', (e) => {
      lineCount += 1;
      document.getElementById('dl-lines').insertAdjacentHTML('beforeend', lineRow(lineCount));
    });
  },

  async detail(id) {
    const { delivery, lines } = await Api.get(`/api/subcontractor/deliveries/${id}`);
    UI.modal({
      title: `Delivery DEL-${delivery.id} — ${delivery.subcontractor_name}`, wide: true, submitLabel: 'Close',
      bodyHtml: `<p class="muted">${UI.esc(delivery.warehouse_code)} · delivered ${UI.esc(delivery.delivered_date)}${delivery.delivery_note_ref ? ` · ref ${UI.esc(delivery.delivery_note_ref)}` : ''}</p>
        <div class="table-wrap"><table><thead><tr><th>Description</th><th>Category</th><th class="text-right">Qty</th><th>Quality</th><th>Notes</th><th>Decision</th></tr></thead>
        <tbody>${lines.map((l) => `
          <tr data-line="${l.id}"><td>${UI.esc(l.description)}</td><td>${UI.esc(l.category_name || '—')}</td>
            <td class="text-right">${UI.fmtQty(l.quantity_delivered)} ${UI.esc(l.uom)}</td>
            <td><span class="badge ${subcQualityBadge(l.quality_status)}">${UI.esc(l.quality_status)}</span>${l.quantity_approved != null ? ` <span class="muted">(${UI.fmtQty(l.quantity_approved)} appr.)</span>` : ''}</td>
            <td class="muted">${UI.esc(l.quality_notes || '—')}</td>
            <td>${l.quality_status === 'Pending' && App.can('subcontractor_quality_inspection')
              ? `<button class="btn success sm" data-decide="${l.id}" data-status="Approved" data-qty="${l.quantity_delivered}">Approve</button>
                 <button class="btn secondary sm" data-decide="${l.id}" data-status="Approved with Remarks" data-qty="${l.quantity_delivered}">Remarks</button>
                 <button class="btn danger sm" data-decide="${l.id}" data-status="Rejected" data-qty="0">Reject</button>`
              : '—'}</td></tr>`).join('')}</tbody></table></div>`,
    });
    document.querySelectorAll('[data-decide]').forEach((btn) => btn.addEventListener('click', () => {
      this.decide(id, btn.dataset.decide, btn.dataset.status, btn.dataset.qty);
    }));
  },

  decide(deliveryId, lineId, status, defaultQty) {
    UI.modal({
      title: `${status} — line quality decision`, submitLabel: 'Confirm',
      bodyHtml: `${status !== 'Rejected' ? `<div class="form-group"><label>Quantity approved *</label><input id="qd-qty" type="number" min="0.01" step="0.01" value="${defaultQty}"></div>` : ''}
        <div class="form-group"><label>Notes ${status === 'Approved' ? '(optional)' : '(required)'}</label><textarea id="qd-notes" rows="2"></textarea></div>`,
      onSubmit: async (ov, close) => {
        const notes = ov.querySelector('#qd-notes').value.trim();
        if (status !== 'Approved' && !notes) return UI.toast('A note is required for this decision.', 'error');
        try {
          await Api.patch(`/api/subcontractor/deliveries/${deliveryId}/lines/${lineId}`, {
            quality_status: status, quantity_approved: status === 'Rejected' ? 0 : Number(ov.querySelector('#qd-qty').value), quality_notes: notes || null,
          });
          UI.toast('Quality decision recorded.'); close();
          document.querySelector('.modal-overlay')?.remove();
          this.detail(deliveryId); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};

// Both roles share the same delivery queue; only the Log Delivery action and
// the per-line quality decision buttons are permission-gated (see above).
Pages.subcontractorQuality = SubcontractorDeliveries;

// --- Current stock (computed, read-only) ------------------------------------
Pages.subcontractorStock = {
  async render(el) {
    this.el = el;
    const meta = await Api.get('/api/meta');
    el.innerHTML = `<div class="card">
      <div class="toolbar"><h3 class="mb-0">Subcontractor Material — On Hand</h3>
        <select id="ss-warehouse" style="max-width:220px"><option value="">All warehouses</option>
          ${meta.warehouses.map((w) => `<option value="${UI.esc(w.warehouse_code)}">${UI.esc(w.warehouse_code)} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select>
      </div>
      <div class="table-wrap" id="ss-table"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#ss-warehouse').addEventListener('change', (e) => this.load(e.target.value));
    await this.load('');
  },

  async load(warehouseCode) {
    const q = warehouseCode ? `?warehouse_code=${encodeURIComponent(warehouseCode)}` : '';
    const { stock } = await Api.get(`/api/subcontractor/stock${q}`);
    this.el.querySelector('#ss-table').innerHTML = stock.length ? `
      <table><thead><tr><th>Warehouse</th><th>Description</th><th>Category</th><th class="text-right">On hand</th><th>Subcontractor(s)</th></tr></thead>
      <tbody>${stock.map((s) => `<tr><td>${UI.esc(s.warehouse_code)}</td><td>${UI.esc(s.description)}</td><td>${UI.esc(s.category_name || '—')}</td>
        <td class="text-right">${UI.fmtQty(s.quantity_on_hand)} ${UI.esc(s.uom)}</td><td class="muted">${UI.esc(s.subcontractors)}</td></tr>`).join('')}</tbody></table>`
      : UI.meaningfulEmptyState({ title: 'No subcontractor stock on hand', description: 'Stock appears here once received quantities are logged against a delivery.' });
  },
};
