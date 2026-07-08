/** Create Material Request — header fields + dynamic material lines. */
window.Pages = window.Pages || {};

Pages.createRequest = {
  lines: [],
  meta: null,

  async render(el) {
    this.lines = [];
    try { this.meta = await Api.get('/api/meta'); } catch (e) { this.meta = { priorities: ['NORMAL'], requestTypes: ['COST_CENTER'] }; }

    el.innerHTML = `
      <div class="card" style="max-width:900px">
        <h3>Create Material Request</h3>
        <form id="cr-form" novalidate>
          <div class="form-row">
            <div class="form-group"><label>Request Type</label>
              <select id="cr-type">${this.meta.requestTypes.map((t) => `<option>${t}</option>`).join('')}</select></div>
            <div class="form-group"><label>Priority</label>
              <select id="cr-priority">${this.meta.priorities.map((p) => `<option ${p === 'NORMAL' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Department</label><input type="text" id="cr-department" /></div>
            <div class="form-group"><label>Required Date</label><input type="date" id="cr-required" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Plant</label><input type="text" id="cr-plant" value="P100" /></div>
            <div class="form-group"><label>Cost Center</label><input type="text" id="cr-cost-center" placeholder="e.g. CC-1000" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>WBS Element</label><input type="text" id="cr-wbs" /></div>
            <div class="form-group"><label>Internal / Production Order</label><input type="text" id="cr-order" /></div>
          </div>
          <div class="form-group"><label>Purpose / Justification *</label><textarea id="cr-purpose" rows="2" required></textarea></div>

          <h3 style="margin-top:10px">Material Lines</h3>
          <div class="form-row" style="align-items:end">
            <div class="form-group autocomplete mb-0">
              <label>Material</label>
              <input type="text" id="cr-material" placeholder="Search item code / description…" autocomplete="off" />
            </div>
            <div class="form-group mb-0" style="max-width:160px">
              <label>Quantity</label>
              <input type="number" id="cr-qty" min="0" step="any" />
            </div>
            <div class="form-group mb-0" style="max-width:120px">
              <button type="button" class="btn secondary" id="cr-add-line">+ Add line</button>
            </div>
          </div>
          <div class="table-wrap" style="margin-top:12px"><table id="cr-lines">
            <thead><tr><th>#</th><th>Item Code</th><th>Description</th><th>Unit</th><th class="text-right">Qty</th><th></th></tr></thead>
            <tbody><tr><td colspan="6" class="muted">No lines yet — search a material and add it.</td></tr></tbody>
          </table></div>

          <div class="actions" style="justify-content:flex-start;margin-top:16px">
            <button type="button" class="btn secondary" id="cr-save-draft">Save Draft</button>
            <button type="submit" class="btn">Create & Submit</button>
          </div>
        </form>
      </div>`;

    this.selected = null;
    UI.materialAutocomplete(el.querySelector('#cr-material'), (m) => { this.selected = m; });
    el.querySelector('#cr-add-line').addEventListener('click', () => this.addLine());
    el.querySelector('#cr-save-draft').addEventListener('click', () => this.submit(false));
    el.querySelector('#cr-form').addEventListener('submit', (e) => { e.preventDefault(); this.submit(true); });
  },

  addLine() {
    const qty = Number(document.getElementById('cr-qty').value);
    if (!this.selected) return UI.toast('Select a material from the list first.', 'error');
    if (!(qty > 0)) return UI.toast('Quantity must be greater than zero.', 'error');
    this.lines.push({ material_id: this.selected.id, item_code: this.selected.item_code,
      description: this.selected.description, unit: this.selected.unit, requested_quantity: qty });
    this.selected = null;
    document.getElementById('cr-material').value = '';
    document.getElementById('cr-qty').value = '';
    this.renderLines();
  },

  renderLines() {
    const tbody = document.querySelector('#cr-lines tbody');
    if (!this.lines.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No lines yet — search a material and add it.</td></tr>';
      return;
    }
    tbody.innerHTML = this.lines.map((l, i) => `
      <tr>
        <td>${i + 1}</td><td><strong>${UI.esc(l.item_code)}</strong></td>
        <td class="wrap">${UI.esc(l.description)}</td><td>${UI.esc(l.unit)}</td>
        <td class="text-right">${UI.fmtQty(l.requested_quantity)}</td>
        <td><button type="button" class="btn danger sm" data-rm="${i}">Remove</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      this.lines.splice(Number(b.dataset.rm), 1); this.renderLines();
    }));
  },

  async submit(thenSubmit) {
    const purpose = document.getElementById('cr-purpose').value.trim();
    if (!purpose) return UI.toast('Purpose / justification is required.', 'error');
    if (!this.lines.length) return UI.toast('Add at least one material line.', 'error');

    const payload = {
      request_type: document.getElementById('cr-type').value,
      priority: document.getElementById('cr-priority').value,
      department: document.getElementById('cr-department').value,
      required_date: document.getElementById('cr-required').value || null,
      plant: document.getElementById('cr-plant').value,
      cost_center: document.getElementById('cr-cost-center').value,
      wbs_element: document.getElementById('cr-wbs').value,
      internal_order: document.getElementById('cr-order').value,
      purpose,
      lines: this.lines.map((l) => ({ material_id: l.material_id, requested_quantity: l.requested_quantity })),
    };
    try {
      const { id, request_number } = await Api.post('/api/requests', payload);
      if (thenSubmit) {
        await Api.post(`/api/requests/${id}/submit`);
        UI.toast(`Request ${request_number} submitted for approval.`);
      } else {
        UI.toast(`Draft ${request_number} saved.`);
      }
      location.hash = `#/request-detail/${id}`;
    } catch (err) { UI.toast(err.message, 'error'); }
  },
};
