/** Picker Assignment — assign pickers, run reminder sweep, view escalations. */
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

  async load() {
    const t = this.el.querySelector('#pa-table');
    const { requests } = await Api.get('/api/warehouse/queue');
    // Show only requests awaiting a picker (plus escalated ones needing
    // reassignment). Once assigned they move to acceptance and disappear here.
    const assignable = requests.filter((r) => ['Pending Picker Assignment', 'Escalated to Supervisor'].includes(r.request_status));
    t.innerHTML = `<table><thead><tr><th>Request #</th><th>Requester</th><th>Department</th><th>Project</th><th>Warehouse</th><th>Priority</th><th>Status</th><th>Picker</th><th></th></tr></thead>
      <tbody>${assignable.map((r) => `
        <tr data-id="${r.id}">
          <td><strong>${UI.esc(r.request_number)}</strong></td>
          <td>${UI.esc(r.requester_name || '')}</td><td>${UI.esc(r.department || '—')}</td><td>${UI.esc(r.project || '—')}</td>
          <td>${UI.esc(r.issue_warehouse_code || '')}</td>
          <td><span class="badge ${r.priority === 'URGENT' || r.priority === 'HIGH' ? 'pending' : 'role'}">${r.priority}</span></td>
          <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
          <td>
            <select class="pa-picker" data-id="${r.id}" style="max-width:180px">
              <option value="">Select picker…</option>
              ${this.pickers.map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join('')}
            </select>
          </td>
          <td><button class="btn sm" data-assign="${r.id}">Assign</button></td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">Nothing to assign</td></tr>'}
      </tbody></table>`;
    t.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', async () => {
      const sel = t.querySelector(`.pa-picker[data-id="${b.dataset.assign}"]`);
      if (!sel.value) return UI.toast('Select a picker.', 'error');
      try { const { message } = await Api.post(`/api/warehouse/${b.dataset.assign}/assign-picker`, { picker_id: Number(sel.value) });
        UI.toast(message); this.load(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  },
};
