/** Shipping & Outbound — delivery orders from GI-posted requests:
 *  pack → load → dispatch → deliver (POD), with printable QR labels. */
window.Pages = window.Pages || {};

Pages.shipping = {
  state: { page: 1, status: '', search: '' },

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar mb-0">
          <h3 class="mb-0">${t('Shipping & Outbound')}</h3>
          <div class="spacer"></div>
          <button class="btn" id="sh-new">+ ${t('New delivery order')}</button>
        </div>
        <p class="muted" style="margin-top:6px">${t('Create delivery orders from issued requests, then pack, load, dispatch and confirm delivery with proof of delivery. Every shipment has a scannable QR label.')}</p>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="sh-search" placeholder="${t('Search shipment, request, destination…')}">
          <select id="sh-status" aria-label="${t('Filter by status')}">
            <option value="">${t('All statuses')}</option>
            ${['OPEN', 'PACKED', 'LOADED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap" id="sh-table"><div class="loading">${t('Loading…')}</div></div>
        <div class="pagination" id="sh-pagination"></div>
      </div>`;
    el.querySelector('#sh-new').addEventListener('click', () => this.openForm());
    el.querySelector('#sh-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value; this.state.page = 1; this.load();
    }, 300));
    el.querySelector('#sh-status').addEventListener('change', (e) => {
      this.state.status = e.target.value; this.state.page = 1; this.load();
    });
    await this.load();
  },

  stepper(s) {
    const steps = ['OPEN', 'PACKED', 'LOADED', 'DISPATCHED', 'DELIVERED'];
    const idx = steps.indexOf(s.status);
    return `<span class="ship-steps">${steps.map((st, i) => `
      <span class="ship-step ${i <= idx ? 'done' : ''}">${st}</span>`).join('')}</span>`;
  },

  nextAction(s) {
    return { OPEN: ['pack', t('Pack')], PACKED: ['load', t('Load')], LOADED: ['dispatch', t('Dispatch')],
      DISPATCHED: ['deliver', t('Deliver')] }[s.status] || null;
  },

  async load() {
    const box = this.el.querySelector('#sh-table');
    const { page, status, search } = this.state;
    const data = await Api.get(`/api/shipping?page=${page}&status=${status}&search=${encodeURIComponent(search)}`);
    box.innerHTML = data.shipments.length ? `<table>
      <thead><tr><th>${t('Shipment')}</th><th>${t('Request')}</th><th>${t('Ship to')}</th><th>${t('Carrier')}</th>
        <th class="text-right">${t('Pkgs')}</th><th>${t('Status')}</th><th>${t('Created')}</th><th></th></tr></thead>
      <tbody>${data.shipments.map((s) => {
        const act = this.nextAction(s);
        return `
        <tr>
          <td><span class="chip accent">${UI.esc(s.shipment_number)}</span></td>
          <td>${s.request_number ? `<span class="chip">${UI.esc(s.request_number)}</span>` : '—'}</td><td>${UI.esc(s.ship_to || '')}</td>
          <td>${UI.esc(s.carrier || '—')}</td><td class="text-right">${s.packages}</td>
          <td><span class="badge ${statusClass(s.status)}">${UI.esc(s.status)}</span></td>
          <td>${UI.fmtDate(s.created_at)}</td>
          <td>
            ${act ? `<button class="btn success sm" data-act="${act[0]}" data-id="${s.id}">${act[1]}</button>` : ''}
            <button class="btn secondary sm" data-label="${s.id}">🏷 ${t('Label')}</button>
            <button class="btn secondary sm" data-view="${s.id}">${t('View')}</button>
            ${!['DELIVERED', 'CANCELLED'].includes(s.status) ? `<button class="btn danger sm" data-cancel="${s.id}">✕</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
      </tbody></table>` : UI.meaningfulEmptyState({
      title: t('No shipments yet'),
      description: t('Create a delivery order from a GI-posted request, or a free shipment, using New delivery order above.'),
    });

    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'deliver') return this.deliver(b.dataset.id);
      this.step(b.dataset.id, b.dataset.act);
    }));
    box.querySelectorAll('[data-label]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const blob = await Api.blob(`/api/shipping/${b.dataset.label}/label`);
        window.open(URL.createObjectURL(blob), '_blank');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));
    box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.view(b.dataset.view)));
    box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () =>
      UI.confirm(t('Cancel this shipment?'), async () => {
        try { const r = await Api.post(`/api/shipping/${b.dataset.cancel}/cancel`); UI.toast(r.message); this.load(); }
        catch (err) { UI.toast(err.message, 'error'); }
      })));
    UI.pagination(this.el.querySelector('#sh-pagination'), data, (p) => { this.state.page = p; this.load(); });
  },

  async step(id, action) {
    try { const r = await Api.post(`/api/shipping/${id}/${action}`); UI.toast(r.message); this.load(); }
    catch (err) { UI.toast(err.message, 'error'); }
  },

  deliver(id) {
    UI.modal({ title: t('Confirm delivery (POD)'), submitLabel: t('Confirm delivery'),
      bodyHtml: `
        <div class="form-group"><label>${t('Received by')} *</label><input type="text" id="sh-pod-name" autofocus></div>
        <div class="form-group"><label>${t('POD note')}</label><input type="text" id="sh-pod-note" placeholder="${t('e.g. signed delivery note ref')}"></div>`,
      onSubmit: async (ov, close) => {
        try {
          const r = await Api.post(`/api/shipping/${id}/deliver`, {
            delivered_to: ov.querySelector('#sh-pod-name').value,
            pod_note: ov.querySelector('#sh-pod-note').value,
          });
          UI.toast(r.message); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      } });
  },

  async view(id) {
    const { shipment: s, lines } = await Api.get(`/api/shipping/${id}`);
    UI.modal({ title: `${s.shipment_number}`, wide: true, submitLabel: t('Close'),
      bodyHtml: `
        ${this.stepper(s)}
        <div class="details-list" style="margin:10px 0">
          <div class="item"><div class="k">${t('Ship to')}</div><div class="v">${UI.esc(s.ship_to || '—')}</div></div>
          <div class="item"><div class="k">${t('Request')}</div><div class="v">${UI.esc(s.request_number || '—')}</div></div>
          <div class="item"><div class="k">${t('Delivery order')}</div><div class="v">${UI.esc(s.delivery_order_number || '—')}</div></div>
          <div class="item"><div class="k">${t('Carrier / Vehicle / Driver')}</div><div class="v">${UI.esc(s.carrier || '—')} / ${UI.esc(s.vehicle || '—')} / ${UI.esc(s.driver || '—')}</div></div>
          <div class="item"><div class="k">${t('Dispatched')}</div><div class="v">${UI.fmtDate(s.dispatched_at) || '—'}</div></div>
          <div class="item"><div class="k">${t('Delivered')}</div><div class="v">${s.delivered_at ? `${UI.fmtDate(s.delivered_at)} — ${UI.esc(s.delivered_to || '')}` : '—'}</div></div>
          ${s.pod_note ? `<div class="item"><div class="k">${t('POD note')}</div><div class="v">${UI.esc(s.pod_note)}</div></div>` : ''}
        </div>
        ${lines.length ? `<div class="table-wrap"><table>
          <thead><tr><th>#</th><th>${t('Material')}</th><th class="text-right">${t('Issued')}</th><th>${t('Batch')}</th><th>${t('Bin')}</th></tr></thead>
          <tbody>${lines.map((l) => `<tr><td>${l.line_number}</td>
            <td>${UI.esc(l.material_code)} <span class="muted">${UI.esc(l.material_description || '')}</span></td>
            <td class="text-right">${UI.fmtQty(l.issued_quantity)} ${UI.esc(l.uom || '')}</td>
            <td>${l.batch_number ? `<span class="chip accent">${UI.esc(l.batch_number)}</span>` : '—'}</td><td>${l.bin_location ? `<span class="chip">${UI.esc(l.bin_location)}</span>` : '—'}</td></tr>`).join('')}</tbody>
        </table></div>` : `<p class="muted">${t('No request lines linked to this shipment.')}</p>`}`,
      onSubmit: async (_ov, close) => close(),
    });
  },

  async openForm() {
    const { requests } = await Api.get('/api/shipping/eligible').catch(() => ({ requests: [] }));
    UI.modal({
      title: t('New delivery order'), wide: true, submitLabel: t('Create shipment'),
      bodyHtml: `
        <div class="form-group"><label>${t('Source request (GI posted)')}</label>
          <select id="sh-req"><option value="">${t('No linked request (free shipment)')}</option>
            ${requests.map((r) => `<option value="${r.id}">${UI.esc(r.request_number)} — ${UI.esc(r.requester_name || '')} (${UI.esc(r.issue_warehouse_code || '')}, GI ${UI.esc(r.gi_document_number || '')})</option>`).join('')}
          </select></div>
        <div class="form-row">
          <div class="form-group"><label>${t('Ship to')} *</label><input type="text" id="sh-to" required></div>
          <div class="form-group"><label>${t('Delivery order #')}</label><input type="text" id="sh-do"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${t('Carrier')}</label><input type="text" id="sh-carrier"></div>
          <div class="form-group"><label>${t('Vehicle')}</label><input type="text" id="sh-vehicle"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${t('Driver')}</label><input type="text" id="sh-driver"></div>
          <div class="form-group"><label>${t('Packages')}</label><input type="number" id="sh-pkgs" min="1" value="1"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${t('Weight (kg)')}</label><input type="number" id="sh-kg" min="0" step="any"></div>
          <div class="form-group"><label>${t('Notes')}</label><input type="text" id="sh-notes"></div>
        </div>`,
      onSubmit: async (ov, close) => {
        try {
          const r = await Api.post('/api/shipping', {
            request_id: ov.querySelector('#sh-req').value || null,
            ship_to: ov.querySelector('#sh-to').value,
            delivery_order_number: ov.querySelector('#sh-do').value,
            carrier: ov.querySelector('#sh-carrier').value,
            vehicle: ov.querySelector('#sh-vehicle').value,
            driver: ov.querySelector('#sh-driver').value,
            packages: Number(ov.querySelector('#sh-pkgs').value) || 1,
            weight_kg: ov.querySelector('#sh-kg').value,
            notes: ov.querySelector('#sh-notes').value,
          });
          UI.toast(r.message); close(); this.load();
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },
};
