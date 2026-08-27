/** Goods Issue Posting — review picked lines, QR history, post GI (or simulate error). */
window.Pages = window.Pages || {};

Pages.giPosting = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><h3>Goods Issue Posting Queue</h3>
      <div class="table-wrap" id="gi-table"><div class="loading">Loading…</div></div></div>
      <div id="gi-detail"></div>`;
    await this.loadQueue();
  },

  async loadQueue() {
    const t = this.el.querySelector('#gi-table');
    const { requests } = await Api.get('/api/gi');
    t.innerHTML = requests.length ? `<table><thead><tr><th>Request #</th><th>Requester</th><th>Department</th><th>Project</th><th>Warehouse</th><th>Movement</th><th>Reservation</th><th>Status</th><th></th></tr></thead>
      <tbody>${requests.map((r) => `
        <tr data-id="${r.id}">
          <td><span class="chip accent">${UI.esc(r.request_number)}</span></td>
          <td>${UI.esc(r.requester_name || '')}</td><td>${UI.esc(r.department || '—')}</td><td>${UI.esc(r.project || '—')}</td>
          <td>${UI.esc(r.issue_warehouse_code || '')}<div class="muted sm">Plant ${UI.esc(r.plant || '—')} · SLoc ${UI.esc(r.storage_location || '—')}</div></td>
          <td>${UI.esc(r.movement_type || '')}</td><td>${UI.esc(r.erp_reservation_number || r.erp_reference_number || '')}</td>
          <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
          <td><button class="btn sm" data-open="${r.id}">Review</button></td>
        </tr>`).join('')}
      </tbody></table>` : UI.meaningfulEmptyState({ title: 'Queue is empty', description: 'Picked requests ready for Goods Issue posting will appear here.' });
    t.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openDetail(b.dataset.open)));
  },

  async openDetail(id) {
    const { request: r, lines, qr_scans } = await Api.get(`/api/gi/${id}`);
    const box = this.el.querySelector('#gi-detail');
    box.innerHTML = `
      <div class="card">
        <h3>${UI.esc(r.request_number)} — Goods Issue</h3>
        ${UI.requesterCard(r)}
        <div style="margin-top:12px">${UI.executionContextCard(r)}</div>
        ${r.erp_error_message ? `<div class="inline-alert error">Previous ERP error: ${UI.esc(r.erp_error_message)}</div>` : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Item</th><th class="text-right">Approved</th><th class="text-right">Picked</th>
            <th class="text-right">Shortage</th><th>Batch</th><th>Bin</th><th>Status</th></tr></thead>
          <tbody>${lines.map((l) => `
            <tr><td>${l.line_number}</td><td><strong>${UI.esc(l.material_code)}</strong></td>
              <td class="text-right">${UI.fmtQty(l.approved_quantity != null ? l.approved_quantity : l.requested_quantity)}</td>
              <td class="text-right">${UI.fmtQty(l.picked_quantity)}</td>
              <td class="text-right">${UI.fmtQty(l.shortage_quantity)}</td>
              <td>${l.batch_number ? `<span class="chip accent">${UI.esc(l.batch_number)}</span>` : '—'}</td><td>${l.bin_location ? `<span class="chip">${UI.esc(l.bin_location)}</span>` : '—'}</td>
              <td><span class="badge ${statusClass(l.line_status)}">${UI.esc(l.line_status)}</span></td></tr>`).join('')}</tbody>
        </table></div>
        <p class="muted" style="margin-top:8px">QR scans: ${qr_scans.filter((s) => s.action === 'QR_SCAN_PASS').length} passed, ${qr_scans.filter((s) => s.action === 'QR_SCAN_FAIL').length} failed.</p>

        <div class="form-row" style="margin-top:10px">
          <div class="form-group"><label>GI Document Number *</label><input type="text" id="gi-doc" placeholder="e.g. 4900001234"></div>
          <div class="form-group"><label>Fiscal Year</label><input type="text" id="gi-fy" value="${new Date().getFullYear()}"></div>
        </div>
        <label class="perm-item" style="max-width:320px"><input type="checkbox" id="gi-sim"> <span>Simulate ERP posting error (test)</span></label>
        <div class="actions" style="justify-content:flex-start;margin-top:12px">
          <button class="btn success" id="gi-post">Post Goods Issue</button>
          <button class="btn secondary" id="gi-return">Return to Picker</button>
        </div>
      </div>`;

    box.querySelector('#gi-post').addEventListener('click', async () => {
      try {
        const r2 = await Api.post(`/api/gi/${id}/post`, {
          gi_document_number: box.querySelector('#gi-doc').value,
          fiscal_year: box.querySelector('#gi-fy').value,
          simulate_error: box.querySelector('#gi-sim').checked });
        UI.toast(r2.message); box.innerHTML = ''; this.loadQueue();
      } catch (err) { UI.toast(err.message, 'error'); this.loadQueue(); }
    });
    box.querySelector('#gi-return').addEventListener('click', async () => {
      try { await Api.post(`/api/gi/${id}/return-to-picker`, { reason: 'Recount required' }); UI.toast('Returned to picker.'); box.innerHTML = ''; this.loadQueue(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
  },
};

/** Warehouse dashboard = the combined warehouse execution queue. */
Pages.warehouse = {
  lineTable(lines) {
    return `<div style="max-height:260px;overflow:auto"><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Item</th><th>Description</th><th class="text-right">Requested</th><th class="text-right">Approved</th><th>UoM</th></tr></thead>
      <tbody>${lines.map((line) => `<tr>
        <td>${line.line_number}</td><td><strong>${UI.esc(line.material_code || '—')}</strong></td>
        <td class="wrap">${UI.esc(line.material_description || '—')}</td>
        <td class="text-right">${UI.fmtQty(line.requested_quantity)}</td>
        <td class="text-right">${line.approved_quantity != null ? UI.fmtQty(line.approved_quantity) : '—'}</td>
        <td>${UI.esc(line.uom || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No active material lines</td></tr>'}</tbody>
    </table></div></div>`;
  },

  materialDisclosure(request) {
    return UI.materialDisclosure({
      lineCount: request.total_lines,
      label: 'Materials',
      requestId: request.id,
      bodyHtml: `<div class="wd-material-body" data-request-id="${request.id}"><div class="loading">Expand to load material lines…</div></div>`,
    });
  },

  async loadMaterialLines(details) {
    if (!details.open || details.dataset.loaded === '1') return;
    const id = details.dataset.requestId;
    const body = details.querySelector('.wd-material-body');
    body.innerHTML = '<div class="loading">Loading material lines…</div>';
    try {
      const { lines } = await Api.get(`/api/requests/${id}`);
      body.innerHTML = this.lineTable(lines);
      details.dataset.loaded = '1';
    } catch (err) {
      body.innerHTML = `<div class="inline-alert error">${UI.esc(err.message || 'Unable to load material lines.')}</div>`;
    }
  },

  filterOptions(values, selected, label) {
    const options = [...new Set(values.filter(Boolean))].sort();
    return `<div class="form-group"><label>${label}</label><select data-wd-filter="${label.toLowerCase()}"><option value="">All ${label.toLowerCase()} values</option>${options.map((value) => `<option value="${UI.esc(value)}" ${value === selected ? 'selected' : ''}>${UI.esc(value)}</option>`).join('')}</select></div>`;
  },

  renderCards() {
    const filters = this.filters;
    const visible = this.requests.filter((request) =>
      (!filters.status || request.request_status === filters.status)
      && (!filters.priority || request.priority === filters.priority)
      && (!filters.warehouse || request.issue_warehouse_code === filters.warehouse));
    const list = this.el.querySelector('#wd-card-list');
    list.innerHTML = visible.length
      ? visible.map((request) => UI.requestCard(request, {
        link: `#/request-detail/${request.id}`,
        materialsHtml: this.materialDisclosure(request),
        extraHtml: `<div class="request-card-meta">ERP ${UI.esc(request.erp_reservation_number || request.erp_reference_number || '—')} · Movement ${UI.esc(request.movement_type || '—')} · Plant ${UI.esc(request.plant || '—')} · SLoc ${UI.esc(request.storage_location || '—')}</div>`,
      })).join('')
      : UI.meaningfulEmptyState({
        title: 'No requests match these controls',
        description: 'There are no warehouse-execution requests for the selected status, priority, and warehouse filters.',
      });
    list.querySelectorAll('.material-disclosure').forEach((details) => {
      details.addEventListener('toggle', () => this.loadMaterialLines(details));
    });
  },

  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><div class="toolbar"><div><h3 class="mb-0">Warehouse Dashboard</h3><p class="muted">Requests currently in warehouse execution stages.</p></div></div>
      <div class="filter-bar" id="wd-filters"><div class="loading">Loading controls…</div></div></div>
      <div id="wd-card-list"><div class="loading">Loading warehouse requests…</div></div>`;
    const { requests } = await Api.get('/api/warehouse/queue');
    this.requests = requests;
    this.filters = { status: '', priority: '', warehouse: '' };
    const controls = el.querySelector('#wd-filters');
    controls.innerHTML = this.filterOptions(requests.map((request) => request.request_status), '', 'Status')
      + this.filterOptions(requests.map((request) => request.priority), '', 'Priority')
      + this.filterOptions(requests.map((request) => request.issue_warehouse_code), '', 'Warehouse');
    controls.querySelectorAll('[data-wd-filter]').forEach((control) => control.addEventListener('change', () => {
      const key = control.dataset.wdFilter;
      this.filters[key] = control.value;
      this.renderCards();
    }));
    this.renderCards();
  },
};
