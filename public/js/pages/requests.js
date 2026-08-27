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
  contextRestored: false,
  pendingScrollRestore: null,

  queueContextKey() {
    return `wms_request_queue_context_v1:${App.user?.id || 'anonymous'}`;
  },

  readQueueContext() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.queueContextKey()));
      if (!saved || typeof saved !== 'object') return null;
      return {
        page: Math.max(1, Number(saved.page) || 1),
        search: typeof saved.search === 'string' ? saved.search : '',
        status: typeof saved.status === 'string' ? saved.status : '',
        scrollY: Math.max(0, Number(saved.scrollY) || 0),
      };
    } catch { return null; }
  },

  persistQueueContext({ includeScroll = false } = {}) {
    const prior = this.readQueueContext();
    const context = {
      page: this.state.page,
      search: this.state.search,
      status: this.state.status,
      scrollY: includeScroll ? window.scrollY : (prior?.scrollY || 0),
    };
    sessionStorage.setItem(this.queueContextKey(), JSON.stringify(context));
  },

  restoreQueueContext() {
    if (this.contextRestored) return;
    this.contextRestored = true;
    const context = this.readQueueContext();
    if (!context) return;
    this.state = { page: context.page, search: context.search, status: context.status };
    this.pendingScrollRestore = context.scrollY;
  },

  getQueueContext() {
    const context = this.readQueueContext() || { ...this.state, scrollY: 0 };
    const parts = [];
    if (context.search) parts.push(`Search: “${context.search}”`);
    if (context.status) parts.push(`Status: ${context.status}`);
    if (context.page > 1) parts.push(`Page ${context.page}`);
    return {
      ...context,
      isFiltered: Boolean(context.search || context.status || context.page > 1),
      summary: parts.join(' · ') || 'All requests',
    };
  },

  async render(el) {
    this.restoreQueueContext();
    this.el = el;
    let statuses = [];
    try { ({ headerStatuses: statuses } = await Api.get('/api/meta')); } catch {}
    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="rq-search" placeholder="Search request #, purpose, requester…" value="${UI.esc(this.state.search)}" aria-label="Search requests" />
          <select id="rq-status" style="max-width:220px" aria-label="Filter by status"><option value="">All statuses</option>
            ${statuses.map((s) => `<option ${s === this.state.status ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}</select>
          <span class="muted" id="rq-count" aria-live="polite"></span>
          <div class="spacer"></div>
          ${App.can('create_request') ? '<a href="#/create-request" class="btn">+ New Request</a>' : ''}
        </div>
        <div class="table-wrap" id="rq-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="rq-pagination"></div>
      </div>`;

    const reloadForSearch = UI.debounce(() => { this.state.page = 1; this.persistQueueContext(); this.load(); }, 300);
    el.querySelector('#rq-search').addEventListener('input', (e) => {
      this.state.search = e.target.value; this.persistQueueContext(); reloadForSearch();
    });
    el.querySelector('#rq-status').addEventListener('change', (e) => {
      this.state.status = e.target.value; this.state.page = 1; this.persistQueueContext(); this.load();
    });
    await this.load();
  },

  async load() {
    const { page, search, status } = this.state;
    const tableEl = this.el.querySelector('#rq-table');
    try {
      const data = await Api.get(`/api/requests?page=${page}&limit=10&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
      const countEl = this.el.querySelector('#rq-count');
      if (countEl) countEl.textContent = data.total != null ? `${UI.fmtQty(data.total)} request${data.total === 1 ? '' : 's'}` : '';
      tableEl.innerHTML = data.requests.length ? `
        <table>
          <thead><tr><th>Request #</th><th>Requester</th><th>Priority</th><th>Status</th><th>Lines</th><th>Required</th><th>Created</th></tr></thead>
          <tbody>
            ${data.requests.map((r) => `
              <tr class="row-link" data-id="${r.id}" role="button" tabindex="0" aria-label="Open request ${UI.esc(r.request_number)}">
                <td><span class="chip accent">${UI.esc(r.request_number)}</span></td>
                <td>${UI.esc(r.requester_name || '')}</td>
                <td><span class="badge ${r.priority === 'URGENT' || r.priority === 'HIGH' ? 'pending' : 'role'}">${UI.esc(r.priority)}</span></td>
                <td><span class="badge ${statusClass(r.request_status)}">${UI.esc(r.request_status)}</span></td>
                <td>${r.completed_lines || 0}/${r.total_lines}</td>
                <td>${r.required_date || '—'}</td>
                <td>${UI.fmtDate(r.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : UI.meaningfulEmptyState({
        title: (search || status) ? 'No requests match these filters' : 'No requests yet',
        description: (search || status) ? 'Try a different search term or clear the status filter.' : 'Material requests created by any requester will appear here.',
        actionHtml: App.can('create_request') ? '<a href="#/create-request" class="btn secondary sm" style="margin-top:8px">+ New Request</a>' : '',
      });
      UI.makeRowsActionable(tableEl.querySelectorAll('tr[data-id]'), (tr) => {
        this.persistQueueContext({ includeScroll: true });
        location.hash = `#/request-detail/${tr.dataset.id}`;
      });
      UI.pagination(this.el.querySelector('#rq-pagination'), data, (p) => {
        this.state.page = p; this.persistQueueContext(); this.load();
      });
      if (this.pendingScrollRestore != null) {
        const restoreY = this.pendingScrollRestore;
        this.pendingScrollRestore = null;
        requestAnimationFrame(() => window.scrollTo(0, restoreY));
      }
    } catch (err) {
      tableEl.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
    }
  },
};
