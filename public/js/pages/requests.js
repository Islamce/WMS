/** Material Requests list (My Requests / all, depending on role). */
window.Pages = window.Pages || {};

// Shared status → badge class mapping for the whole workflow UI.
window.statusClass = function (status) {
  const s = (status || '').toLowerCase();
  if (s.includes('reject') || s.includes('error') || s.includes('cancel') || s.includes('shortage')) return 'OUT';
  if (s.includes('complete') || s.includes('approved') || s.includes('posted') || s.includes('picked')) return 'active';
  if (s.includes('pending') || s.includes('draft') || s.includes('review') || s.includes('reminder') || s.includes('assigned') || s.includes('hold')) return 'pending';
  return 'role';
};

Pages.requests = {
  state: { page: 1, search: '', status: '' },

  async render(el) {
    this.el = el;
    let statuses = [];
    try { ({ headerStatuses: statuses } = await Api.get('/api/meta')); } catch {}
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="rq-search" placeholder="Search request #, purpose, requester…" value="${UI.esc(this.state.search)}" />
          <select id="rq-status" style="max-width:220px"><option value="">All statuses</option>
            ${statuses.map((s) => `<option ${s === this.state.status ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}</select>
          <div class="spacer"></div>
          ${App.can('create_request') ? '<a href="#/create-request" class="btn">+ New Request</a>' : ''}
        </div>
        <div class="table-wrap" id="rq-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="rq-pagination"></div>
      </div>`;

    el.querySelector('#rq-search').addEventListener('input', UI.debounce((e) => {
      this.state.search = e.target.value; this.state.page = 1; this.load();
    }, 300));
    el.querySelector('#rq-status').addEventListener('change', (e) => {
      this.state.status = e.target.value; this.state.page = 1; this.load();
    });
    await this.load();
  },

  async load() {
    const { page, search, status } = this.state;
    const tableEl = this.el.querySelector('#rq-table');
    try {
      const data = await Api.get(`/api/requests?page=${page}&limit=10&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
      tableEl.innerHTML = `
        <table>
          <thead><tr><th>Request #</th><th>Requester</th><th>Priority</th><th>Status</th><th>Lines</th><th>Required</th><th>Created</th></tr></thead>
          <tbody>
            ${data.requests.map((r) => `
              <tr style="cursor:pointer" data-id="${r.id}">
                <td><strong>${UI.esc(r.request_number)}</strong></td>
                <td>${UI.esc(r.requester_name || '')}</td>
                <td><span class="badge ${r.priority === 'URGENT' || r.priority === 'HIGH' ? 'pending' : 'role'}">${UI.esc(r.priority)}</span></td>
                <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
                <td>${r.completed_lines || 0}/${r.total_lines}</td>
                <td>${r.required_date || '—'}</td>
                <td>${UI.fmtDate(r.created_at)}</td>
              </tr>`).join('') || '<tr><td colspan="7" class="muted">No requests found</td></tr>'}
          </tbody>
        </table>`;
      tableEl.querySelectorAll('tr[data-id]').forEach((tr) =>
        tr.addEventListener('click', () => { location.hash = `#/request-detail/${tr.dataset.id}`; }));
      UI.pagination(this.el.querySelector('#rq-pagination'), data, (p) => { this.state.page = p; this.load(); });
    } catch (err) {
      tableEl.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
    }
  },
};
