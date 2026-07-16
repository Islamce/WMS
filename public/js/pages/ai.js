/**
 * AI Stock Analytics — movement classification, reorder/safety-stock analysis,
 * dead & slow stock, trends, and rule-based insights with visual reports.
 */
window.Pages = window.Pages || {};

Pages.ai = {
  charts: [],

  async render(el) {
    el.innerHTML = '<div class="loading">Running stock analysis…</div>';
    let data;
    try { data = await Api.get('/api/analytics'); }
    catch (err) { el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    const s = data.summary;
    const v = UI.viz();

    const sevBadge = { critical: 'OUT', warning: 'pending', info: 'role', good: 'active' };
    const clsBadge = { DEAD: 'OUT', SLOW: 'pending', NORMAL: 'role', FAST: 'active' };

    const reorderRows = data.items.filter((i) => i.below_reorder || (i.classification === 'FAST' && i.days_of_cover !== null && i.days_of_cover < data.parameters.lead_time_days * 2));
    const deadRows = data.items.filter((i) => i.classification === 'DEAD');

    el.innerHTML = `
      <div class="grid kpis">
        <div class="kpi accent"><div class="label">Materials Analyzed</div><div class="value">${s.materials_analyzed}</div>
          <div class="sub">${data.parameters.window_days}-day window · ${data.parameters.lead_time_days}d lead time</div></div>
        <div class="kpi accent"><div class="label">Total Stock Value</div><div class="value">${UI.fmtQty(s.total_stock_value)}</div></div>
        <div class="kpi green"><div class="label">Fast Movers</div><div class="value">${s.fast_count}</div></div>
        <div class="kpi amber"><div class="label">Slow Movers</div><div class="value">${s.slow_count}</div></div>
        <div class="kpi red"><div class="label">Dead Stock</div><div class="value">${s.dead_count}</div>
          <div class="sub">value ${UI.fmtQty(s.dead_stock_value)}</div></div>
        <div class="kpi red"><div class="label">Below Reorder Point</div><div class="value">${s.below_reorder_count}</div></div>
      </div>

      <div class="card">
        <h3>🤖 AI Insights</h3>
        ${data.insights.map((i) => `
          <div class="insight ${i.severity}">
            <div class="t"><span class="badge ${sevBadge[i.severity] || 'role'}">${i.severity.toUpperCase()}</span> ${UI.esc(i.title)}</div>
            <div class="d">${UI.esc(i.detail)}</div>
          </div>`).join('')}
      </div>

      <div class="grid two">
        <div class="card"><h3>Movement classification</h3><div class="chart-box"><canvas id="ai-class"></canvas></div></div>
        <div class="card"><h3>Weekly stock IN vs OUT (12 weeks)</h3><div class="chart-box"><canvas id="ai-trend"></canvas></div></div>
      </div>
      <div class="card"><h3>Top consumers — issued quantity (${data.parameters.window_days} days)</h3>
        <div class="chart-box"><canvas id="ai-top"></canvas></div></div>

      <div class="card">
        <h3>ABC-XYZ matrix</h3>
        <p class="muted">ABC = share of consumption value (A ≈ top 80%). XYZ = demand stability (X = stable, Z = erratic). A-X items suit automatic replenishment; A-Z items need manual attention.</p>
        <div class="abc-matrix">
          <span class="hd"></span><span class="hd">X · stable</span><span class="hd">Y · variable</span><span class="hd">Z · erratic</span>
          ${['A', 'B', 'C'].map((a) => `
            <span class="hd">${a}</span>
            ${['X', 'Y', 'Z'].map((x) => {
              const cell = data.abc_xyz_matrix[`${a}${x}`] || { count: 0, items: [] };
              return `<div class="abc-cell"><div class="n">${cell.count}</div>
                <div class="items">${cell.items.slice(0, 4).map(UI.esc).join(', ')}${cell.count > 4 ? '…' : ''}</div></div>`;
            }).join('')}`).join('')}
        </div>
      </div>

      <div class="card">
        <h3>Reorder alerts &amp; safety stock</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>Class</th><th class="text-right">Stock</th><th class="text-right">Avg daily demand</th>
            <th class="text-right">Safety stock</th><th class="text-right">Reorder point</th><th class="text-right">Days of cover</th><th>Status</th></tr></thead>
          <tbody>${reorderRows.map((i) => `
            <tr><td><strong>${UI.esc(i.item_code)}</strong> <span class="muted">${UI.esc(i.description)}</span></td>
              <td><span class="badge ${clsBadge[i.classification] || 'role'}">${i.classification}</span></td>
              <td class="text-right">${UI.fmtQty(i.current_stock)}</td>
              <td class="text-right">${i.avg_daily_demand}</td>
              <td class="text-right">${i.safety_stock}</td>
              <td class="text-right">${i.reorder_point}</td>
              <td class="text-right">${i.days_of_cover ?? '—'}</td>
              <td>${i.below_reorder ? '<span class="badge OUT">REPLENISH NOW</span>' : '<span class="badge pending">watch</span>'}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="muted">No reorder risks detected 🎉</td></tr>'}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h3>Dead stock (no issues in ${data.parameters.window_days}+ days)</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>Group</th><th class="text-right">Stock</th><th class="text-right">Value</th>
            <th class="text-right">Days since last issue</th></tr></thead>
          <tbody>${deadRows.map((i) => `
            <tr><td><strong>${UI.esc(i.item_code)}</strong> <span class="muted">${UI.esc(i.description)}</span></td>
              <td>${UI.esc(i.material_group || '')}</td>
              <td class="text-right">${UI.fmtQty(i.current_stock)}</td>
              <td class="text-right">${UI.fmtQty(i.stock_value)}</td>
              <td class="text-right">${i.days_since_last_issue ?? 'never issued'}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="muted">No dead stock 🎉</td></tr>'}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h3>Full analysis (${data.items.length} materials)</h3>
        <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table>
          <thead><tr><th>Item</th><th>Class</th><th>ABC</th><th>XYZ</th><th>FSN</th><th class="text-right">Stock</th><th class="text-right">Issued (${data.parameters.window_days}d)</th>
            <th class="text-right">Reorder pt</th><th class="text-right">EOQ</th><th class="text-right">Value</th><th>Flags</th></tr></thead>
          <tbody>${data.items.map((i) => `
            <tr><td><strong>${UI.esc(i.item_code)}</strong></td>
              <td><span class="badge ${clsBadge[i.classification] || 'role'}">${i.classification}</span></td>
              <td>${i.abc_class || '—'}</td><td>${i.xyz_class || '—'}</td><td>${i.fsn_class || '—'}</td>
              <td class="text-right">${UI.fmtQty(i.current_stock)}</td>
              <td class="text-right">${UI.fmtQty(i.out_qty_window)}</td>
              <td class="text-right">${i.reorder_point}</td>
              <td class="text-right">${i.eoq ?? '—'}</td>
              <td class="text-right">${UI.fmtQty(i.stock_value)}</td>
              <td>${i.overstock ? '<span class="badge pending">overstock</span>' : ''}${i.below_reorder ? '<span class="badge OUT">understock</span>' : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    this.renderCharts(data, v);
  },

  destroy() { this.charts.forEach((c) => c.destroy()); this.charts = []; },

  renderCharts(data, v) {
    this.destroy();
    if (typeof Chart === 'undefined') return;
    const base = () => ({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: v.muted } },
                y: { beginAtZero: true, grid: { color: v.grid }, ticks: { color: v.muted } } },
    });

    // Classification doughnut (identity colors per class).
    const s = data.summary;
    this.charts.push(new Chart(document.getElementById('ai-class'), {
      type: 'doughnut',
      data: {
        labels: ['Fast', 'Normal', 'Slow', 'Dead'],
        datasets: [{ data: [s.fast_count, s.normal_count, s.slow_count, s.dead_count],
          backgroundColor: [v.c2, v.c1, v.c3, v.red], borderWidth: 2,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff' }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { display: true, position: 'bottom', labels: { color: v.ink, boxWidth: 12 } } } },
    }));

    // Weekly IN vs OUT line.
    const w = data.weekly_trend;
    const trendOpts = base();
    trendOpts.plugins.legend = { display: true, labels: { color: v.ink, boxWidth: 12 } };
    trendOpts.interaction = { mode: 'index', intersect: false };
    this.charts.push(new Chart(document.getElementById('ai-trend'), {
      type: 'line',
      data: { labels: w.map((x) => x.week),
        datasets: [
          { label: 'IN', data: w.map((x) => x.in_qty), borderColor: v.c1, backgroundColor: v.c1, borderWidth: 2, pointRadius: 3, tension: .25 },
          { label: 'OUT', data: w.map((x) => x.out_qty), borderColor: v.red, backgroundColor: v.red, borderWidth: 2, pointRadius: 3, tension: .25 },
        ] },
      options: trendOpts,
    }));

    // Top consumers horizontal bar.
    const top = data.top_consumers;
    const topOpts = base();
    topOpts.indexAxis = 'y';
    topOpts.scales = { x: { beginAtZero: true, grid: { color: v.grid }, ticks: { color: v.muted } },
                       y: { grid: { display: false }, ticks: { color: v.muted } } };
    this.charts.push(new Chart(document.getElementById('ai-top'), {
      type: 'bar',
      data: { labels: top.map((x) => x.item_code),
        datasets: [{ data: top.map((x) => x.out_qty_window), backgroundColor: v.c1, borderRadius: 4, maxBarThickness: 22 }] },
      options: topOpts,
    }));
  },
};
