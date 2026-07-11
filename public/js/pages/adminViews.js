/** Audit trail, notifications center, and KPI dashboard. */
window.Pages = window.Pages || {};

Pages.audit = {
  state: { page: 1, request_number: '', action: '' },
  async render(el) {
    this.el = el;
    el.innerHTML = `<div class="card">
      <div class="toolbar"><h3 class="mb-0">Audit Trail</h3><div class="spacer"></div>
        <input type="text" class="search-input" id="au-req" placeholder="Filter by request #"></div>
      <div class="table-wrap" id="au-table"><div class="loading">Loading…</div></div>
      <div class="pagination" id="au-pagination"></div></div>`;
    el.querySelector('#au-req').addEventListener('input', UI.debounce((e) => {
      this.state.request_number = e.target.value.trim(); this.state.page = 1; this.load();
    }, 300));
    await this.load();
  },
  async load() {
    const { page, request_number } = this.state;
    const data = await Api.get(`/api/master/audit?page=${page}&limit=25&request_number=${encodeURIComponent(request_number)}`);
    this.el.querySelector('#au-table').innerHTML = `
      <table><thead><tr><th>When</th><th>Entity</th><th>Request</th><th>Ln</th><th>Action</th><th>By</th><th>Role</th><th>Old → New</th><th>Reason</th></tr></thead>
      <tbody>${data.audit.map((a) => `
        <tr><td>${UI.fmtDate(a.changed_at)}</td><td>${UI.esc(a.entity_type)}</td><td>${UI.esc(a.request_number || '')}</td>
          <td>${a.line_number || ''}</td><td>${UI.esc(a.action)}</td><td>${UI.esc(a.changed_by_name || '')}</td>
          <td>${UI.esc(a.user_role || '')}</td>
          <td class="wrap" style="max-width:280px">${UI.esc([a.old_value, a.new_value].filter(Boolean).join(' → '))}</td>
          <td class="wrap">${UI.esc(a.reason || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No audit records</td></tr>'}
      </tbody></table>`;
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
    el.innerHTML = `
      <div class="grid kpis">
        <div class="kpi accent"><div class="label">Total Requests</div><div class="value">${k.total_requests}</div></div>
        <div class="kpi green"><div class="label">Completed</div><div class="value">${k.completed}</div></div>
        <div class="kpi amber"><div class="label">Partially Completed</div><div class="value">${k.partially_completed}</div></div>
        <div class="kpi accent"><div class="label">Open</div><div class="value">${k.open}</div></div>
        <div class="kpi red"><div class="label">ERP Error</div><div class="value">${k.erp_error}</div></div>
        <div class="kpi red"><div class="label">Rejected / Cancelled</div><div class="value">${k.rejected + k.cancelled}</div></div>
        <div class="kpi accent"><div class="label">Avg Approval (min)</div><div class="value">${k.avg_approval_minutes}</div></div>
        <div class="kpi accent"><div class="label">Avg GI Posting (min)</div><div class="value">${k.avg_gi_posting_minutes}</div></div>
        <div class="kpi amber"><div class="label">Shortage Lines</div><div class="value">${k.shortage_lines}</div><div class="sub">${k.shortage_percentage}% of lines</div></div>
        <div class="kpi red"><div class="label">Expired Batches</div><div class="value">${k.expired_batches}</div></div>
        <div class="kpi green"><div class="label">QR Scan Pass</div><div class="value">${k.qr_scan_pass}</div><div class="sub">${k.qr_scan_failure} failed</div></div>
        <div class="kpi amber"><div class="label">Overrides</div><div class="value">${k.manual_override_count}</div></div>
        <div class="kpi accent"><div class="label">FIFO / FEFO Allocations</div><div class="value">${k.fifo_allocations}/${k.fefo_allocations}</div></div>
        <div class="kpi green"><div class="label">ERP Success Rate</div><div class="value">${k.erp_success_rate}%</div><div class="sub">${k.erp_posting_success} ok · ${k.erp_posting_failure} fail</div></div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Requests by status</h3><div class="chart-box"><canvas id="kpi-status"></canvas></div></div>
        <div class="card"><h3>Requests by warehouse</h3><div class="chart-box"><canvas id="kpi-wh"></canvas></div></div>
      </div>`;
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
