/** Request Detail — full header, lines, allocations, task, and audit timeline. */
window.Pages = window.Pages || {};

// Statuses eligible for the generic "reverse one step" action — mirrors
// REVERSE_TARGET in server/workflow/states.js. The server is the actual
// authority on both eligibility and per-stage permission; this list only
// decides whether to show the button.
const REVERSIBLE_STATUSES = [
  'Pending Manager Approval', 'Under Review',
  'Approved - Pending ERP Processing', 'Pending ERP Reservation', 'ERP Reservation Created', 'Movement Type Assigned',
  'Warehouse Assigned', 'Pending Warehouse Action', 'Pending Bin Location Assignment', 'Location Assigned', 'Batch Assigned',
  'Pending Picker Assignment', 'Assigned to Picker', 'Pending Picker Acceptance', 'Reminder Sent',
  'Escalated to Supervisor', 'Accepted by Picker', 'Picking in Progress',
  'Pending ERP GI', 'ERP Error',
];

Pages.requestDetail = {
  async render(el, id) {
    if (!id) { el.innerHTML = '<div class="inline-alert error">No request id.</div>'; return; }
    this.id = id;
    el.innerHTML = '<div class="loading">Loading request…</div>';
    let data;
    try { data = await Api.get(`/api/requests/${id}`); }
    catch (err) { el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    const r = data.request;
    const queueContext = Pages.requests?.getQueueContext?.() || { isFiltered: false, summary: 'All requests' };
    const backLabel = queueContext.isFiltered ? '← Back to filtered requests' : '← Back to requests';

    const actionHtml = `<a href="#/requests" class="btn secondary sm" title="${UI.esc(queueContext.summary)}">${backLabel}</a>
      ${App.can('audit_trail')
        ? `<button class="btn secondary sm" id="rd-history" title="${t('Change history')}">ℹ ${t('History')}</button>` : ''}
      ${['Draft', 'Returned to Requester'].includes(r.request_status) && App.can('create_request')
        ? `<button class="btn sm" id="rd-submit">Submit</button>` : ''}
      ${!['Completed', 'Cancelled', 'GI Posted', 'Rejected'].includes(r.request_status)
        ? `<button class="btn danger sm" id="rd-cancel">Cancel</button>` : ''}
      ${['Completed', 'Partially Completed', 'Closed with Shortage'].includes(r.request_status) && App.can('gi_posting')
        ? `<button class="btn warn sm" id="rd-reverse-gi">Reverse GI</button>` : ''}
      ${REVERSIBLE_STATUSES.includes(r.request_status)
        ? `<button class="btn warn sm" id="rd-reverse-step" title="${t('Send this request back one step, undoing what the stage did')}">↩ ${t('Reverse one step')}</button>` : ''}`;

    el.innerHTML = `
      ${UI.operationalObjectHeader(r, { title: 'Material Request', subtitle: r.purpose || 'Request workflow and execution context', primaryAction: actionHtml })}
      ${queueContext.isFiltered ? `<div class="queue-return-context" role="status"><strong>Queue context retained</strong><span>${UI.esc(queueContext.summary)}</span></div>` : ''}

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
          <div class="item"><div class="k">Reservation #</div><div class="v">${r.erp_reservation_number || r.erp_reference_number ? `<span class="chip accent">${UI.esc(r.erp_reservation_number || r.erp_reference_number)}</span>` : '—'}</div></div>
          <div class="item"><div class="k">ERP Reference #</div><div class="v">${UI.esc(r.erp_reference_number || '—')}</div></div>
          <div class="item"><div class="k">Warehouse</div><div class="v">${UI.esc(r.issue_warehouse_code || '—')}</div></div>
          <div class="item"><div class="k">Storage Location</div><div class="v">${UI.esc(r.storage_location || '—')}</div></div>
          <div class="item"><div class="k">GI Document</div><div class="v">${r.gi_document_number ? `<span class="chip">${UI.esc(r.gi_document_number)}</span>` : '—'}</div></div>
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
                <td>${l.batch_number ? `<span class="chip accent">${UI.esc(l.batch_number)}</span>` : '—'}</td>
                <td>${l.bin_location ? `<span class="chip">${UI.esc(l.bin_location)}</span>` : '—'}</td>
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

      <div class="card" id="rd-attachments">
        <h3>${t('Attachments')}</h3>
        <div class="attach-upload">
          <input type="file" id="rd-file" />
          <button class="btn sm" id="rd-upload">${t('Upload file')}</button>
        </div>
        <div id="rd-attach-list" class="muted">${t('Loading…')}</div>
      </div>`;

    this.loadAttachments(el, id);

    const submitBtn = el.querySelector('#rd-submit');
    if (submitBtn) submitBtn.addEventListener('click', (e) => UI.withBusy(e.currentTarget, async () => {
      try { await Api.post(`/api/requests/${id}/submit`); UI.toast('Submitted for approval.'); this.render(el, id); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
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
    const reverseGiBtn = el.querySelector('#rd-reverse-gi');
    if (reverseGiBtn) reverseGiBtn.addEventListener('click', () => {
      UI.modal({ title: 'Reverse Goods Issue', submitLabel: 'Reverse GI',
        bodyHtml: '<p class="hint">This returns the issued stock to its batches and closes the request as Reversed.</p>'
          + '<div class="form-group"><label>Reason</label><input type="text" id="rv-reason" /></div>',
        onSubmit: async (ov, close) => {
          try { await Api.post(`/api/gi/${id}/reverse`, { reason: ov.querySelector('#rv-reason').value });
            UI.toast('Goods issue reversed.'); close(); this.render(el, id); }
          catch (err) { UI.toast(err.message, 'error'); }
        } });
    });
    const reverseStepBtn = el.querySelector('#rd-reverse-step');
    if (reverseStepBtn) reverseStepBtn.addEventListener('click', () => {
      UI.modal({ title: t('Reverse one step'), submitLabel: t('Reverse'),
        bodyHtml: `<p class="hint">${t('Sends this request back to the previous stage, undoing what the current stage did (releases any reservation, allocation or picking task it holds).')}</p>`
          + `<div class="form-group"><label>${t('Reason')}</label><input type="text" id="rv-step-reason" /></div>`,
        onSubmit: async (ov, close) => {
          try {
            const r2 = await Api.post(`/api/requests/${id}/reverse`, { reason: ov.querySelector('#rv-step-reason').value });
            UI.toast(r2.message); close(); this.render(el, id);
          } catch (err) { UI.toast(err.message, 'error'); }
        } });
    });

    const uploadBtn = el.querySelector('#rd-upload');
    if (uploadBtn) uploadBtn.addEventListener('click', () => this.upload(el, id));

    const historyBtn = el.querySelector('#rd-history');
    if (historyBtn) historyBtn.addEventListener('click', () => this.showHistory(r.request_number));
  },

  /** Change history in a wide modal — kept off the main page for a cleaner view. */
  async showHistory(requestNumber) {
    let audit = [];
    try {
      ({ audit } = await Api.get(`/api/master/audit?request_number=${encodeURIComponent(requestNumber)}&limit=200`));
    } catch (err) { return UI.toast(err.message, 'error'); }
    const rows = (audit || []).map((a) => `
      <tr>
        <td style="white-space:nowrap">${UI.fmtDate(a.changed_at)}</td>
        <td><span class="badge">${UI.esc(String(a.action || '').replace(/_/g, ' '))}</span></td>
        <td>${UI.esc(a.changed_by_name || '—')}<div class="muted sm">${UI.esc(a.user_role || '')}</div></td>
        <td class="wrap">${UI.esc([a.old_value, a.new_value].filter(Boolean).join(' → ') || '—')}</td>
        <td class="wrap">${UI.esc(a.reason || a.comments || '—')}</td>
      </tr>`).join('');
    UI.modal({
      title: `${t('Change history')} — ${requestNumber}`, wide: true, submitLabel: t('Close'),
      bodyHtml: rows
        ? `<div class="table-wrap" style="max-height:60vh;overflow:auto"><table>
            <thead><tr><th>${t('When')}</th><th>${t('Action')}</th><th>${t('By')}</th><th>${t('Change')}</th><th>${t('Reason')}</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : `<p class="muted">${t('No recorded changes for this request yet.')}</p>`,
    });
  },

  async loadAttachments(el, id) {
    const box = el.querySelector('#rd-attach-list');
    if (!box) return;
    try {
      const { attachments } = await Api.get(`/api/requests/${id}/attachments`);
      if (!attachments.length) { box.innerHTML = `<span class="muted">${t('No attachments')}</span>`; return; }
      box.classList.remove('muted');
      box.innerHTML = `<ul class="attach-list">${attachments.map((a) => `
        <li>
          <a href="#" data-dl="${a.id}">${UI.esc(a.file_name)}</a>
          <span class="muted sm">${(a.byte_size / 1024).toFixed(0)} KB · ${UI.esc(a.uploaded_by_name || '')}</span>
          <button class="btn sm danger" data-del="${a.id}" aria-label="${t('Delete')}">✕</button>
        </li>`).join('')}</ul>`;
      box.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault(); this.download(a.dataset.dl);
      }));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        UI.confirm(t('Delete this attachment? This cannot be undone.'), async () => {
          try { await Api.delete(`/api/attachments/${b.dataset.del}`); UI.toast(t('Attachment deleted.')); this.loadAttachments(el, id); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
      }));
    } catch (err) { box.innerHTML = `<span class="muted">${UI.esc(err.message)}</span>`; }
  },

  upload(el, id) {
    const input = el.querySelector('#rd-file');
    const file = input && input.files[0];
    if (!file) return UI.toast(t('Choose a file first.'), 'error');
    if (file.size > 1.5 * 1024 * 1024) return UI.toast(t('File exceeds the 1.5 MB limit.'), 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = String(reader.result).split(',')[1] || '';
      try {
        await Api.post(`/api/requests/${id}/attachments`,
          { file_name: file.name, content_type: file.type || 'application/octet-stream', data_base64: b64 });
        UI.toast(t('Attachment uploaded.')); input.value = ''; this.loadAttachments(el, id);
      } catch (err) { UI.toast(err.message, 'error'); }
    };
    reader.readAsDataURL(file);
  },

  async download(aid) {
    try {
      const blob = await Api.blob(`/api/attachments/${aid}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { UI.toast(err.message, 'error'); }
  },
};
