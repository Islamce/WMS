/** Manager Approval inbox + approve/modify/partial/reject/return. */
window.Pages = window.Pages || {};

Pages.approvals = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><h3>Approval Inbox</h3>
      <div class="table-wrap" id="ap-table"><div class="loading">Loading…</div></div></div>
      <div id="ap-detail"></div>`;
    await this.loadInbox();
  },

  async loadInbox() {
    const t = this.el.querySelector('#ap-table');
    try {
      const { requests } = await Api.get('/api/approvals');
      t.innerHTML = `
        <table><thead><tr><th>Request #</th><th>Requester</th><th>Dept</th><th>Priority</th><th>Status</th><th>Lines</th><th>Submitted</th></tr></thead>
        <tbody>${requests.map((r) => `
          <tr style="cursor:pointer" data-id="${r.id}">
            <td><strong>${UI.esc(r.request_number)}</strong></td><td>${UI.esc(r.requester_name || '')}</td>
            <td>${UI.esc(r.department || '')}</td>
            <td><span class="badge ${r.priority === 'URGENT' || r.priority === 'HIGH' ? 'pending' : 'role'}">${r.priority}</span></td>
            <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
            <td>${r.total_lines}</td><td>${UI.fmtDate(r.submitted_at)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No requests awaiting approval</td></tr>'}
        </tbody></table>`;
      t.querySelectorAll('tr[data-id]').forEach((tr) =>
        tr.addEventListener('click', () => this.openDetail(tr.dataset.id)));
    } catch (err) { t.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; }
  },

  async openDetail(id) {
    const box = this.el.querySelector('#ap-detail');
    box.innerHTML = '<div class="card"><div class="loading">Loading…</div></div>';
    const { request: r, lines } = await Api.get(`/api/requests/${id}`);

    box.innerHTML = `
      <div class="card">
        <h3>${UI.esc(r.request_number)} — ${UI.esc(r.requester_name || '')}</h3>
        <p class="muted"><strong>Purpose:</strong> ${UI.esc(r.purpose || '')}</p>
        <div class="details-list" style="margin-bottom:12px">
          <div class="item"><div class="k">Priority</div><div class="v">${UI.esc(r.priority)}</div></div>
          <div class="item"><div class="k">Required</div><div class="v">${r.required_date || '—'}</div></div>
          <div class="item"><div class="k">Cost Center</div><div class="v">${UI.esc(r.cost_center || '—')}</div></div>
          <div class="item"><div class="k">WBS</div><div class="v">${UI.esc(r.wbs_element || '—')}</div></div>
        </div>
        <button class="btn secondary sm" id="ap-edit-header">Modify header</button>
        <button class="btn secondary sm" id="ap-add-line">+ Add line</button>

        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th><input type="checkbox" id="ap-all" checked></th><th>#</th><th>Item</th><th>Description</th>
            <th class="text-right">Requested</th><th style="width:130px">Approved</th><th></th></tr></thead>
          <tbody>
            ${lines.map((l) => `
              <tr data-line="${l.id}">
                <td><input type="checkbox" class="ap-line-chk" value="${l.id}" checked></td>
                <td>${l.line_number}</td><td><strong>${UI.esc(l.material_code)}</strong></td>
                <td class="wrap">${UI.esc(l.material_description || '')}</td>
                <td class="text-right">${UI.fmtQty(l.requested_quantity)}</td>
                <td><input type="number" class="ap-qty" data-line="${l.id}" min="0" step="any"
                     value="${l.approved_quantity != null ? l.approved_quantity : l.requested_quantity}" style="max-width:110px"></td>
                <td><button class="btn danger sm" data-del="${l.id}">Delete</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>

        <div class="form-group" style="margin-top:14px"><label>Comments</label><input type="text" id="ap-comments"></div>
        <div class="actions" style="justify-content:flex-start">
          <button class="btn success" id="ap-approve">Approve</button>
          <button class="btn" id="ap-partial">Partial Approve</button>
          <button class="btn danger" id="ap-reject">Reject</button>
          <button class="btn secondary" id="ap-return">Return</button>
        </div>
      </div>`;

    // Master checkbox toggles all.
    box.querySelector('#ap-all').addEventListener('change', (e) => {
      box.querySelectorAll('.ap-line-chk').forEach((c) => { c.checked = e.target.checked; });
    });

    // Save approved quantity on blur (individually audited server-side).
    box.querySelectorAll('.ap-qty').forEach((inp) => inp.addEventListener('change', async () => {
      try {
        await Api.patch(`/api/approvals/${id}/lines/${inp.dataset.line}`, { approved_quantity: Number(inp.value), reason: 'Manager adjustment' });
        UI.toast('Line quantity updated.');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));

    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      UI.modal({ title: 'Delete line', submitLabel: 'Delete',
        bodyHtml: '<div class="form-group"><label>Reason (required)</label><input type="text" id="dl-reason" required></div>',
        onSubmit: async (ov, close) => {
          const reason = ov.querySelector('#dl-reason').value.trim();
          if (!reason) return UI.toast('Reason required.', 'error');
          try {
            await Api.request('DELETE', `/api/approvals/${id}/lines/${b.dataset.del}`, { reason });
            UI.toast('Line deleted.'); close(); this.openDetail(id);
          } catch (err) { UI.toast(err.message, 'error'); }
        } });
    }));

    box.querySelector('#ap-edit-header').addEventListener('click', () => this.editHeader(id, r));
    box.querySelector('#ap-add-line').addEventListener('click', () => this.addLine(id));

    box.querySelector('#ap-approve').addEventListener('click', () => this.decide(id, 'approve'));
    box.querySelector('#ap-partial').addEventListener('click', () => this.decide(id, 'partial'));
    box.querySelector('#ap-reject').addEventListener('click', () => this.decide(id, 'reject'));
    box.querySelector('#ap-return').addEventListener('click', () => this.decide(id, 'return'));
  },

  editHeader(id, r) {
    UI.modal({ title: 'Modify header', wide: true, submitLabel: 'Save',
      bodyHtml: `
        <div class="form-row">
          <div class="form-group"><label>Priority</label>
            <select id="eh-priority">${['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => `<option ${p === r.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="form-group"><label>Required Date</label><input type="date" id="eh-required" value="${r.required_date || ''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Cost Center</label><input type="text" id="eh-cc" value="${UI.esc(r.cost_center || '')}"></div>
          <div class="form-group"><label>WBS</label><input type="text" id="eh-wbs" value="${UI.esc(r.wbs_element || '')}"></div>
        </div>
        <div class="form-group"><label>Reason for change</label><input type="text" id="eh-reason"></div>`,
      onSubmit: async (ov, close) => {
        try {
          await Api.patch(`/api/approvals/${id}/header`, {
            priority: ov.querySelector('#eh-priority').value,
            required_date: ov.querySelector('#eh-required').value,
            cost_center: ov.querySelector('#eh-cc').value,
            wbs_element: ov.querySelector('#eh-wbs').value,
            reason: ov.querySelector('#eh-reason').value,
          });
          UI.toast('Header updated.'); close(); this.openDetail(id);
        } catch (err) { UI.toast(err.message, 'error'); }
      } });
  },

  addLine(id) {
    UI.modal({ title: 'Add material line', submitLabel: 'Add',
      bodyHtml: `
        <div class="form-group autocomplete"><label>Material</label>
          <input type="text" id="al-material" placeholder="Search…" autocomplete="off"></div>
        <div class="form-group"><label>Quantity</label><input type="number" id="al-qty" min="0" step="any"></div>
        <div class="form-group"><label>Reason</label><input type="text" id="al-reason"></div>`,
      onSubmit: async (ov, close) => {
        if (!this._mat) return UI.toast('Select a material.', 'error');
        try {
          await Api.post(`/api/approvals/${id}/lines`, { material_id: this._mat.id,
            requested_quantity: Number(ov.querySelector('#al-qty').value), reason: ov.querySelector('#al-reason').value });
          this._mat = null; UI.toast('Line added.'); close(); this.openDetail(id);
        } catch (err) { UI.toast(err.message, 'error'); }
      } });
    setTimeout(() => {
      const inp = document.querySelector('#al-material');
      if (inp) UI.materialAutocomplete(inp, (m) => { this._mat = m; });
    }, 50);
  },

  decide(id, decision) {
    const needsReason = decision === 'reject' || decision === 'return';
    const comments = this.el.querySelector('#ap-comments').value;
    const approvedLineIds = decision === 'partial'
      ? [...this.el.querySelectorAll('.ap-line-chk:checked')].map((c) => Number(c.value)) : undefined;

    const doSubmit = async (reason) => {
      try {
        await Api.post(`/api/approvals/${id}/decision`, { decision, comments, reason, approvedLineIds });
        UI.toast('Decision recorded.');
        this.el.querySelector('#ap-detail').innerHTML = '';
        this.loadInbox();
      } catch (err) { UI.toast(err.message, 'error'); }
    };

    if (needsReason) {
      UI.modal({ title: decision === 'reject' ? 'Reject request' : 'Return to requester',
        submitLabel: decision === 'reject' ? 'Reject' : 'Return',
        bodyHtml: '<div class="form-group"><label>Reason (required)</label><input type="text" id="dc-reason" required></div>',
        onSubmit: async (ov, close) => {
          const reason = ov.querySelector('#dc-reason').value.trim();
          if (!reason) return UI.toast('Reason required.', 'error');
          close(); doSubmit(reason);
        } });
    } else {
      doSubmit();
    }
  },
};
