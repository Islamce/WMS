/** Physical Inventory — annual / periodic counting sessions with blind counts,
 *  recounts, variance approval, freeze and adjustment posting. */
window.Pages = window.Pages || {};

Pages.inventory = {
  state: { page: 1 },

  async render(el, sessionId) {
    this.el = el;
    if (sessionId) return this.openSession(sessionId);
    this.meta = await Api.get('/api/meta');
    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${t('Physical Inventory')}</h3>
          <div class="spacer"></div>
          <button class="btn" id="pi-new">+ ${t('New count session')}</button>
        </div>
        <p class="muted" style="margin-top:6px">${t('Annual and periodic counting over a whole warehouse: blind counts, recounts, variance approval and adjustment posting. Freezing blocks receipts/allocations until the count posts.')}</p>
      </div>
      <div class="card">
        <div class="table-wrap" id="pi-table"><div class="loading">${t('Loading…')}</div></div>
        <div class="pagination" id="pi-pagination"></div>
      </div>`;
    el.querySelector('#pi-new').addEventListener('click', () => this.openForm());
    await this.load();
  },

  async load() {
    const box = this.el.querySelector('#pi-table');
    const data = await Api.get(`/api/inventory?page=${this.state.page}`);
    box.innerHTML = `<table>
      <thead><tr><th>${t('Session')}</th><th>${t('Type')}</th><th>${t('Warehouse')}</th><th>${t('Status')}</th>
        <th class="text-right">${t('Lines')}</th><th class="text-right">${t('Counted')}</th>
        <th class="text-right">${t('Variances')}</th><th>${t('Freeze')}</th><th>${t('Created')}</th><th></th></tr></thead>
      <tbody>${data.sessions.map((s) => `
        <tr>
          <td><strong>${UI.esc(s.session_number)}</strong></td>
          <td>${UI.esc(s.session_type)}</td><td>${UI.esc(s.warehouse_code)}</td>
          <td><span class="badge ${statusClass(s.status)}">${UI.esc(s.status)}</span></td>
          <td class="text-right">${s.total_lines}</td><td class="text-right">${s.counted_lines}</td>
          <td class="text-right">${s.variance_lines}</td>
          <td>${s.freeze_stock ? '🧊' : '—'}</td>
          <td>${UI.fmtDate(s.created_at)}</td>
          <td><button class="btn sm" data-open="${s.id}">${t('Open')}</button></td>
        </tr>`).join('') || `<tr><td colspan="10" class="muted">${t('No inventory sessions yet')}</td></tr>`}
      </tbody></table>`;
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openSession(b.dataset.open)));
    UI.pagination(this.el.querySelector('#pi-pagination'), data, (p) => { this.state.page = p; this.load(); });
  },

  openForm() {
    UI.modal({
      title: t('New count session'), submitLabel: t('Open session'),
      bodyHtml: `
        <div class="form-row">
          <div class="form-group"><label>${t('Type')} *</label>
            <select id="pi-type">
              <option value="ANNUAL">${t('Annual inventory')}</option>
              <option value="PERIODIC">${t('Periodic inventory')}</option>
              <option value="CYCLE">${t('Cycle (ad hoc)')}</option>
            </select></div>
          <div class="form-group"><label>${t('Warehouse')} *</label>
            <select id="pi-wh">${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}">${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
        </div>
        <label class="perm-item"><input type="checkbox" id="pi-blind" checked> <span>${t('Blind count — counters cannot see the system quantity')}</span></label>
        <label class="perm-item"><input type="checkbox" id="pi-freeze" checked> <span>${t('Freeze stock — block receipts/allocations in this warehouse until posted')}</span></label>
        <div class="form-group" style="margin-top:8px"><label>${t('Notes')}</label><input type="text" id="pi-notes"></div>`,
      onSubmit: async (ov, close) => {
        try {
          const r = await Api.post('/api/inventory', {
            session_type: ov.querySelector('#pi-type').value,
            warehouse_code: ov.querySelector('#pi-wh').value,
            blind: ov.querySelector('#pi-blind').checked,
            freeze_stock: ov.querySelector('#pi-freeze').checked,
            notes: ov.querySelector('#pi-notes').value,
          });
          UI.toast(r.message); close(); this.openSession(r.id);
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  async openSession(id) {
    const el = this.el;
    const { session: s, lines } = await Api.get(`/api/inventory/${id}`);
    const counting = s.status === 'COUNTING';
    const review = s.status === 'REVIEW';
    const blindHidden = lines.length && lines[0].system_quantity === null;

    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${UI.esc(s.session_number)} <span class="badge ${statusClass(s.status)}">${UI.esc(s.status)}</span></h3>
          <div class="spacer"></div>
          <button class="btn secondary sm" id="pi-back">← ${t('Sessions')}</button>
          ${counting ? `<button class="btn sm" id="pi-review">${t('Move to review')}</button>` : ''}
          ${(counting || review) ? `<button class="btn success sm" id="pi-post">${t('Post adjustments')}</button>
            <button class="btn danger sm" id="pi-cancel">${t('Cancel session')}</button>` : ''}
        </div>
        <p class="muted" style="margin-top:6px">
          ${UI.esc(s.session_type)} · ${UI.esc(s.warehouse_code)} · ${s.blind ? t('blind count') : t('open count')}
          ${s.freeze_stock && (counting || review) ? ` · 🧊 ${t('warehouse frozen')}` : ''}
          ${blindHidden ? ` — ${t('system quantities are hidden until review')}` : ''}
        </p>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>${t('Bin')}</th><th>${t('Batch')}</th><th>${t('Material')}</th>
          <th class="text-right">${t('System')}</th><th class="text-right">${t('Counted')}</th>
          <th class="text-right">${t('Variance')}</th><th>${t('Status')}</th><th>${t('Counter')}</th><th></th></tr></thead>
        <tbody>${lines.map((l) => `
          <tr>
            <td>${UI.esc(l.bin_location || '—')}</td><td>${UI.esc(l.batch_number)}</td>
            <td>${UI.esc(l.material_code)} <span class="muted">${UI.esc(l.material_description || '')}</span></td>
            <td class="text-right">${l.system_quantity === null ? '🔒' : UI.fmtQty(l.system_quantity)}</td>
            <td class="text-right">${l.recount_quantity ?? l.counted_quantity ?? '—'}</td>
            <td class="text-right">${l.variance === null || l.variance === undefined ? '—' : UI.fmtQty(l.variance)}</td>
            <td><span class="badge ${statusClass(l.status)}">${UI.esc(l.status)}</span></td>
            <td>${UI.esc(l.counted_by_name || '—')}</td>
            <td>
              ${counting && ['PENDING', 'RECOUNT'].includes(l.status) ? `<button class="btn sm" data-count="${l.id}">${l.status === 'RECOUNT' ? t('Recount') : t('Count')}</button>` : ''}
              ${counting && l.status === 'COUNTED' ? `
                <button class="btn success sm" data-approve="${l.id}">${t('Approve')}</button>
                <button class="btn secondary sm" data-recount="${l.id}">${t('Recount')}</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div></div>`;

    el.querySelector('#pi-back').addEventListener('click', () => this.render(el));
    const wire = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
    wire('#pi-review', async () => {
      try { const r = await Api.post(`/api/inventory/${id}/review`); UI.toast(r.message); this.openSession(id); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    wire('#pi-post', () => UI.confirm(t('Post all approved counts? Stock will be adjusted and the warehouse unfrozen.'), async () => {
      try { const r = await Api.post(`/api/inventory/${id}/post`); UI.toast(r.message); this.openSession(id); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
    wire('#pi-cancel', () => UI.confirm(t('Cancel this count session? No adjustments will be posted.'), async () => {
      try { const r = await Api.post(`/api/inventory/${id}/cancel`); UI.toast(r.message); this.render(el); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));

    el.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
      UI.modal({ title: t('Enter counted quantity'), submitLabel: t('Record count'),
        bodyHtml: `<div class="form-group"><label>${t('Counted quantity')}</label>
          <input type="number" id="pi-qty" min="0" step="any" autofocus></div>`,
        onSubmit: async (ov, close) => {
          try {
            const r = await Api.post(`/api/inventory/lines/${b.dataset.count}/count`,
              { counted_quantity: Number(ov.querySelector('#pi-qty').value) });
            UI.toast(r.message); close(); this.openSession(id);
          } catch (err) { UI.toast(err.message, 'error'); }
        } });
    }));
    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await Api.post(`/api/inventory/lines/${b.dataset.approve}/approve`); UI.toast(r.message); this.openSession(id); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
    el.querySelectorAll('[data-recount]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await Api.post(`/api/inventory/lines/${b.dataset.recount}/recount`); UI.toast(r.message); this.openSession(id); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  },
};
