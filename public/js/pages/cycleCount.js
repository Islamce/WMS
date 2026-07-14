/**
 * Cycle Counting screen — open a count against a batch, enter the physical
 * count, and post the variance (which adjusts batch stock + the ledger).
 */
window.Pages = window.Pages || {};
Pages.cycleCount = {
  async render(el, page = 1) {
    this.el = el;
    el.innerHTML = `<div class="loading">${t('Loading…')}</div>`;
    let data;
    try { data = await Api.get(`/api/cycle-count?page=${page}`); }
    catch (err) { el.innerHTML = `<div class="error-box">${UI.esc(err.message)}</div>`; return; }

    el.innerHTML = `
      <div class="page-head">
        <h2>${t('Cycle Counting')}</h2>
        <div class="spacer"></div>
        <button class="btn sm" id="cc-new">${t('New count')}</button>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>#</th><th>${t('Material')}</th><th>${t('System quantity')}</th>
            <th>${t('Counted quantity')}</th><th>${t('Variance')}</th><th>${t('Status')}</th><th>${t('Actions')}</th>
          </tr></thead>
          <tbody>
            ${(data.counts || []).map((c) => `
              <tr>
                <td>${UI.esc(c.count_number)}</td>
                <td>${UI.esc(c.material_code || '')}<div class="muted sm">${UI.esc(c.bin_location || '')}</div></td>
                <td>${c.system_quantity}</td>
                <td>${c.counted_quantity ?? '—'}</td>
                <td>${c.variance == null ? '—' : `<span class="${c.variance < 0 ? 'neg' : c.variance > 0 ? 'pos' : ''}">${c.variance > 0 ? '+' : ''}${c.variance}</span>`}</td>
                <td><span class="badge">${UI.esc(c.status)}</span></td>
                <td>
                  ${c.status === 'OPEN' ? `<button class="btn sm" data-count="${c.id}">${t('Enter count')}</button>` : ''}
                  ${c.status === 'COUNTED' ? `<button class="btn sm" data-post="${c.id}">${t('Post')}</button>` : ''}
                </td>
              </tr>`).join('') || `<tr><td colspan="7" class="muted">${t('No cycle counts yet.')}</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="pagination" id="cc-pager"></div>`;

    const pager = el.querySelector('#cc-pager');
    if (pager) UI.pagination(pager, { total: data.total || 0, page: data.page || 1, limit: data.limit || 100 },
      (p) => this.render(el, p));
    el.querySelector('#cc-new').addEventListener('click', () => this.openNew(el));
    el.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => this.enter(el, b.dataset.count)));
    el.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', () => this.post(el, b.dataset.post)));
  },

  openNew(el) {
    UI.modal({ title: t('New count'), submitLabel: t('Open count'),
      bodyHtml: `<div class="form-group"><label>${t('Batch (search by material or batch number)')}</label>
        <input type="text" id="cc-search" placeholder="MAT-0001" /></div>
        <div id="cc-results" class="cc-results"></div>
        <input type="hidden" id="cc-batch-id" />`,
      onSubmit: async (ov, close) => {
        const bid = ov.querySelector('#cc-batch-id').value;
        if (!bid) return UI.toast(t('Select a batch first.'), 'error');
        try { await Api.post('/api/cycle-count', { batch_id: Number(bid) });
          UI.toast(t('Cycle count opened.')); close(); this.render(el); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
    const search = document.getElementById('cc-search');
    const results = document.getElementById('cc-results');
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        if (!q) { results.innerHTML = ''; return; }
        try {
          const { batches } = await Api.get(`/api/master/batches?search=${encodeURIComponent(q)}`);
          results.innerHTML = (batches || []).slice(0, 8).map((b) =>
            `<button type="button" class="cc-pick" data-id="${b.id}" data-label="${UI.esc(b.batch_number)}">
               ${UI.esc(b.batch_number)} · ${UI.esc(b.material_code)} · ${t('on hand')} ${b.remaining_quantity}
             </button>`).join('') || `<div class="muted">${t('No matches.')}</div>`;
          results.querySelectorAll('.cc-pick').forEach((p) => p.addEventListener('click', () => {
            document.getElementById('cc-batch-id').value = p.dataset.id;
            search.value = p.dataset.label;
            results.innerHTML = `<div class="muted">${t('Selected')}: ${UI.esc(p.dataset.label)}</div>`;
          }));
        } catch { /* ignore transient search errors */ }
      }, 250);
    });
  },

  enter(el, id) {
    UI.modal({ title: t('Enter count'), submitLabel: t('Save'),
      bodyHtml: `<div class="form-group"><label>${t('Counted quantity')}</label><input type="number" id="cc-qty" min="0" step="any" /></div>
        <div class="form-group"><label>${t('Reason')} (${t('optional')})</label><input type="text" id="cc-reason" /></div>`,
      onSubmit: async (ov, close) => {
        const qty = ov.querySelector('#cc-qty').value;
        try { await Api.post(`/api/cycle-count/${id}/count`,
          { counted_quantity: Number(qty), reason: ov.querySelector('#cc-reason').value });
          UI.toast(t('Count recorded.')); close(); this.render(el); }
        catch (err) { UI.toast(err.message, 'error'); }
      } });
  },

  async post(el, id) {
    try { const r = await Api.post(`/api/cycle-count/${id}/post`, {});
      UI.toast(`${t('Posted.')} ${t('Variance')}: ${r.variance}`); this.render(el); }
    catch (err) { UI.toast(err.message, 'error'); }
  },
};
