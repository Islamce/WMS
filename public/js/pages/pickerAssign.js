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
      <div id="pa-list"><div class="loading">Loading picker assignments…</div></div>`;
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
    const list = this.el.querySelector('#pa-list');
    const { requests } = await Api.get('/api/warehouse/queue');
    const visible = requests.filter((request) => this.isAssignmentRow(request));
    list.innerHTML = visible.length
      ? visible.map((request) => UI.requestCard(request, {
        pickerHtml: `<span class="muted">Current picker</span><br>${this.pickerEvidence(request)}`,
        actionHtml: this.assignmentAction(request),
        extraHtml: `<div class="request-card-meta">ERP ${UI.esc(request.erp_reservation_number || request.erp_reference_number || '—')} · Movement ${UI.esc(request.movement_type || '—')} · Plant ${UI.esc(request.plant || '—')} · SLoc ${UI.esc(request.storage_location || '—')}</div>`,
      })).join('')
      : UI.meaningfulEmptyState({
        title: 'No picker assignments need attention',
        description: 'There are no requests currently awaiting picker assignment or supervisor reassignment. Assigned tasks remain visible here while they await a picker response.',
      });
    list.querySelectorAll('[data-assign]').forEach((button) => button.addEventListener('click', async () => {
      const select = list.querySelector(`.pa-picker[data-id="${button.dataset.assign}"]`);
      if (!select.value) return UI.toast('Select a picker.', 'error');
      try {
        const { message } = await Api.post(`/api/warehouse/${button.dataset.assign}/assign-picker`, { picker_id: Number(select.value) });
        UI.toast(message);
        this.load();
      } catch (err) { UI.toast(err.message, 'error'); }
    }));
  },
};
