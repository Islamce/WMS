/** Create Material Request — header dropdowns + dynamic material lines. */
window.Pages = window.Pages || {};

Pages.createRequest = {
  lines: [],
  meta: null,

  async render(el) {
    this.lines = [];
    this.selected = null;
    try { this.meta = await Api.get('/api/meta'); }
    catch (e) { this.meta = { priorities: ['NORMAL'], requestTypes: ['COST_CENTER'], departments: [], plants: [], costCenters: [] }; }

    const opts = (arr, valueKey, labelKey) =>
      arr.map((o) => `<option value="${UI.esc(o[valueKey])}">${UI.esc(o[labelKey])}</option>`).join('');

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
            <div class="form-group"><label>Department</label>
              <select id="cr-department"><option value="">— Select —</option>${opts(this.meta.departments, 'code', 'label')}</select></div>
            <div class="form-group"><label>Required Date</label><input type="date" id="cr-required" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Plant</label>
              <select id="cr-plant"><option value="">— Select —</option>${opts(this.meta.plants, 'code', 'label')}</select></div>
            <div class="form-group"><label>Cost Center</label>
              <select id="cr-cost-center"><option value="">— Select —</option>${opts(this.meta.costCenters, 'code', 'label')}</select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>WBS Element</label><input type="text" id="cr-wbs" /></div>
            <div class="form-group"><label>Internal / Production Order</label><input type="text" id="cr-order" /></div>
          </div>
          <div class="form-group"><label>Purpose / Justification <span class="muted">(optional)</span></label><textarea id="cr-purpose" rows="2"></textarea></div>

          <h3 style="margin-top:10px">Material Lines</h3>
          <div class="form-row" style="align-items:end">
            <div class="form-group autocomplete mb-0">
              <label>Material</label>
              <input type="text" id="cr-material" placeholder="Click to browse or type to search…" autocomplete="off" />
              <div class="hint" id="cr-avail"></div>
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
            <thead><tr><th>#</th><th>Item Code</th><th>Description</th><th>Unit</th><th class="text-right">Qty</th><th class="text-right">Available</th><th></th></tr></thead>
            <tbody><tr><td colspan="7" class="muted">No lines yet — pick a material and add it.</td></tr></tbody>
          </table></div>

          <div class="actions" style="justify-content:flex-start;margin-top:16px">
            <button type="button" class="btn secondary" id="cr-save-draft">Save Draft</button>
            <button type="submit" class="btn">Create &amp; Submit</button>
          </div>
        </form>
      </div>`;

    const availEl = el.querySelector('#cr-avail');
    UI.materialAutocomplete(el.querySelector('#cr-material'), (m) => {
      this.selected = m;
      const avail = Number(m.total_available || 0);
      availEl.innerHTML = `Available stock: <strong>${UI.fmtQty(avail)} ${UI.esc(m.unit)}</strong>`;
      availEl.style.color = avail > 0 ? 'var(--text-muted)' : 'var(--danger)';
      this.checkQty();
    });
    el.querySelector('#cr-material').addEventListener('input', () => { this.selected = null; availEl.innerHTML = ''; });
    el.querySelector('#cr-qty').addEventListener('input', () => this.checkQty());
    el.querySelector('#cr-add-line').addEventListener('click', () => this.addLine());
    el.querySelector('#cr-save-draft').addEventListener('click', (e) => this.submit(false, e.currentTarget));
    el.querySelector('#cr-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(true, e.currentTarget.querySelector('button[type=submit]'));
    });
  },

  /** Live "stock not enough" note under the quantity field. */
  checkQty() {
    const availEl = document.getElementById('cr-avail');
    if (!this.selected || !availEl) return;
    const qty = Number(document.getElementById('cr-qty').value);
    const avail = Number(this.selected.total_available || 0);
    if (qty > 0 && qty > avail) {
      availEl.innerHTML = `⚠️ Stock not enough — requested ${UI.fmtQty(qty)}, available <strong>${UI.fmtQty(avail)} ${UI.esc(this.selected.unit)}</strong>. You can still request it (it will show as a shortage at picking).`;
      availEl.style.color = 'var(--danger)';
    } else {
      availEl.innerHTML = `Available stock: <strong>${UI.fmtQty(avail)} ${UI.esc(this.selected.unit)}</strong>`;
      availEl.style.color = 'var(--text-muted)';
    }
  },

  addLine() {
    const qty = Number(document.getElementById('cr-qty').value);
    if (!this.selected) return UI.toast('Pick a material from the list first.', 'error');
    if (!(qty > 0)) return UI.toast('Quantity must be greater than zero.', 'error');
    const avail = Number(this.selected.total_available || 0);
    this.lines.push({ material_id: this.selected.id, item_code: this.selected.item_code,
      description: this.selected.description, unit: this.selected.unit, requested_quantity: qty, available: avail });
    this.selected = null;
    document.getElementById('cr-material').value = '';
    document.getElementById('cr-qty').value = '';
    document.getElementById('cr-avail').innerHTML = '';
    this.renderLines();
  },

  renderLines() {
    const tbody = document.querySelector('#cr-lines tbody');
    if (!this.lines.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No lines yet — pick a material and add it.</td></tr>';
      return;
    }
    tbody.innerHTML = this.lines.map((l, i) => {
      const short = l.requested_quantity > l.available;
      return `
      <tr>
        <td>${i + 1}</td><td><strong>${UI.esc(l.item_code)}</strong></td>
        <td class="wrap">${UI.esc(l.description)}</td><td>${UI.esc(l.unit)}</td>
        <td class="text-right">${UI.fmtQty(l.requested_quantity)}</td>
        <td class="text-right">${UI.fmtQty(l.available)} ${short ? '<span class="badge OUT">short</span>' : ''}</td>
        <td><button type="button" class="btn danger sm" data-rm="${i}">Remove</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      this.lines.splice(Number(b.dataset.rm), 1); this.renderLines();
    }));
  },

  async submit(thenSubmit, btn) {
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
      purpose: document.getElementById('cr-purpose').value,
      lines: this.lines.map((l) => ({ material_id: l.material_id, requested_quantity: l.requested_quantity })),
    };
    await UI.withBusy(btn, async () => {
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
    });
  },
};
