/**
 * Subcontractor-owned material — the return queue and the owned-stock report.
 *
 * These two screens cover the half of the Contracting edition that phases 2 and
 * 3 built on the server: material the company HOLDS but does not OWN. Ownership
 * never moves in any of this; only possession does.
 */
window.Pages = window.Pages || {};

/** Supply-only and supply-and-execute settle differently but post identically. */
function engagementChip(type) {
  const supplyAndExecute = type === 'SUPPLY_AND_EXECUTE';
  return `<span class="badge ${supplyAndExecute ? 'pending' : 'role'}" title="${supplyAndExecute
    ? 'Supplies material and executes the work. Settlement runs against the bill of quantities, outside this system.'
    : 'Supplies material only.'}">${supplyAndExecute ? 'Supply + Execute' : 'Supply only'}</span>`;
}

function returnStatusBadge(status) {
  if (status === 'EXECUTED') return 'active';
  if (status === 'APPROVED') return 'pending';
  if (status === 'REJECTED') return 'OUT';
  return 'role';
}

// --- Return queue ------------------------------------------------------------
Pages.subcontractorReturns = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h3 class="mb-0">Returns to Owner</h3>
          <div class="spacer"></div>
          <button class="btn" id="ret-new">+ Request Return</button>
        </div>
        <p class="muted" style="margin:0 0 12px">
          Leftover material in a site store still belongs to the subcontractor. Handing it back is a real
          outbound movement of someone else&rsquo;s property under movement type <strong>542</strong>, never a stock
          adjustment and never consumption. Project management approves the quantity; the
          <strong>approved</strong> quantity is what moves.
        </p>
        <div class="table-wrap" id="ret-table"><div class="loading">Loading…</div></div>
      </div>`;
    el.querySelector('#ret-new').addEventListener('click', () => this.form());
    await this.load();
  },

  async load() {
    const { returns } = await Api.get('/api/subcontractor/returns');
    this.rows = returns || [];
    this.el.querySelector('#ret-table').innerHTML = `
      <table><thead><tr>
        <th>Return</th><th>Subcontractor</th><th>Material</th><th>Batch</th>
        <th class="text-right">Requested</th><th class="text-right">Approved</th>
        <th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${this.rows.map((r) => `
        <tr>
          <td><strong>${UI.esc(r.return_number)}</strong>
            <div class="muted sm">${UI.esc(r.requested_by_name || '')}</div></td>
          <td>${UI.esc(r.subcontractor_name || '—')}</td>
          <td>${UI.esc(r.material_code || '—')}</td>
          <td>${UI.esc(r.batch_number || '—')}</td>
          <td class="text-right">${UI.fmtQty(r.quantity_requested)}</td>
          <td class="text-right">${r.quantity_approved == null ? '—' : UI.fmtQty(r.quantity_approved)}</td>
          <td><span class="badge ${returnStatusBadge(r.status)}">${UI.esc(r.status)}</span>
            ${r.movement_type ? `<span class="chip" title="Movement type">${UI.esc(r.movement_type)}</span>` : ''}
            ${r.execution_error ? `<div class="muted sm" style="color:var(--danger)">${UI.esc(r.execution_error)}</div>` : ''}</td>
          <td>${this.actionsFor(r)}</td>
        </tr>`).join('')
        || `<tr><td colspan="8">${UI.meaningfulEmptyState({
          title: 'No returns requested',
          description: 'When a subcontractor asks for their unused material back, raise it here so project management can approve the quantity before anything leaves the store.',
        })}</td></tr>`}
      </tbody></table>`;

    this.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const row = this.rows.find((r) => String(r.id) === b.dataset.id);
      if (b.dataset.act === 'approve') this.approveForm(row);
      else if (b.dataset.act === 'reject') this.rejectForm(row);
      else this.execute(row, b);
    }));
  },

  actionsFor(r) {
    const buttons = [];
    if (r.status === 'PENDING_APPROVAL' && App.can('subcontractor_return_approval')) {
      buttons.push(`<button class="btn sm" data-act="approve" data-id="${r.id}">Approve</button>`);
      buttons.push(`<button class="btn danger sm" data-act="reject" data-id="${r.id}">Reject</button>`);
    }
    // Handing the material over is the warehouse's job — it is a physical act.
    // Approving the quantity is not, which is why the two are separate buttons
    // behind separate permissions.
    if (r.status === 'APPROVED' && App.can(['subcontractor_admin', 'subcontractor_receiving'])) {
      buttons.push(`<button class="btn sm" data-act="execute" data-id="${r.id}">Hand over</button>`);
    }
    return buttons.join(' ') || '<span class="muted">—</span>';
  },

  async form() {
    let subcontractors = [];
    try { ({ subcontractors } = await Api.get('/api/subcontractor/subcontractors')); } catch (e) { subcontractors = []; }
    UI.modal({
      title: 'Request a return to owner',
      submitLabel: 'Request',
      bodyHtml: `
        <p class="muted">Only material recorded as owned by a subcontractor can be returned. Company stock
          leaving the store is a goods issue, which is a different thing under a different authority.</p>
        <div class="form-row">
          <div class="form-group"><label>Subcontractor *</label>
            <select id="ret-sub"><option value="">— Select —</option>
              ${subcontractors.map((s) => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('')}
            </select></div>
          <div class="form-group"><label>Batch ID *</label><input id="ret-batch" type="number" min="1" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Quantity *</label><input id="ret-qty" type="number" min="0" step="any" /></div>
          <div class="form-group"><label>Warehouse</label><input id="ret-wh" placeholder="Site store code" /></div>
        </div>
        <div class="form-group"><label>Reason</label><input id="ret-reason" placeholder="e.g. Project closeout" /></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.post('/api/subcontractor/returns', {
            subcontractor_id: Number(ov.querySelector('#ret-sub').value) || undefined,
            batch_id: Number(ov.querySelector('#ret-batch').value),
            quantity: Number(ov.querySelector('#ret-qty').value),
            warehouse_code: ov.querySelector('#ret-wh').value || undefined,
            reason: ov.querySelector('#ret-reason').value || undefined,
          });
          UI.toast('Return requested — awaiting project management approval.');
          close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  approveForm(r) {
    UI.modal({
      title: `Approve return ${r.return_number}`,
      submitLabel: 'Approve',
      bodyHtml: `
        <p class="muted">The quantity you approve is the quantity that leaves the store. Approving less than
          requested leaves the remainder in stock.</p>
        <div class="form-group"><label>Approved quantity</label>
          <input id="ap-qty" type="number" min="0" step="any" value="${r.quantity_requested}" />
          <div class="hint">Requested: ${UI.fmtQty(r.quantity_requested)}</div></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.post(`/api/subcontractor/returns/${r.id}/approve`, {
            quantity_approved: Number(ov.querySelector('#ap-qty').value),
          });
          UI.toast('Approved.'); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  rejectForm(r) {
    UI.modal({
      title: `Reject return ${r.return_number}`,
      submitLabel: 'Reject',
      bodyHtml: `<div class="form-group"><label>Reason *</label>
        <input id="rj-reason" placeholder="e.g. Still needed on site" /></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.post(`/api/subcontractor/returns/${r.id}/reject`, {
            reason: ov.querySelector('#rj-reason').value,
          });
          UI.toast('Rejected.'); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  execute(r, btn) {
    UI.confirm(`Hand over ${UI.fmtQty(r.quantity_approved)} of ${r.material_code || 'this material'} to `
      + `${r.subcontractor_name}? This issues the material out of stock under movement type 542.`, async () => {
      await UI.withBusy(btn, async () => {
        try {
          const res = await Api.post(`/api/subcontractor/returns/${r.id}/execute`, {});
          UI.toast(res.idempotent ? 'Already handed over.' : 'Handed over under movement type 542.');
          this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      });
    });
  },
};

// --- Owned-stock report ------------------------------------------------------
Pages.subcontractorOwnedStock = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <h3 class="mb-0">Subcontractor-Owned Stock</h3>
          <div class="spacer"></div>
          <div class="form-group mb-0" style="max-width:190px">
            <label class="sm">Low-stock threshold</label>
            <select id="os-threshold">
              <option value="5">5% remaining</option>
              <option value="10" selected>10% remaining</option>
              <option value="25">25% remaining</option>
            </select>
          </div>
          <span id="os-export"></span>
        </div>
        <div id="os-alerts"></div>
        <div class="table-wrap" id="os-table"><div class="loading">Loading…</div></div>
        <p class="muted sm" id="os-basis" style="margin-top:12px"></p>
      </div>`;
    el.querySelector('#os-threshold').addEventListener('change', () => this.load());
    await this.load();
  },

  async load() {
    const threshold = this.el.querySelector('#os-threshold').value;
    const data = await Api.get(`/api/subcontractor/owned-stock-report?low_stock_percent=${threshold}`);
    const rows = data.report || [];

    // Depletion is the alert that matters to a site: the subcontractor has to be
    // told to deliver more before the crew stops. It is a share of what was
    // delivered, not a reorder point — the company neither buys nor owns this
    // material, so no reorder point can exist for it.
    const alerts = data.alerts || [];
    this.el.querySelector('#os-alerts').innerHTML = alerts.length
      ? `<div class="inline-alert warning" style="margin-bottom:12px">
           <strong>${alerts.length} line(s) nearly depleted.</strong>
           ${alerts.map((a) => `${UI.esc(a.subcontractor_name)} — ${UI.esc(a.material_code || a.material_description || '')} `
             + `(${a.percent_remaining}% left)`).join(' · ')}
         </div>`
      : '';

    this.el.querySelector('#os-table').innerHTML = `
      <table><thead><tr>
        <th>Subcontractor</th><th>Engagement</th><th>Material</th><th>Site Store</th><th>Unit</th>
        <th class="text-right">Received</th><th class="text-right">Issued</th>
        <th class="text-right">Returned</th><th class="text-right">On Hand</th><th class="text-right">Left</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr${r.low_stock ? ' class="row-warn"' : ''}>
          <td>${UI.esc(r.subcontractor_name)}${r.trade_category ? `<div class="muted sm">${UI.esc(r.trade_category)}</div>` : ''}</td>
          <td>${engagementChip(r.engagement_type)}</td>
          <td>${UI.esc(r.material_code || '—')}<div class="muted sm">${UI.esc(r.material_description || '')}</div></td>
          <td>${UI.esc(r.warehouse_code || '—')}</td>
          <td>${UI.esc(r.uom || '')}</td>
          <td class="text-right">${UI.fmtQty(r.quantity_received)}</td>
          <td class="text-right">${UI.fmtQty(r.quantity_issued)}</td>
          <td class="text-right">${UI.fmtQty(r.quantity_returned)}</td>
          <td class="text-right"><strong>${UI.fmtQty(r.quantity_on_hand)}</strong></td>
          <td class="text-right">${r.percent_remaining}%
            ${r.low_stock ? '<span class="badge OUT">low</span>' : ''}
            ${r.discrepancy ? `<span class="badge OUT" title="${UI.esc(r.discrepancy)}">check</span>` : ''}</td>
        </tr>`).join('')
        || `<tr><td colspan="10">${UI.meaningfulEmptyState({
          title: 'No subcontractor-owned stock',
          description: 'Material shows here once a batch is recorded as owned by a subcontractor. Until then every batch in the store belongs to the company.',
        })}</td></tr>`}
      </tbody></table>`;

    this.el.querySelector('#os-basis').textContent = data.basis || '';

    const slot = this.el.querySelector('#os-export');
    slot.innerHTML = '';
    slot.appendChild(UI.exportControl({
      filename: 'subcontractor-owned-stock',
      title: 'Subcontractor-Owned Material',
      rows,
      columns: [
        { key: 'subcontractor_name', label: 'Subcontractor' },
        { key: 'engagement_type', label: 'Engagement' },
        { key: 'material_code', label: 'Material' },
        { key: 'material_description', label: 'Description' },
        { key: 'warehouse_code', label: 'Site Store' },
        { key: 'uom', label: 'Unit' },
        { key: 'quantity_received', label: 'Received' },
        { key: 'quantity_issued', label: 'Issued' },
        { key: 'quantity_returned', label: 'Returned' },
        { key: 'quantity_on_hand', label: 'On Hand' },
        { key: 'percent_remaining', label: '% Left' },
      ],
    }));
  },
};
