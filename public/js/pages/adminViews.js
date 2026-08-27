/** Audit trail, notifications center, and KPI dashboard. */
window.Pages = window.Pages || {};

Pages.audit = {
  state: { page: 1, source_screen: '', entity_type: '', action: '', changed_by_name: '', request_number: '', date_from: '', date_to: '' },

  query(extra = {}) {
    const p = new URLSearchParams(Object.assign({}, this.state, extra));
    // Drop empty values.
    [...p.keys()].forEach((k) => { if (!p.get(k)) p.delete(k); });
    return p.toString();
  },

  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="card">
        <div class="toolbar"><h3 class="mb-0">Audit Trail</h3><div class="spacer"></div>
          <span id="au-export"></span></div>
        <div class="filter-bar" id="au-filters"><div class="loading">Loading filters…</div></div>
      </div>
      <div class="mini-kpis" id="au-summary"></div>
      <div class="card">
        <div class="table-wrap" id="au-table"><div class="loading">Loading…</div></div>
        <div class="pagination" id="au-pagination"></div>
      </div>`;
    await this.load(true);
  },

  buildFilters(facets) {
    const opt = (list, sel) => ['<option value="">All</option>']
      .concat(list.map((v) => `<option value="${UI.esc(v)}" ${v === sel ? 'selected' : ''}>${UI.esc(v)}</option>`)).join('');
    this.el.querySelector('#au-filters').innerHTML = `
      <div class="form-group"><label>Process</label><select id="f-source">${opt(facets.sources, this.state.source_screen)}</select></div>
      <div class="form-group"><label>Task / Request #</label><input type="text" id="f-req" value="${UI.esc(this.state.request_number)}" placeholder="MR-…"></div>
      <div class="form-group"><label>User</label><select id="f-user">${opt(facets.users, this.state.changed_by_name)}</select></div>
      <div class="form-group"><label>Action / Movement</label><select id="f-action">${opt(facets.actions, this.state.action)}</select></div>
      <div class="form-group"><label>Entity</label><select id="f-entity">${opt(facets.entities, this.state.entity_type)}</select></div>
      <div class="form-group"><label>From</label><input type="date" id="f-from" value="${this.state.date_from}"></div>
      <div class="form-group"><label>To</label><input type="date" id="f-to" value="${this.state.date_to}"></div>
      <div class="form-group"><button class="btn secondary" id="f-reset">Reset</button></div>`;

    const apply = () => {
      this.state.source_screen = this.el.querySelector('#f-source').value;
      this.state.changed_by_name = this.el.querySelector('#f-user').value;
      this.state.action = this.el.querySelector('#f-action').value;
      this.state.entity_type = this.el.querySelector('#f-entity').value;
      this.state.date_from = this.el.querySelector('#f-from').value;
      this.state.date_to = this.el.querySelector('#f-to').value;
      this.state.page = 1; this.load();
    };
    ['#f-source', '#f-user', '#f-action', '#f-entity', '#f-from', '#f-to'].forEach((s) =>
      this.el.querySelector(s).addEventListener('change', apply));
    this.el.querySelector('#f-req').addEventListener('input', UI.debounce(() => {
      this.state.request_number = this.el.querySelector('#f-req').value.trim(); this.state.page = 1; this.load();
    }, 350));
    this.el.querySelector('#f-reset').addEventListener('click', () => {
      Object.assign(this.state, { page: 1, source_screen: '', entity_type: '', action: '', changed_by_name: '', request_number: '', date_from: '', date_to: '' });
      this.load(true);
    });
  },

  async load(withFilters = false) {
    let data;
    try { data = await Api.get(`/api/master/audit?${this.query({ page: this.state.page, limit: 25 })}`); }
    catch (err) { this.el.querySelector('#au-table').innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }

    if (withFilters) this.buildFilters(data.facets);

    // Summary tiles.
    const topAction = data.summary.by_action[0];
    const topUser = data.summary.by_user[0];
    this.el.querySelector('#au-summary').innerHTML = `
      <div class="mini-kpi"><div class="v">${UI.fmtQty(data.summary.total)}</div><div class="l">Events (filtered)</div></div>
      <div class="mini-kpi"><div class="v">${data.facets.users.length}</div><div class="l">Users</div></div>
      <div class="mini-kpi"><div class="v">${data.facets.actions.length}</div><div class="l">Action types</div></div>
      ${topAction ? `<div class="mini-kpi"><div class="v">${UI.esc(topAction.action)}</div><div class="l">Top action · ${topAction.count}</div></div>` : ''}
      ${topUser && topUser.user ? `<div class="mini-kpi"><div class="v">${UI.esc(topUser.user)}</div><div class="l">Most active · ${topUser.count}</div></div>` : ''}`;

    // Export control (fetches all filtered rows on demand).
    const columns = [
      { key: 'changed_at', label: 'When', value: (r) => UI.fmtDate(r.changed_at) },
      { key: 'source_screen', label: 'Process' },
      { key: 'entity_type', label: 'Entity' },
      { key: 'request_number', label: 'Request' },
      { key: 'line_number', label: 'Line' },
      { key: 'action', label: 'Action' },
      { key: 'changed_by_name', label: 'User' },
      { key: 'user_role', label: 'Role' },
      { key: 'change', label: 'Old → New', value: (r) => [r.old_value, r.new_value].filter(Boolean).join(' → ') },
      { key: 'reason', label: 'Reason' },
    ];
    const exportSlot = this.el.querySelector('#au-export');
    exportSlot.innerHTML = '';
    exportSlot.appendChild(UI.exportControl({
      filename: 'audit-trail', title: 'Audit Trail', columns,
      rows: async () => (await Api.get(`/api/master/audit?${this.query({ page: 1, limit: 5000 })}`)).audit,
    }));

    // Rows with a request number drill through to the source request.
    this.el.querySelector('#au-table').innerHTML = `
      <table><thead><tr><th>When</th><th>Process</th><th>Entity</th><th>Request</th><th>Ln</th><th>Action</th><th>User</th><th>Role</th><th>Old → New</th><th>Reason</th></tr></thead>
      <tbody>${data.audit.map((a) => `
        <tr ${a.request_number ? `class="row-link" data-req="${UI.esc(a.request_number)}" role="button" tabindex="0" aria-label="Open request ${UI.esc(a.request_number)}"` : ''}>
          <td>${UI.fmtDate(a.changed_at)}</td><td>${UI.esc(a.source_screen || '')}</td><td>${UI.esc(a.entity_type)}</td>
          <td>${a.request_number ? `<span class="chip accent">${UI.esc(a.request_number)}</span>` : ''}</td><td>${a.line_number || ''}</td><td><span class="badge role">${UI.esc(a.action)}</span></td>
          <td>${UI.esc(a.changed_by_name || '')}</td><td>${UI.esc(a.user_role || '')}</td>
          <td class="wrap" style="max-width:260px">${UI.esc([a.old_value, a.new_value].filter(Boolean).join(' → '))}</td>
          <td class="wrap">${UI.esc(a.reason || '')}</td></tr>`).join('') || `<tr><td colspan="10">${UI.meaningfulEmptyState({ title: 'No audit records match the filters', description: 'Try widening the date range or clearing a filter.' })}</td></tr>`}
      </tbody></table>`;
    UI.makeRowsActionable(this.el.querySelectorAll('tr[data-req]'), (tr) => {
      Pages.requests.state = { page: 1, search: tr.dataset.req, status: '' };
      location.hash = '#/requests';
    });
    UI.pagination(this.el.querySelector('#au-pagination'), data, (p) => { this.state.page = p; this.load(); });
  },
};

Pages.notifications = {
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card">
      <div class="toolbar"><h3 class="mb-0">Notifications</h3><div class="spacer"></div>
        <button class="btn secondary sm" id="nt-readall">Mark all read</button></div>
      <div id="nt-list"><div class="loading">Loading…</div></div></div>`;
    el.querySelector('#nt-readall').addEventListener('click', async () => {
      await Api.post('/api/notifications/read-all', {}); this.load(); App.refreshNotificationBadge();
    });
    await this.load();
  },
  async load() {
    const { notifications } = await Api.get('/api/notifications');
    this.el.querySelector('#nt-list').innerHTML = notifications.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Type</th><th>Title</th><th>Message</th><th>Request</th><th>When</th></tr></thead>
        <tbody>${notifications.map((n) => `
          <tr data-id="${n.id}" style="${n.status === 'SENT' ? 'font-weight:600' : ''}">
            <td>${n.status === 'SENT' ? '🔵' : ''}</td>
            <td><span class="badge role">${UI.esc(n.notification_type)}</span></td>
            <td>${UI.esc(n.notification_title || '')}</td><td class="wrap">${UI.esc(n.notification_message || '')}</td>
            <td>${n.request_number ? `<a href="#/request-detail-lookup" data-req="${UI.esc(n.request_number)}">${UI.esc(n.request_number)}</a>` : ''}</td>
            <td>${UI.fmtDate(n.sent_at)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No notifications.</p>';
    this.el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      await Api.post(`/api/notifications/${tr.dataset.id}/read`, {}); App.refreshNotificationBadge();
      tr.style.fontWeight = ''; tr.querySelector('td').textContent = '';
    }));
  },
};

Pages.kpi = {
  charts: [],
  async render(el) {
    el.innerHTML = '<div class="loading">Loading KPIs…</div>';
    let data;
    try { data = await Api.get('/api/kpi'); }
    catch (err) { el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    const k = data.kpis;
    // Every tile drills through to its source data (requests list, audit
    // trail filtered by action, expiry alerts, batch tracking).
    const tile = (cls, label, value, drill, sub = '') => `
      <div class="kpi ${cls} row-link" data-drill="${drill}" role="button" tabindex="0"
        title="Open source data"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
    el.innerHTML = `
      <div class="grid kpis">
        ${tile('accent', 'Total Requests', k.total_requests, 'requests:')}
        ${tile('green', 'Completed', k.completed, 'requests:Completed')}
        ${tile('amber', 'Partially Completed', k.partially_completed, 'requests:Partially Completed')}
        ${tile('accent', 'Open', k.open, 'requests:')}
        ${tile('red', 'ERP Error', k.erp_error, 'requests:ERP Error')}
        ${tile('red', 'Rejected / Cancelled', k.rejected + k.cancelled, 'requests:Rejected')}
        ${tile('accent', 'Avg Approval (min)', k.avg_approval_minutes, 'requests:')}
        ${tile('accent', 'Avg GI Posting (min)', k.avg_gi_posting_minutes, 'requests:')}
        ${tile('amber', 'Shortage Lines', k.shortage_lines, 'requests:', `${k.shortage_percentage}% of lines`)}
        ${tile('red', 'Expired Batches', k.expired_batches, 'expiry:')}
        ${tile('green', 'QR Scan Pass', k.qr_scan_pass, 'audit:QR_SCAN_PASS', `${k.qr_scan_failure} failed`)}
        ${tile('amber', 'Overrides', k.manual_override_count, 'audit:SUPERVISOR_OVERRIDE')}
        ${tile('accent', 'FIFO / FEFO Allocations', `${k.fifo_allocations}/${k.fefo_allocations}`, 'batches:')}
        ${tile('green', 'ERP Success Rate', `${k.erp_success_rate}%`, 'audit:GI_POSTED', `${k.erp_posting_success} ok · ${k.erp_posting_failure} fail`)}
      </div>
      <div class="grid two">
        <div class="card"><h3>Requests by status</h3><div class="chart-box"><canvas id="kpi-status"></canvas></div></div>
        <div class="card"><h3>Requests by warehouse</h3><div class="chart-box"><canvas id="kpi-wh"></canvas></div></div>
      </div>`;
    UI.makeRowsActionable(el.querySelectorAll('[data-drill]'), (n) => {
      const [route, arg] = n.dataset.drill.split(':');
      if (route === 'requests') {
        Pages.requests.state = { page: 1, search: '', status: arg || '' };
      } else if (route === 'audit') {
        Pages.audit.state = { page: 1, source_screen: '', entity_type: '', action: arg || '',
          changed_by_name: '', request_number: '', date_from: '', date_to: '' };
      }
      location.hash = `#/${route}`;
    });
    this.renderCharts(data);
  },
  destroy() { this.charts.forEach((c) => c.destroy()); this.charts = []; },
  renderCharts(data) {
    this.destroy();
    if (typeof Chart === 'undefined') return;
    const v = UI.viz();
    const grid = v.grid, muted = v.muted;
    const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: muted } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted } } } };
    const s = data.by_status || [];
    this.charts.push(new Chart(document.getElementById('kpi-status'), { type: 'bar',
      data: { labels: s.map((x) => x.status), datasets: [{ data: s.map((x) => x.count), backgroundColor: v.c1, borderRadius: 4, maxBarThickness: 26 }] },
      options: { ...opts, indexAxis: 'y', scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted } }, y: { grid: { display: false }, ticks: { color: muted } } } } }));
    const w = data.by_warehouse || [];
    this.charts.push(new Chart(document.getElementById('kpi-wh'), { type: 'bar',
      data: { labels: w.map((x) => x.warehouse), datasets: [{ data: w.map((x) => x.count), backgroundColor: v.c2, borderRadius: 4, maxBarThickness: 40 }] }, options: opts }));
  },
};
