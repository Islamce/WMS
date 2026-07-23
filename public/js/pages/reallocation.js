/** Governed Stock Reallocation — request, approve/reject, then execute. */
window.Pages = window.Pages || {};

Pages.reallocation = {
  state: { page: 1, search: '', status: '' },

  async render(el) {
    this.el = el;
    this.meta = await Api.get('/api/meta');
    const canRequest = App.can('reallocation');
    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${t('Stock Reallocation')}</h3>
          <div class="spacer"></div>
          ${canRequest ? `<button class="btn" id="ra-new">+ ${t('New reallocation')}</button>` : ''}
        </div>
        <p class="muted" style="margin-top:6px">${t('Governed flow: request, independent approval or rejection, then controlled execution. Reserved or frozen stock never moves.')}</p>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="ra-search" placeholder="${t('Search reallocation #, material, batch…')}">
          <select id="ra-status" aria-label="${t('Status filter')}">
            <option value="">${t('All statuses')}</option>
            ${['PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED'].map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap" id="ra-table"><div class="loading">${t('Loading…')}</div></div>
        <div class="pagination" id="ra-pagination"></div>
      </div>`;
    el.querySelector('#ra-new')?.addEventListener('click', () => this.openForm());
    el.querySelector('#ra-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value; this.state.page = 1; this.load();
    }, 300));
    el.querySelector('#ra-status').addEventListener('change', (e) => {
      this.state.status = e.target.value; this.state.page = 1; this.load();
    });
    await this.load();
  },

  async load() {
    const box = this.el.querySelector('#ra-table');
    const data = await Api.get(`/api/reallocation?page=${this.state.page}&search=${encodeURIComponent(this.state.search)}&status=${encodeURIComponent(this.state.status)}`);
    const canApprove = App.can('bin_batch_assignment');
    box.innerHTML = `<table>
      <thead><tr><th>#</th><th>Material / Batch</th><th class="text-right">Qty</th>
        <th>From</th><th>To</th><th>Requester</th><th>Status</th><th>When</th><th>Actions</th></tr></thead>
      <tbody>${data.moves.map((m) => {
        const pending = m.status === 'PENDING_APPROVAL';
        const approved = m.status === 'APPROVED';
        const actions = canApprove ? `
          ${pending ? `<button class="btn sm" data-approve="${m.id}">${t('Approve')}</button>
            <button class="btn secondary sm" data-reject="${m.id}">${t('Reject')}</button>` : ''}
          ${approved ? `<button class="btn sm" data-execute="${m.id}">${t('Execute')}</button>` : ''}` : '';
        return `<tr data-detail="${m.id}" class="row-link">
          <td><strong>${UI.esc(m.realloc_number)}</strong></td>
          <td>${UI.esc(m.material_code || '')}<br><span class="muted">${UI.esc(m.batch_number || '')}</span></td>
          <td class="text-right">${UI.fmtQty(m.quantity)}</td>
          <td>${UI.esc(m.from_warehouse || '')} / ${UI.esc(m.from_bin || '—')}<br><span class="muted">${UI.esc(m.from_project || '—')}</span></td>
          <td>${UI.esc(m.to_warehouse || '')} / ${UI.esc(m.to_bin || '—')}<br><span class="muted">${UI.esc(m.to_project || '—')}</span></td>
          <td>${UI.esc(m.requested_by_name || '—')}</td>
          <td><span class="badge">${UI.esc(m.status || '')}</span></td>
          <td>${UI.fmtDate(m.requested_at || m.created_at)}</td>
          <td>${actions || '—'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="9" class="muted">${t('No reallocations yet')}</td></tr>`}
      </tbody></table>`;
    UI.pagination(this.el.querySelector('#ra-pagination'), data, (p) => { this.state.page = p; this.load(); });

    box.querySelectorAll('[data-detail]').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.openDetail(Number(row.dataset.detail));
    }));
    box.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => this.approve(Number(btn.dataset.approve))));
    box.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => this.reject(Number(btn.dataset.reject))));
    box.querySelectorAll('[data-execute]').forEach((btn) => btn.addEventListener('click', () => this.execute(Number(btn.dataset.execute))));
  },

  async openDetail(id) {
    try {
      const { move, batch } = await Api.get(`/api/reallocation/${id}`);
      UI.modal({
        title: `${t('Reallocation')} ${UI.esc(move.realloc_number)}`,
        submitLabel: t('Close'),
        bodyHtml: `
          <div class="form-row"><div><strong>${t('Status')}</strong><p>${UI.esc(move.status)}</p></div><div><strong>${t('Quantity')}</strong><p>${UI.fmtQty(move.quantity)}</p></div></div>
          <div class="form-row"><div><strong>${t('Requester')}</strong><p>${UI.esc(move.requested_by_name || '—')}</p></div><div><strong>${t('Approver')}</strong><p>${UI.esc(move.approved_by_name || '—')}</p></div></div>
          <div class="form-row"><div><strong>${t('From')}</strong><p>${UI.esc(move.from_warehouse || '')} / ${UI.esc(move.from_bin || '—')} / ${UI.esc(move.from_project || '—')}</p></div><div><strong>${t('To')}</strong><p>${UI.esc(move.to_warehouse || '')} / ${UI.esc(move.to_bin || '—')} / ${UI.esc(move.to_project || '—')}</p></div></div>
          <div><strong>${t('Reason')}</strong><p>${UI.esc(move.reason || '—')}</p></div>
          ${move.rejection_reason ? `<div><strong>${t('Rejection reason')}</strong><p>${UI.esc(move.rejection_reason)}</p></div>` : ''}
          ${move.execution_error ? `<div><strong>${t('Execution error')}</strong><p class="text-danger">${UI.esc(move.execution_error)}</p></div>` : ''}
          <hr><div><strong>${t('Current source batch')}</strong><p>${batch ? `${UI.esc(batch.batch_number)} · ${UI.fmtQty(batch.remaining_quantity)} on hand · ${UI.fmtQty(batch.reserved_quantity || 0)} reserved` : t('Unavailable')}</p></div>`,
        onSubmit: async (_ov, close) => close(),
      });
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  async approve(id) {
    try {
      const r = await Api.post(`/api/reallocation/${id}/approve`, {});
      UI.toast(r.message); await this.load();
    } catch (err) {
      UI.toast(err.message, 'error');
      if (err.status === 409 || err.statusCode === 409) await this.load();
    }
  },

  reject(id) {
    UI.modal({
      title: t('Reject reallocation'),
      submitLabel: t('Reject'),
      bodyHtml: `<div class="form-group"><label>${t('Rejection reason')} *</label><textarea id="ra-reject-reason" required></textarea></div>`,
      onSubmit: async (ov, close) => {
        const reason = ov.querySelector('#ra-reject-reason').value.trim();
        if (!reason) return UI.toast(t('Rejection reason is required.'), 'error');
        try {
          const r = await Api.post(`/api/reallocation/${id}/reject`, { reason });
          UI.toast(r.message); close(); await this.load();
        } catch (err) {
          UI.toast(err.message, 'error');
          if (err.status === 409 || err.statusCode === 409) { close(); await this.load(); }
        }
      },
    });
  },

  async execute(id) {
    try {
      const r = await Api.post(`/api/reallocation/${id}/execute`, {});
      UI.toast(r.message); await this.load();
    } catch (err) {
      UI.toast(err.message, 'error');
      if (err.status === 409 || err.statusCode === 409) await this.load();
    }
  },

  openForm() {
    let batch = null;
    UI.modal({
      title: t('New reallocation'), wide: true, submitLabel: t('Submit for approval'),
      bodyHtml: `
        <div class="form-group"><label>${t('Batch (search by number or material)')}</label>
          <input type="text" id="ra-batch" placeholder="${t('Type to search…')}" autocomplete="off">
          <div id="ra-batch-list"></div><div class="hint" id="ra-batch-info"></div></div>
        <div class="form-row">
          <div class="form-group"><label>${t('Quantity to move')} *</label><input type="number" id="ra-qty" min="0" step="any"></div>
          <div class="form-group"><label>${t('Target warehouse')} *</label><select id="ra-wh">${this.meta.warehouses.map((w) => `<option value="${w.warehouse_code}">${w.warehouse_code} — ${UI.esc(w.warehouse_name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${t('Target bin')}</label><select id="ra-bin"><option value="">${t('No bin / assign later')}</option></select></div>
          <div class="form-group"><label>${t('Project / WBS')}</label><input type="text" id="ra-project" placeholder="${t('Optional')}"></div>
        </div>
        <div class="form-group"><label>${t('Business reason')} *</label><textarea id="ra-reason" required></textarea></div>`,
      onSubmit: async (ov, close) => {
        if (!batch) return UI.toast(t('Pick a batch first.'), 'error');
        const reason = ov.querySelector('#ra-reason').value.trim();
        if (!reason) return UI.toast(t('A business reason is required.'), 'error');
        try {
          const r = await Api.post('/api/reallocation', {
            batch_id: batch.id, quantity: Number(ov.querySelector('#ra-qty').value),
            to_warehouse: ov.querySelector('#ra-wh').value, to_bin: ov.querySelector('#ra-bin').value,
            to_project: ov.querySelector('#ra-project').value, reason,
          });
          UI.toast(r.message); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });

    const ov = document.querySelector('.modal-overlay');
    const input = ov.querySelector('#ra-batch');
    const list = ov.querySelector('#ra-batch-list');
    const info = ov.querySelector('#ra-batch-info');
    const whSel = ov.querySelector('#ra-wh');
    const binSel = ov.querySelector('#ra-bin');
    const loadBins = async () => {
      const { bins } = await Api.get(`/api/meta/warehouses/${whSel.value}/bins`).catch(() => ({ bins: [] }));
      binSel.innerHTML = `<option value="">${t('No bin / assign later')}</option>` + bins.map((b) => `<option value="${UI.esc(b.bin_code)}">${UI.esc(b.bin_code)}</option>`).join('');
    };
    whSel.addEventListener('change', loadBins); loadBins();
    input.addEventListener('input', UI.debounce(async () => {
      const q = input.value.trim(); if (!q) { list.innerHTML = ''; return; }
      const { batches } = await Api.get(`/api/master/batches?search=${encodeURIComponent(q)}&limit=8`).catch(() => ({ batches: [] }));
      list.innerHTML = batches.map((b) => `<button type="button" class="btn secondary sm" style="margin:3px 3px 0 0" data-pick="${b.id}">${UI.esc(b.batch_number)} · ${UI.esc(b.material_code)} · ${UI.fmtQty(b.remaining_quantity)} @ ${UI.esc(b.warehouse_code)}/${UI.esc(b.bin_location || '—')}</button>`).join('') || `<span class="muted">${t('No matching batches')}</span>`;
      list.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => {
        batch = batches.find((b) => b.id === Number(btn.dataset.pick));
        input.value = `${batch.batch_number} — ${batch.material_code}`;
        const movable = batch.remaining_quantity - (batch.reserved_quantity || 0);
        info.textContent = `${t('On hand')}: ${UI.fmtQty(batch.remaining_quantity)} · ${t('Reserved')}: ${UI.fmtQty(batch.reserved_quantity || 0)} · ${t('Movable')}: ${UI.fmtQty(movable)} — ${batch.warehouse_code}/${batch.bin_location || '—'}`;
        ov.querySelector('#ra-qty').value = movable; list.innerHTML = '';
      }));
    }, 250));
  },
};
