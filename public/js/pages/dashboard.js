/** Admin dashboard: KPI tiles, charts, top lists, recent transactions. */
window.Pages = window.Pages || {};

// Theme-aware chart colors (validated palette, resolved at render time so a
// theme switch re-colors charts on the next render).
function VIZCOLORS() {
  const v = UI.viz();
  return { in: v.c1, out: v.red, bar1: v.c1, bar2: v.c2, grid: v.grid, ink: v.ink, muted: v.muted };
}

Pages.dashboard = {
  charts: [],

  async render(el) {
    el.innerHTML = '<div class="loading">Loading dashboard…</div>';
    let data;
    try {
      data = await Api.get('/api/dashboard');
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }

    const k = data.kpis;
    el.innerHTML = `
      <div class="grid kpis">
        <div class="kpi accent"><div class="label">Total Materials</div><div class="value">${UI.fmtQty(k.total_materials)}</div></div>
        <div class="kpi accent"><div class="label">Total Locations</div><div class="value">${UI.fmtQty(k.total_locations)}</div></div>
        <div class="kpi green"><div class="label">Occupied Locations</div><div class="value">${UI.fmtQty(k.occupied_locations)}</div></div>
        <div class="kpi amber"><div class="label">Empty Locations</div><div class="value">${UI.fmtQty(k.empty_locations)}</div></div>
        <div class="kpi accent"><div class="label">Total Stock Quantity</div><div class="value">${UI.fmtQty(k.total_stock)}</div></div>
        <div class="kpi green"><div class="label">Stock In</div><div class="value">${UI.fmtQty(k.stock_in_today)}</div><div class="sub">today · ${UI.fmtQty(k.stock_in_month)} this month</div></div>
        <div class="kpi red"><div class="label">Stock Out</div><div class="value">${UI.fmtQty(k.stock_out_today)}</div><div class="sub">today · ${UI.fmtQty(k.stock_out_month)} this month</div></div>
        <div class="kpi amber"><div class="label">Pending Users</div><div class="value">${UI.fmtQty(k.pending_users)}</div><div class="sub">${App.can('users_management') ? '<a href="#/users">review now</a>' : 'waiting for approval'}</div></div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Stock IN vs OUT — last 30 days</h3><div class="chart-box"><canvas id="ch-inout"></canvas></div></div>
        <div class="card"><h3>Stock quantity by material group</h3><div class="chart-box"><canvas id="ch-group"></canvas></div></div>
        <div class="card"><h3>Stock quantity by location</h3><div class="chart-box"><canvas id="ch-location"></canvas></div></div>
        <div class="card"><h3>Transactions by user</h3><div class="chart-box"><canvas id="ch-users"></canvas></div></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Top 10 materials by stock</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Item Code</th><th>Description</th><th class="text-right">Quantity</th><th>Unit</th></tr></thead>
            <tbody>
              ${data.top_materials.map((m) => `
                <tr><td>${UI.esc(m.item_code)}</td><td class="wrap">${UI.esc(m.description)}</td>
                <td class="text-right">${UI.fmtQty(m.quantity)}</td><td>${UI.esc(m.unit)}</td></tr>`).join('')
                || '<tr><td colspan="4" class="muted">No stock yet</td></tr>'}
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <h3>Top 10 locations by stock</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Location</th><th class="text-right">Quantity</th></tr></thead>
            <tbody>
              ${data.top_locations.map((l) => `
                <tr><td>${UI.esc(l.code)}</td><td class="text-right">${UI.fmtQty(l.quantity)}</td></tr>`).join('')
                || '<tr><td colspan="2" class="muted">No stock yet</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>

      <div class="card">
        <h3>Recent stock transactions</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Type</th><th>Material</th><th>Location</th><th class="text-right">Qty</th><th>Reservation</th><th>User</th><th>Date</th></tr></thead>
          <tbody>
            ${data.recent_transactions.map((t) => `
              <tr>
                <td><span class="badge ${t.transaction_type}">${t.transaction_type}</span></td>
                <td class="wrap">${UI.esc(t.item_code)} — ${UI.esc(t.material_description)}</td>
                <td>${UI.esc(t.location_code)}</td>
                <td class="text-right">${UI.fmtQty(t.quantity)}</td>
                <td>${UI.esc(t.reservation_number || '—')}</td>
                <td>${UI.esc(t.user_name)}</td>
                <td>${UI.fmtDate(t.transaction_date)}</td>
              </tr>`).join('') || '<tr><td colspan="7" class="muted">No transactions yet</td></tr>'}
          </tbody>
        </table></div>
      </div>`;

    this.renderCharts(data.charts);
  },

  destroyCharts() {
    this.charts.forEach((c) => c.destroy());
    this.charts = [];
  },

  baseOptions() {
    const VIZ = VIZCOLORS();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: VIZ.muted } },
        y: { beginAtZero: true, grid: { color: VIZ.grid }, ticks: { color: VIZ.muted } },
      },
    };
  },

  renderCharts(charts) {
    this.destroyCharts();
    if (typeof Chart === 'undefined') return;
    const VIZ = VIZCOLORS();

    // Line chart: two series -> legend shown.
    const days = charts.in_out_over_time;
    const lineOpts = this.baseOptions();
    lineOpts.plugins.legend = { display: true, labels: { color: VIZ.ink, boxWidth: 12 } };
    lineOpts.interaction = { mode: 'index', intersect: false };
    this.charts.push(new Chart(document.getElementById('ch-inout'), {
      type: 'line',
      data: {
        labels: days.map((d) => d.day),
        datasets: [
          { label: 'IN', data: days.map((d) => d.in_qty), borderColor: VIZ.in, backgroundColor: VIZ.in, borderWidth: 2, pointRadius: 3, tension: 0.25 },
          { label: 'OUT', data: days.map((d) => d.out_qty), borderColor: VIZ.out, backgroundColor: VIZ.out, borderWidth: 2, pointRadius: 3, tension: 0.25 },
        ],
      },
      options: lineOpts,
    }));

    const bar = (canvasId, rows, labelKey, valueKey, color, horizontal = false) => {
      const opts = this.baseOptions();
      if (horizontal) {
        opts.indexAxis = 'y';
        opts.scales = {
          x: { beginAtZero: true, grid: { color: VIZ.grid }, ticks: { color: VIZ.muted } },
          y: { grid: { display: false }, ticks: { color: VIZ.muted } },
        };
      }
      this.charts.push(new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
          labels: rows.map((r) => r[labelKey]),
          datasets: [{
            data: rows.map((r) => r[valueKey]),
            backgroundColor: color,
            borderRadius: 4,
            maxBarThickness: 26,
          }],
        },
        options: opts,
      }));
    };

    bar('ch-group', charts.stock_by_group, 'material_group', 'quantity', VIZ.bar1);
    bar('ch-location', charts.stock_by_location, 'code', 'quantity', VIZ.bar2);
    bar('ch-users', charts.transactions_by_user, 'name', 'transactions', VIZ.bar1, true);
  },
};
