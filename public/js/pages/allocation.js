/** Bin & Batch Assignment — run FIFO/FEFO allocation and preview proposals. */
window.Pages = window.Pages || {};

Pages.allocation = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card"><h3>Bin & Batch Assignment (FIFO / FEFO)</h3>
      <p class="muted">Run allocation to reserve batches and propose bin/batch splits per line.</p>
      <div class="table-wrap" id="al-table"><div class="loading">Loading…</div></div></div>
      <div id="al-detail"></div>`;
    await this.loadQueue();
  },

  async loadQueue() {
    const t = this.el.querySelector('#al-table');
    const { requests } = await Api.get('/api/warehouse/queue');
    // Show only requests still awaiting allocation; once allocated they move on
    // to picker assignment and disappear from this queue.
    const pending = requests.filter((r) => ['Pending Bin Location Assignment', 'Warehouse Assigned'].includes(r.request_status));
    t.innerHTML = `<table><thead><tr><th>Request #</th><th>Warehouse</th><th>Movement</th><th>Status</th><th>Lines</th><th></th></tr></thead>
      <tbody>${pending.map((r) => `
        <tr data-id="${r.id}">
          <td><strong>${UI.esc(r.request_number)}</strong></td><td>${UI.esc(r.issue_warehouse_code || '')}</td>
          <td>${UI.esc(r.movement_type || '')}</td><td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
          <td>${r.total_lines}</td>
          <td><button class="btn sm" data-alloc="${r.id}">Allocate</button>
              <button class="btn secondary sm" data-view="${r.id}">View</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing awaiting allocation</td></tr>'}
      </tbody></table>`;
    t.querySelectorAll('[data-alloc]').forEach((b) => b.addEventListener('click', () => this.allocate(b.dataset.alloc)));
    t.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.view(b.dataset.view)));
  },

  async allocate(id) {
    try {
      const { allocations } = await Api.post(`/api/warehouse/${id}/allocate`);
      UI.toast('Allocation complete.');
      this.showAllocations(id, allocations);
      this.loadQueue();
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  showAllocations(id, results) {
    const box = this.el.querySelector('#al-detail');
    box.innerHTML = `<div class="card"><h3>Allocation result — request #${id}</h3>
      ${results.map((r) => `
        <div style="margin-bottom:14px">
          <strong>Line ${r.line_number} · ${UI.esc(r.material_code)}</strong>
          <span class="badge role">${r.method}</span>
          <span class="muted">requested ${UI.fmtQty(r.requested)}, allocated ${UI.fmtQty(r.allocated)}${r.shortfall ? `, shortfall ${UI.fmtQty(r.shortfall)}` : ''}</span>
          <div class="table-wrap"><table>
            <thead><tr><th>Seq</th><th>Batch</th><th>Bin</th><th class="text-right">Qty</th><th>Expiry</th></tr></thead>
            <tbody>${r.allocations.map((a) => `<tr><td>${a.sequence}</td><td>${UI.esc(a.batch_number)}</td>
              <td>${UI.esc(a.bin_location || '')}</td><td class="text-right">${UI.fmtQty(a.proposed_quantity)}</td>
              <td>${a.expiry_date || '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No stock available</td></tr>'}</tbody>
          </table></div>
        </div>`).join('')}</div>`;
  },

  async view(id) {
    const { allocations, lines } = await Api.get(`/api/gi/${id}`).catch(() => ({}));
    // Fall back to request detail navigation.
    location.hash = `#/request-detail/${id}`;
  },
};
