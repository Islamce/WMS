/** ERP Operator queue — reservation/reference, movement type, plant, storage,
 *  warehouse, then send-to-warehouse (mandatory-field gate). */
window.Pages = window.Pages || {};

Pages.erpOperator = {
  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    el.innerHTML = `<div class="card"><h3>ERP Operator Queue</h3>
      <div class="table-wrap" id="eo-table"><div class="loading">Loading…</div></div></div>
      <div id="eo-detail"></div>`;
    await this.loadQueue();
  },

  async loadQueue() {
    const t = this.el.querySelector('#eo-table');
    const { requests } = await Api.get('/api/erp-operator');
    t.innerHTML = requests.length ? `<table><thead><tr><th>Request #</th><th>Requester</th><th>Department</th><th>Project</th><th>Cost Center</th><th>Priority</th><th>Required</th><th>Status</th><th>Movement</th><th>Reservation</th><th>Warehouse</th></tr></thead>
      <tbody>${requests.map((r) => `
        <tr class="row-link" data-id="${r.id}" role="button" tabindex="0" aria-label="Process request ${UI.esc(r.request_number)}">
          <td><span class="chip accent">${UI.esc(r.request_number)}</span></td><td>${UI.esc(r.requester_name || '')}</td>
          <td>${UI.esc(r.department || '—')}</td><td>${UI.esc(r.project || '—')}</td>
          <td>${UI.esc(r.cost_center || '—')}</td><td>${UI.esc(r.priority || '—')}</td>
          <td>${UI.esc(r.required_date || '—')}</td>
          <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
          <td>${UI.esc(r.movement_type || '—')}</td><td>${r.erp_reservation_number || r.erp_reference_number ? `<span class="chip">${UI.esc(r.erp_reservation_number || r.erp_reference_number)}</span>` : '—'}</td>
          <td>${UI.esc(r.issue_warehouse_code || '—')}</td>
        </tr>`).join('')}
      </tbody></table>` : UI.meaningfulEmptyState({ title: 'Queue is empty', description: 'Approved requests awaiting ERP reservation and routing to a warehouse will appear here.' });
    UI.makeRowsActionable(t.querySelectorAll('tr[data-id]'), (tr) => this.openDetail(tr.dataset.id));
  },

  renderMaterialLines(lines) {
    const row = (line) => `<tr>
      <td>${line.line_number}</td>
      <td><strong>${UI.esc(line.material_code || '—')}</strong></td>
      <td class="wrap">${UI.esc(line.material_description || '—')}</td>
      <td class="text-right">${UI.fmtQty(line.requested_quantity)}</td>
      <td class="text-right">${line.approved_quantity != null ? UI.fmtQty(line.approved_quantity) : '—'}</td>
      <td>${UI.esc(line.uom || '—')}</td>
    </tr>`;
    const table = (items) => `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Item</th><th>Description</th><th class="text-right">Requested</th><th class="text-right">Approved</th><th>UoM</th></tr></thead>
      <tbody>${items.map(row).join('')}</tbody>
    </table></div>`;
    const visible = lines.slice(0, 3);
    const remaining = lines.slice(3);
    return `<div class="card" id="eo-material-lines">
      <h3>Requested Materials</h3>
      ${table(visible)}
      ${remaining.length ? UI.materialDisclosure({
        label: 'Additional materials', lineCount: remaining.length,
        bodyHtml: `<div style="max-height:260px;overflow:auto">${table(remaining)}</div>`,
      }) : ''}
    </div>`;
  },

  async openDetail(id) {
    const { request: r, lines } = await Api.get(`/api/requests/${id}`);
    const box = this.el.querySelector('#eo-detail');
    box.innerHTML = `
      <div class="card">
        <h3>${UI.esc(r.request_number)} — ERP Processing</h3>
        ${UI.requestStageIndicator(r)}
        ${UI.requesterCard(r)}
        ${this.renderMaterialLines(lines)}
        <div class="form-row">
          <div class="form-group"><label>ERP Reservation Number</label><input type="text" id="eo-res" value="${UI.esc(r.erp_reservation_number || '')}"></div>
          <div class="form-group"><label>ERP Reference Number</label><input type="text" id="eo-ref" value="${UI.esc(r.erp_reference_number || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Movement Type *</label>
            <select id="eo-mt"><option value="">Select…</option>
              ${this.meta.movementTypes.map((m) => `<option value="${m.code}" ${m.code === r.movement_type ? 'selected' : ''}>${m.code} — ${UI.esc(m.description)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Issue Warehouse *</label>
            <select id="eo-wh"><option value="">Select…</option>
              ${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}" ${w.warehouse_code === r.issue_warehouse_code ? 'selected' : ''}>${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Plant *</label><input type="text" id="eo-plant" value="${UI.esc(r.plant || '')}"></div>
          <div class="form-group"><label>Storage Location *</label><input type="text" id="eo-sloc" value="${UI.esc(r.storage_location || '')}"></div>
        </div>
        <div class="erp-action-bar">
          <div class="erp-action erp-action-draft"><button class="btn secondary" id="eo-save">Save ERP details</button><span>Save as a draft without routing the request.</span></div>
          <div class="erp-action erp-action-commit"><button class="btn success" id="eo-send">Send to Warehouse →</button><span>Routes the request to warehouse execution after required ERP details are complete.</span></div>
          <div class="erp-action erp-action-reverse"><button class="btn warn" id="eo-reverse" title="${t('Send this request back one step, undoing what the current stage did')}">↩ ${t('Reverse one step')}</button></div>
        </div>
        <p class="muted" style="margin-top:8px">Movement type, reservation/reference, plant, storage location and issue warehouse are all mandatory before routing to the warehouse.</p>
      </div>`;

    const collect = () => ({
      erp_reservation_number: box.querySelector('#eo-res').value,
      erp_reference_number: box.querySelector('#eo-ref').value,
      movement_type: box.querySelector('#eo-mt').value,
      issue_warehouse_code: box.querySelector('#eo-wh').value,
      plant: box.querySelector('#eo-plant').value,
      storage_location: box.querySelector('#eo-sloc').value,
    });
    box.querySelector('#eo-save').addEventListener('click', (e) => UI.withBusy(e.currentTarget, async () => {
      try { await Api.patch(`/api/erp-operator/${id}`, collect()); UI.toast('ERP details saved.'); this.openDetail(id); this.loadQueue(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
    box.querySelector('#eo-send').addEventListener('click', (e) => UI.withBusy(e.currentTarget, async () => {
      try {
        await Api.patch(`/api/erp-operator/${id}`, collect());
        await Api.post(`/api/erp-operator/${id}/send-to-warehouse`);
        UI.toast('Sent to warehouse.'); box.innerHTML = ''; this.loadQueue();
      } catch (err) { UI.toast(err.message, 'error'); }
    }));
    box.querySelector('#eo-reverse').addEventListener('click', () => {
      UI.modal({ title: t('Reverse one step'), submitLabel: t('Reverse'),
        bodyHtml: `<p class="hint">${t('Sends this request back to the previous stage, undoing what the current stage did (releases any reservation, allocation or picking task it holds).')}</p>`
          + `<div class="form-group"><label>${t('Reason')}</label><input type="text" id="eo-rv-reason" /></div>`,
        onSubmit: async (ov, close) => {
          try {
            const r = await Api.post(`/api/requests/${id}/reverse`, { reason: ov.querySelector('#eo-rv-reason').value });
            UI.toast(r.message); close(); box.innerHTML = ''; this.loadQueue();
          } catch (err) { UI.toast(err.message, 'error'); }
        } });
    });
  },
};
