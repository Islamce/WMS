/** KYNOX Operations Command Center — stock visibility plus execution exceptions. */
window.Pages = window.Pages || {};

function VIZCOLORS() {
  const v = UI.viz();
  return { in: v.c1, out: v.red, bar1: v.c1, bar2: v.c2, grid: v.grid, ink: v.ink, muted: v.muted };
}

Pages.dashboard = {
  charts: [],

  async render(el) {
    this.destroyCharts();
    el.innerHTML = '<div class="loading">Loading command center…</div>';

    const canKpi = App.can('kpi_dashboard');
    const [dashboardResult, kpiResult] = await Promise.allSettled([
      Api.get('/api/dashboard'),
      canKpi ? Api.get('/api/kpi') : Promise.resolve(null),
    ]);

    if (dashboardResult.status !== 'fulfilled') {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(dashboardResult.reason?.message || 'Dashboard data could not be loaded.')}</div>`;
      return;
    }

    const data = dashboardResult.value;
    const execution = kpiResult.status === 'fulfilled' ? kpiResult.value : null;
    const k = data.kpis || {};
    const ek = execution?.kpis || null;
    const nav = (perm, route) => (App.can(perm) ? ` data-nav="${route}" role="button" tabindex="0"` : '');
    const metric = (cls, label, value, sub, perm, route) => `
      <div class="kpi ${cls}"${nav(perm, route)}>
        <div class="label">${UI.esc(label)}</div>
        <div class="value">${value}</div>
        ${sub ? `<div class="sub">${UI.esc(sub)}</div>` : ''}
      </div>`;

    const exceptionCards = ek ? [
      { level: ek.erp_error > 0 ? 'critical' : 'clear', value: ek.erp_error, label: 'ERP posting errors', detail: 'Requests requiring posting correction', route: 'requests', state: { status: 'ERP Error' } },
      { level: ek.shortage_lines > 0 ? 'warning' : 'clear', value: ek.shortage_lines, label: 'Shortage lines', detail: `${ek.shortage_percentage || 0}% of request lines`, route: 'requests', state: { status: '' } },
      { level: ek.expired_batches > 0 ? 'critical' : 'clear', value: ek.expired_batches, label: 'Expired batches', detail: 'Stock requiring immediate disposition', route: 'expiry' },
      { level: ek.qr_scan_failure > 0 ? 'warning' : 'clear', value: ek.qr_scan_failure, label: 'Failed QR scans', detail: `${ek.qr_scan_pass || 0} successful scans`, route: 'audit', state: { action: 'QR_SCAN_FAILURE' } },
      { level: ek.open > 0 ? 'info' : 'clear', value: ek.open, label: 'Open requests', detail: 'Active execution workload', route: 'requests', state: { status: '' } },
      { level: ek.partially_completed > 0 ? 'warning' : 'clear', value: ek.partially_completed, label: 'Partially completed', detail: 'Requests awaiting remaining quantities', route: 'requests', state: { status: 'Partially Completed' } },
    ] : [];

    el.innerHTML = `
      <section class="cc-hero">
        <div>
          <span class="cc-eyebrow">LIVE OPERATIONS</span>
          <h1>Warehouse Command Center</h1>
          <p>Current stock position, execution workload and exceptions requiring action.</p>
          <div class="page-head-context">
            <span>${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>
        <div class="cc-refresh">
          <span class="cc-live"><i></i> Data loaded</span>
          <button class="btn secondary sm" id="cc-refresh">Refresh</button>
          ${App.can('create_request') ? '<button class="btn sm" data-nav="create-request">+ Create request</button>' : ''}
        </div>
      </section>

      ${ek ? `<section class="cc-section">
        <div class="cc-section-head"><div><h2>Action required</h2><p>Exception queues ranked by operational impact.</p></div></div>
        <div class="cc-exceptions">
          ${exceptionCards.map((x) => `<article class="cc-exception ${x.level}" data-exception-route="${x.route}" data-exception-state='${UI.esc(JSON.stringify(x.state || {}))}' role="button" tabindex="0">
            <div class="cc-exception-value">${UI.fmtQty(x.value || 0)}</div>
            <div><strong>${UI.esc(x.label)}</strong><span>${UI.esc(x.detail)}</span></div>
            <span class="cc-arrow">→</span>
          </article>`).join('')}
        </div>
      </section>` : `<div class="inline-alert warning">Execution KPI data is unavailable or not permitted. Stock monitoring remains active.</div>`}

      <section class="cc-section">
        <div class="cc-section-head"><div><h2>Operational snapshot</h2><p>Physical inventory and today's warehouse movement.</p></div></div>
        <div class="grid kpis cc-kpis">
          ${metric('accent', 'Total materials', UI.fmtQty(k.total_materials || 0), 'Active material records', 'materials', 'materials')}
          ${metric('accent', 'Total stock', UI.fmtQty(k.total_stock || 0), 'Quantity across all bins', 'batch_tracking', 'batches')}
          ${metric('green', 'Stock in today', UI.fmtQty(k.stock_in_today || 0), `${UI.fmtQty(k.stock_in_month || 0)} this month`, 'batch_tracking', 'batches')}
          ${metric('red', 'Stock out today', UI.fmtQty(k.stock_out_today || 0), `${UI.fmtQty(k.stock_out_month || 0)} this month`, 'gi_posting', 'gi-posting')}
          ${metric('green', 'Occupied bins', UI.fmtQty(k.occupied_locations || 0), `${UI.fmtQty(k.total_locations || 0)} total bins`, 'all_locations', 'all-locations')}
          ${metric('amber', 'Empty bins', UI.fmtQty(k.empty_locations || 0), 'Available storage locations', 'empty_locations', 'empty-locations')}
          ${ek ? metric('green', 'ERP success rate', `${ek.erp_success_rate || 0}%`, `${ek.erp_posting_success || 0} successful postings`, 'kpi_dashboard', 'kpi') : ''}
          ${ek ? metric('accent', 'Completed requests', UI.fmtQty(ek.completed || 0), `${UI.fmtQty(ek.total_requests || 0)} total requests`, 'material_requests', 'requests') : ''}
        </div>
      </section>

      <section class="cc-section">
        <div class="cc-section-head"><div><h2>Flow and distribution</h2><p>Thirty-day movement and current stock concentration.</p></div></div>
        <div class="grid two">
          <div class="card"><h3>Stock IN vs OUT — last 30 days</h3><div class="chart-box"><canvas id="ch-inout"></canvas></div></div>
          <div class="card"><h3>Stock by warehouse</h3><div class="chart-box"><canvas id="ch-location"></canvas></div></div>
          <div class="card"><h3>Stock by material group</h3><div class="chart-box"><canvas id="ch-group"></canvas></div></div>
          <div class="card"><h3>Transactions by user</h3><div class="chart-box"><canvas id="ch-users"></canvas></div></div>
        </div>
      </section>

      <section class="cc-section">
        <div class="grid two">
          <div class="card"><h3>Top materials by stock</h3><div class="table-wrap"><table>
            <thead><tr><th>Item code</th><th>Description</th><th class="text-right">Quantity</th><th>Unit</th></tr></thead>
            <tbody>${(data.top_materials || []).map((m) => `<tr${App.can('materials') ? ' data-nav="materials" class="row-link"' : ''}><td>${UI.esc(m.item_code)}</td><td class="wrap">${UI.esc(m.description)}</td><td class="text-right">${UI.fmtQty(m.quantity)}</td><td>${UI.esc(m.unit)}</td></tr>`).join('') || `<tr><td colspan="4">${UI.meaningfulEmptyState({ title: 'No stock recorded yet', description: 'Materials with on-hand quantity will rank here once a receipt or opening-stock import lands.', actionHtml: App.can('materials') ? '<a href="#/materials" class="btn secondary sm" style="margin-top:8px">Go to Materials</a>' : '' })}</td></tr>`}</tbody>
          </table></div></div>
          <div class="card"><h3>Top bins by stock</h3><div class="table-wrap"><table>
            <thead><tr><th>Location</th><th class="text-right">Quantity</th></tr></thead>
            <tbody>${(data.top_locations || []).map((l) => `<tr${App.can('all_locations') ? ' data-nav="all-locations" class="row-link"' : ''}><td>${UI.esc(l.code)}</td><td class="text-right">${UI.fmtQty(l.quantity)}</td></tr>`).join('') || `<tr><td colspan="2">${UI.meaningfulEmptyState({ title: 'No occupied bins yet', description: 'Bin locations will rank here once stock is received into them.', actionHtml: App.can('all_locations') ? '<a href="#/all-locations" class="btn secondary sm" style="margin-top:8px">Go to Locations</a>' : '' })}</td></tr>`}</tbody>
          </table></div></div>
        </div>
      </section>

      <section class="cc-section"><div class="card"><h3>Recent stock transactions</h3><div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Material</th><th>Location</th><th class="text-right">Qty</th><th>Reservation</th><th>User</th><th>Date</th></tr></thead>
        <tbody>${(data.recent_transactions || []).map((t) => `<tr><td><span class="badge ${UI.esc(t.transaction_type)}">${UI.esc(t.transaction_type)}</span></td><td class="wrap">${UI.esc(t.item_code)} — ${UI.esc(t.material_description)}</td><td><span class="chip">${UI.esc(t.location_code)}</span></td><td class="text-right">${UI.fmtQty(t.quantity)}</td><td>${t.reservation_number ? `<span class="chip accent">${UI.esc(t.reservation_number)}</span>` : '—'}</td><td>${UI.esc(t.user_name)}</td><td>${UI.fmtDate(t.transaction_date)}</td></tr>`).join('') || `<tr><td colspan="7">${UI.meaningfulEmptyState({ title: 'No warehouse activity yet', description: 'Goods receipts, issues, and stock movements will appear here as they happen.' })}</td></tr>`}</tbody>
      </table></div></div></section>`;

    el.querySelectorAll('[data-nav]').forEach((node) => node.classList.add('clickable'));
    UI.makeRowsActionable(el.querySelectorAll('[data-nav]'), (node) => { location.hash = `#/${node.dataset.nav}`; });

    UI.makeRowsActionable(el.querySelectorAll('[data-exception-route]'), (node) => {
      const route = node.dataset.exceptionRoute;
      let state = {};
      try { state = JSON.parse(node.dataset.exceptionState || '{}'); } catch (_) { state = {}; }
      if (route === 'requests') Pages.requests.state = { page: 1, search: '', status: state.status || '' };
      if (route === 'audit') Pages.audit.state = { page: 1, source_screen: '', entity_type: '', action: state.action || '', changed_by_name: '', request_number: '', date_from: '', date_to: '' };
      location.hash = `#/${route}`;
    });

    el.querySelector('#cc-refresh')?.addEventListener('click', () => this.render(el));
    this.renderCharts(data.charts || {});
  },

  destroyCharts() { this.charts.forEach((c) => c.destroy()); this.charts = []; },

  baseOptions() {
    const VIZ = VIZCOLORS();
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: VIZ.muted } }, y: { beginAtZero: true, grid: { color: VIZ.grid }, ticks: { color: VIZ.muted } } } };
  },

  renderCharts(charts) {
    this.destroyCharts();
    if (typeof Chart === 'undefined') return;
    const VIZ = VIZCOLORS();
    const days = charts.in_out_over_time || [];
    const lineOpts = this.baseOptions();
    lineOpts.plugins.legend = { display: true, labels: { color: VIZ.ink, boxWidth: 12 } };
    lineOpts.interaction = { mode: 'index', intersect: false };
    const inout = document.getElementById('ch-inout');
    if (inout) this.charts.push(new Chart(inout, { type: 'line', data: { labels: days.map((d) => d.day), datasets: [
      { label: 'IN', data: days.map((d) => d.in_qty), borderColor: VIZ.in, backgroundColor: VIZ.in, borderWidth: 2, pointRadius: 2, tension: 0.25 },
      { label: 'OUT', data: days.map((d) => d.out_qty), borderColor: VIZ.out, backgroundColor: VIZ.out, borderWidth: 2, pointRadius: 2, tension: 0.25 },
    ] }, options: lineOpts }));

    const bar = (canvasId, rows, labelKey, valueKey, color, horizontal = false, navRoute = null) => {
      const canvas = document.getElementById(canvasId); if (!canvas) return;
      const opts = this.baseOptions();
      if (horizontal) { opts.indexAxis = 'y'; opts.scales = { x: { beginAtZero: true, grid: { color: VIZ.grid }, ticks: { color: VIZ.muted } }, y: { grid: { display: false }, ticks: { color: VIZ.muted } } }; }
      if (navRoute && App.can(this.NAV_PERM[navRoute])) { opts.onClick = (_e, els) => { if (els.length) location.hash = `#/${navRoute}`; }; opts.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }; }
      this.charts.push(new Chart(canvas, { type: 'bar', data: { labels: (rows || []).map((r) => r[labelKey]), datasets: [{ data: (rows || []).map((r) => r[valueKey]), backgroundColor: color, borderRadius: 4, maxBarThickness: 26 }] }, options: opts }));
    };
    bar('ch-group', charts.stock_by_group, 'material_group', 'quantity', VIZ.bar1, false, 'materials');
    bar('ch-location', charts.stock_by_location, 'code', 'quantity', VIZ.bar2, false, 'all-locations');
    bar('ch-users', charts.transactions_by_user, 'name', 'transactions', VIZ.bar1, true, 'audit');
  },

  NAV_PERM: { materials: 'materials', 'all-locations': 'all_locations', audit: 'audit_trail' },
};
