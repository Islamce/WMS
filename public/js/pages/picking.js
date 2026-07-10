/** Picker task inbox + task execution: accept, start, QR scan, line confirm. */
window.Pages = window.Pages || {};

Pages.picking = {
  async render(el, taskId) {
    this.el = el;
    if (taskId) return this.openTask(taskId);
    el.innerHTML = `<div class="card"><h3>My Picking Tasks</h3>
      <div class="table-wrap" id="pk-table"><div class="loading">Loading…</div></div></div>`;
    await this.loadInbox();
  },

  async loadInbox() {
    const t = this.el.querySelector('#pk-table');
    const { tasks } = await Api.get('/api/picking/tasks');
    t.innerHTML = `<table><thead><tr><th>Request #</th><th>Warehouse</th><th>Priority</th><th>Task Status</th><th>Reminders</th><th></th></tr></thead>
      <tbody>${tasks.map((tk) => `
        <tr data-id="${tk.id}">
          <td><strong>${UI.esc(tk.request_number)}</strong></td><td>${UI.esc(tk.warehouse_code || '')}</td>
          <td><span class="badge ${tk.priority === 'URGENT' || tk.priority === 'HIGH' ? 'pending' : 'role'}">${tk.priority}</span></td>
          <td><span class="badge ${statusClass(tk.task_status)}">${UI.esc(tk.task_status)}</span></td>
          <td>${tk.reminder_count}${tk.escalation_level ? ` · esc ${tk.escalation_level}` : ''}</td>
          <td><button class="btn sm" data-open="${tk.id}">Open</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No assigned tasks</td></tr>'}
      </tbody></table>`;
    t.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openTask(b.dataset.open)));
  },

  async openTask(taskId) {
    const el = this.el;
    el.innerHTML = '<div class="loading">Loading task…</div>';
    const { task, request, lines, allocations } = await Api.get(`/api/picking/tasks/${taskId}`);
    this.taskId = taskId;

    const allocByLine = {};
    allocations.forEach((a) => { (allocByLine[a.line_id] = allocByLine[a.line_id] || []).push(a); });

    const canAccept = ['Pending Picker Acceptance', 'Assigned to Picker', 'Reminder Sent', 'Escalated to Supervisor'].includes(task.task_status);
    const canStart = task.task_status === 'Accepted by Picker';
    const inProgress = task.task_status === 'Picking in Progress';

    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${UI.esc(task.request_number)}
            <span class="badge ${statusClass(task.task_status)}">${UI.esc(task.task_status)}</span></h3>
          <div class="spacer"></div>
          <button class="btn secondary sm" id="pk-back">← Inbox</button>
          ${canAccept ? '<button class="btn success sm" id="pk-accept">Accept Task</button>' : ''}
          ${canStart ? '<button class="btn sm" id="pk-start">Start Picking</button>' : ''}
          ${inProgress ? '<button class="btn success sm" id="pk-complete">Complete Picking</button>' : ''}
        </div>
        <div class="details-list" style="margin-top:12px">
          <div class="item"><div class="k">Reservation</div><div class="v">${UI.esc(request.erp_reservation_number || request.erp_reference_number || '—')}</div></div>
          <div class="item"><div class="k">Movement</div><div class="v">${UI.esc(request.movement_type || '—')}</div></div>
          <div class="item"><div class="k">Warehouse</div><div class="v">${UI.esc(request.issue_warehouse_code || '—')}</div></div>
        </div>
      </div>

      ${lines.map((l) => this.lineCard(l, allocByLine[l.id] || [], inProgress)).join('')}`;

    const back = el.querySelector('#pk-back');
    if (back) back.addEventListener('click', () => { location.hash = '#/picking'; this.render(el); });

    const accept = el.querySelector('#pk-accept');
    if (accept) accept.addEventListener('click', () => this.action(`/api/picking/tasks/${taskId}/accept`));
    const start = el.querySelector('#pk-start');
    if (start) start.addEventListener('click', () => this.action(`/api/picking/tasks/${taskId}/start`));
    const complete = el.querySelector('#pk-complete');
    if (complete) complete.addEventListener('click', () => this.action(`/api/picking/tasks/${taskId}/complete`, true));

    if (inProgress) {
      el.querySelectorAll('[data-scan]').forEach((b) => b.addEventListener('click', () => this.scan(b.dataset.scan, b.dataset.qr)));
      el.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => this.confirmLine(b.dataset.confirm, Number(b.dataset.approved))));
    }
  },

  lineCard(l, allocs, inProgress) {
    const approved = l.approved_quantity != null ? l.approved_quantity : l.requested_quantity;
    return `
      <div class="card">
        <div class="toolbar mb-0">
          <strong>Line ${l.line_number} · ${UI.esc(l.material_code)} — ${UI.esc(l.material_description || '')}</strong>
          <span class="badge ${statusClass(l.line_status)}">${UI.esc(l.line_status)}</span>
        </div>
        <div class="details-list" style="margin:10px 0">
          <div class="item"><div class="k">Approved</div><div class="v">${UI.fmtQty(approved)} ${UI.esc(l.uom || '')}</div></div>
          <div class="item"><div class="k">Bin</div><div class="v">${UI.esc(l.bin_location || '—')}</div></div>
          <div class="item"><div class="k">Batch</div><div class="v">${UI.esc(l.batch_number || '—')}</div></div>
          <div class="item"><div class="k">Batch-managed</div><div class="v">${l.is_batch_managed ? 'Yes' : 'No'}${l.is_expiry_managed ? ' · FEFO' : ''}</div></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Batch</th><th>Bin</th><th class="text-right">Qty</th><th>Method</th><th>Scan</th></tr></thead>
          <tbody>${allocs.map((a) => `
            <tr>
              <td>${UI.esc(a.batch_number || '')}</td><td>${UI.esc(a.bin_location || '')}</td>
              <td class="text-right">${UI.fmtQty(a.proposed_quantity)}</td><td>${UI.esc(a.allocation_method || '')}</td>
              <td>${a.status === 'SCANNED' || a.status === 'PICKED' ? '<span class="badge active">✓ scanned</span>'
                : inProgress ? `<button class="btn secondary sm" data-scan="${a.id}" data-qr="${UI.esc(this.qrHint(a))}">Scan QR</button>` : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="muted">No stock allocated (shortage)</td></tr>'}</tbody>
        </table></div>
        ${inProgress ? `
          <div class="form-row" style="margin-top:12px;align-items:end">
            <div class="form-group mb-0" style="max-width:160px"><label>Picked Qty</label>
              <input type="number" class="pk-qty" data-line="${l.id}" min="0" step="any" value="${UI.fmtQty(l.reserved_quantity || approved)}"></div>
            <div class="form-group mb-0"><label>Shortage reason (if partial)</label>
              <input type="text" class="pk-short" data-line="${l.id}"></div>
            <div class="form-group mb-0" style="max-width:150px">
              <button class="btn success" data-confirm="${l.id}" data-approved="${approved}">Confirm Line</button></div>
          </div>` : ''}
      </div>`;
  },

  // The seeded demo QR value pattern helps the user scan without a camera.
  qrHint(a) { return ''; },

  async action(url, backToInbox) {
    try {
      const { message } = await Api.post(url, {});
      UI.toast(message);
      if (backToInbox) { location.hash = '#/picking'; this.render(this.el); }
      else this.openTask(this.taskId);
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  scan(allocId, qrHint) {
    UI.modal({ title: 'Scan / enter QR code', submitLabel: 'Validate',
      bodyHtml: `
        <div class="form-group"><label>QR Code value</label>
          <input type="text" id="sc-qr" placeholder="Scan or type QR value…" value="${UI.esc(qrHint || '')}"></div>
        <label class="perm-item"><input type="checkbox" id="sc-override"> <span>Supervisor override (requires reason &amp; authority)</span></label>
        <div class="form-group" style="margin-top:8px"><label>Override reason</label><input type="text" id="sc-reason"></div>`,
      onSubmit: async (ov, close) => {
        const payload = { qr_value: ov.querySelector('#sc-qr').value,
          override: ov.querySelector('#sc-override').checked, override_reason: ov.querySelector('#sc-reason').value };
        try { const r = await Api.post(`/api/picking/allocations/${allocId}/scan`, payload);
          UI.toast(r.message || 'QR validated.'); close(); this.openTask(this.taskId); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
  },

  async confirmLine(lineId, approved) {
    const qty = Number(this.el.querySelector(`.pk-qty[data-line="${lineId}"]`).value);
    const shortage = this.el.querySelector(`.pk-short[data-line="${lineId}"]`).value.trim();
    if (!(qty >= 0)) return UI.toast('Enter a valid picked quantity.', 'error');
    // Mandatory shortage reason when picking less than the approved quantity.
    if (qty < approved && !shortage) {
      return UI.toast(`Picked ${qty} of ${approved} — a shortage reason is required.`, 'error');
    }
    try {
      const { message } = await Api.post(`/api/picking/lines/${lineId}/confirm`, {
        picked_quantity: Number(qty), shortage_reason: shortage });
      UI.toast(message); this.openTask(this.taskId);
    } catch (err) { UI.toast(err.message, 'error'); }
  },
};
