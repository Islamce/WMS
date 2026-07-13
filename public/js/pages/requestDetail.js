/** Request Detail — full header, lines, allocations, task, and audit timeline. */
window.Pages = window.Pages || {};

Pages.requestDetail = {
  async render(el, id) {
    if (!id) { el.innerHTML = '<div class="inline-alert error">No request id.</div>'; return; }
    this.id = id;
    el.innerHTML = '<div class="loading">Loading request…</div>';
    let data;
    try { data = await Api.get(`/api/requests/${id}`); }
    catch (err) { el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    const r = data.request;

    let audit = [];
    if (App.can('audit_trail')) {
      try { ({ audit } = await Api.get(`/api/master/audit?request_number=${encodeURIComponent(r.request_number)}&limit=100`)); } catch {}
    }

    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${UI.esc(r.request_number)}
            <span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></h3>
          <div class="spacer"></div>
          <a href="#/requests" class="btn secondary sm">← Back</a>
          ${['Draft', 'Returned to Requester'].includes(r.request_status) && App.can('create_request')
            ? `<button class="btn sm" id="rd-submit">Submit</button>` : ''}
          ${!['Completed', 'Cancelled', 'GI Posted', 'Rejected'].includes(r.request_status)
            ? `<button class="btn danger sm" id="rd-cancel">Cancel</button>` : ''}
          ${['Completed', 'Partially Completed', 'Closed with Shortage'].includes(r.request_status) && App.can('gi_posting')
            ? `<button class="btn warn sm" id="rd-reverse">Reverse GI</button>` : ''}
        </div>
      </div>

      <div class="card">
        <h3>Header</h3>
        <div class="details-list">
          <div class="item"><div class="k">Requester</div><div class="v">${UI.esc(r.requester_name || '')}</div></div>
          <div class="item"><div class="k">Priority</div><div class="v">${UI.esc(r.priority)}</div></div>
          <div class="item"><div class="k">Department</div><div class="v">${UI.esc(r.department || '—')}</div></div>
          <div class="item"><div class="k">Required Date</div><div class="v">${r.required_date || '—'}</div></div>
          <div class="item"><div class="k">Plant</div><div class="v">${UI.esc(r.plant || '—')}</div></div>
          <div class="item"><div class="k">Cost Center</div><div class="v">${UI.esc(r.cost_center || '—')}</div></div>
          <div class="item"><div class="k">WBS</div><div class="v">${UI.esc(r.wbs_element || '—')}</div></div>
          <div class="item"><div class="k">Movement Type</div><div class="v">${UI.esc(r.movement_type || '—')}</div></div>
          <div class="item"><div class="k">Reservation #</div><div class="v">${UI.esc(r.erp_reservation_number || r.erp_reference_number || '—')}</div></div>
          <div class="item"><div class="k">Warehouse</div><div class="v">${UI.esc(r.issue_warehouse_code || '—')}</div></div>
          <div class="item"><div class="k">GI Document</div><div class="v">${UI.esc(r.gi_document_number || '—')}</div></div>
          <div class="item"><div class="k">ERP Status</div><div class="v">${UI.esc(r.erp_posting_status || '—')}</div></div>
        </div>
        <p class="muted" style="margin-top:10px"><strong>Purpose:</strong> ${UI.esc(r.purpose || '')}</p>
        ${r.erp_error_message ? `<div class="inline-alert error" style="margin-top:10px">ERP Error: ${UI.esc(r.erp_error_message)}</div>` : ''}
      </div>

      <div class="card">
        <h3>Material Lines</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Item</th><th>Description</th><th class="text-right">Req</th><th class="text-right">Appr</th>
            <th class="text-right">Picked</th><th>Batch</th><th>Bin</th><th>Status</th></tr></thead>
          <tbody>
            ${data.lines.map((l) => `
              <tr>
                <td>${l.line_number}</td><td><strong>${UI.esc(l.material_code)}</strong></td>
                <td class="wrap">${UI.esc(l.material_description || '')}</td>
                <td class="text-right">${UI.fmtQty(l.requested_quantity)}</td>
                <td class="text-right">${l.approved_quantity != null ? UI.fmtQty(l.approved_quantity) : '—'}</td>
                <td class="text-right">${UI.fmtQty(l.picked_quantity)}</td>
                <td>${UI.esc(l.batch_number || '—')}</td>
                <td>${UI.esc(l.bin_location || '—')}</td>
                <td><span class="badge ${statusClass(l.line_status)}">${UI.esc(l.line_status)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      ${data.task ? `
      <div class="card">
        <h3>Picking Task</h3>
        <div class="details-list">
          <div class="item"><div class="k">Picker</div><div class="v">${UI.esc(data.task.assigned_picker_name || '—')}</div></div>
          <div class="item"><div class="k">Status</div><div class="v">${UI.esc(data.task.task_status)}</div></div>
          <div class="item"><div class="k">Reminders</div><div class="v">${data.task.reminder_count}</div></div>
          <div class="item"><div class="k">Escalation</div><div class="v">${data.task.escalation_level}</div></div>
        </div>
      </div>` : ''}

      ${audit.length ? `
      <div class="card">
        <h3>Audit Trail</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Action</th><th>By</th><th>Role</th><th>Old → New</th><th>Reason</th></tr></thead>
          <tbody>
            ${audit.map((a) => `
              <tr>
                <td>${UI.fmtDate(a.changed_at)}</td><td>${UI.esc(a.action)}</td>
                <td>${UI.esc(a.changed_by_name || '')}</td><td>${UI.esc(a.user_role || '')}</td>
                <td class="wrap">${UI.esc([a.old_value, a.new_value].filter(Boolean).join(' → '))}</td>
                <td class="wrap">${UI.esc(a.reason || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}`;

    const submitBtn = el.querySelector('#rd-submit');
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      try { await Api.post(`/api/requests/${id}/submit`); UI.toast('Submitted for approval.'); this.render(el, id); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    const cancelBtn = el.querySelector('#rd-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      UI.modal({ title: 'Cancel request', submitLabel: 'Cancel Request',
        bodyHtml: '<div class="form-group"><label>Reason</label><input type="text" id="cx-reason" /></div>',
        onSubmit: async (ov, close) => {
          try { await Api.post(`/api/requests/${id}/cancel`, { reason: ov.querySelector('#cx-reason').value });
            UI.toast('Request cancelled.'); close(); this.render(el, id); }
          catch (err) { UI.toast(err.message, 'error'); }
        } });
    });
    const reverseBtn = el.querySelector('#rd-reverse');
    if (reverseBtn) reverseBtn.addEventListener('click', () => {
      UI.modal({ title: 'Reverse Goods Issue', submitLabel: 'Reverse GI',
        bodyHtml: '<p class="hint">This returns the issued stock to its batches and closes the request as Reversed.</p>'
          + '<div class="form-group"><label>Reason</label><input type="text" id="rv-reason" /></div>',
        onSubmit: async (ov, close) => {
          try { await Api.post(`/api/gi/${id}/reverse`, { reason: ov.querySelector('#rv-reason').value });
            UI.toast('Goods issue reversed.'); close(); this.render(el, id); }
          catch (err) { UI.toast(err.message, 'error'); }
        } });
    });
  },
};
