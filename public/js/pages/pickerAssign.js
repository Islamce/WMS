/** Picker Assignment — assign pickers, run reminder sweep, and make active-task state visible. */
window.Pages = window.Pages || {};

Pages.pickerAssign = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">Picker Assignment</h3>
          <div class="spacer"></div>
          <button class="btn secondary sm" id="pa-sweep">Run reminder sweep</button>
        </div>
      </div>
      <div class="card"><div class="table-wrap" id="pa-table"><div class="loading">Loading…</div></div></div>`;
    try { ({ pickers: this.pickers } = await Api.get('/api/warehouse/pickers')); } catch { this.pickers = []; }
    el.querySelector('#pa-sweep').addEventListener('click', async () => {
      try { const { message } = await Api.post('/api/picking/sweep', {}); UI.toast(message); this.load(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    await this.load();
  },

  isAssignmentRow(request) {
    return [
      'Pending Picker Assignment', 'Assigned to Picker', 'Pending Picker Acceptance',
      'Reminder Sent', 'Escalated to Supervisor',
    ].includes(request.request_status);
  },

  pickerEvidence(request) {
    if (!request.active_task_id) return '<span class="muted">No picker assigned</span>';
    const picker = UI.esc(request.active_assigned_picker_name || 'Unrecorded picker');
    const reminders = Number(request.active_reminder_count || 0);
    const escalation = Number(request.active_escalation_level || 0);
    const detail = [];
    if (reminders) detail.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`);
    if (escalation) detail.push(`escalation ${escalation}`);
    return `<strong>${picker}</strong><div class="muted sm">${detail.join(' · ') || UI.esc(request.active_task_status || 'Task assigned')}</div>`;
  },

  assignmentAction(request) {
    const escalated = request.request_status === 'Escalated to Supervisor';
    const needsAssignment = request.request_status === 'Pending Picker Assignment' && !request.active_task_id;
    if (!escalated && !needsAssignment) return '<span class="muted">Awaiting picker response</span>';
    const action = escalated ? 'Reassign' : 'Assign';
    const title = escalated
      ? 'Choose a replacement picker. The current task remains in the audit trail.'
      : 'Choose a picker for this unassigned request.';
    return `<div class="form-group" style="margin:0;min-width:180px" title="${title}">
      <select class="pa-picker" data-id="${request.id}" aria-label="${action} picker for ${UI.esc(request.request_number)}">
        <option value="">Select picker…</option>
        ${this.pickers.map((picker) => `<option value="${picker.id}">${UI.esc(picker.name)}</option>`).join('')}
      </select>
      <button class="btn sm" style="margin-top:6px" data-assign="${request.id}">${action}</button>
    </div>`;
  },

  async load() {
    const table = this.el.querySelector('#pa-table');
    const { requests } = await Api.get('/api/warehouse/queue');
    const visible = requests.filter((request) => this.isAssignmentRow(request));
    table.innerHTML = `<table><thead><tr><th>Request / ERP</th><th>Requester</th><th>Warehouse</th><th>Priority</th><th>Assignment state</th><th>Current picker</th><th>Action</th></tr></thead>
      <tbody>${visible.map((request) => `
        <tr data-id="${request.id}">
          <td><strong>${UI.esc(request.request_number)}</strong>
            <div class="muted sm">ERP ${UI.esc(request.erp_reservation_number || request.erp_reference_number || '—')} · MvT ${UI.esc(request.movement_type || '—')} · Plant ${UI.esc(request.plant || '—')}</div></td>
          <td>${UI.esc(request.requester_name || '')}<div class="muted sm">${UI.esc(request.department || '—')} · ${UI.esc(request.project || '—')}</div></td>
          <td>${UI.esc(request.issue_warehouse_code || '')}<div class="muted sm">SLoc ${UI.esc(request.storage_location || '—')}</div></td>
          <td><span class="badge ${request.priority === 'URGENT' || request.priority === 'HIGH' ? 'pending' : 'role'}">${UI.esc(request.priority || '—')}</span></td>
          <td><span class="badge ${statusClass(request.request_status)}">${UI.esc(request.request_status)}</span></td>
          <td>${this.pickerEvidence(request)}</td>
          <td>${this.assignmentAction(request)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No picker assignments need attention</td></tr>'}
      </tbody></table>`;
    table.querySelectorAll('[data-assign]').forEach((button) => button.addEventListener('click', async () => {
      const select = table.querySelector(`.pa-picker[data-id="${button.dataset.assign}"]`);
      if (!select.value) return UI.toast('Select a picker.', 'error');
      try {
        const { message } = await Api.post(`/api/warehouse/${button.dataset.assign}/assign-picker`, { picker_id: Number(select.value) });
        UI.toast(message);
        this.load();
      } catch (err) { UI.toast(err.message, 'error'); }
    }));
  },
};
