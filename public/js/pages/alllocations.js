/** All Locations screen: each location with its contents. */
window.Pages = window.Pages || {};

Pages.alllocations = {
  async render(el) {
    el.innerHTML = '<div class="loading">Loading locations…</div>';
    let locations;
    try {
      ({ locations } = await Api.get('/api/locations/overview'));
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="al-search" placeholder="Filter by location code…" />
          <div class="spacer"></div>
          <span class="muted">${locations.length} locations</span>
        </div>
      </div>
      <div id="al-list"></div>`;

    const renderList = (filter) => {
      const list = filter
        ? locations.filter((l) => l.code.toLowerCase().includes(filter.toLowerCase()))
        : locations;
      document.getElementById('al-list').innerHTML = list.map((loc) => `
        <div class="card">
          <div class="toolbar mb-0" style="margin-bottom:10px">
            <strong style="font-size:15px">📍 ${UI.esc(loc.code)}</strong>
            ${loc.warehouse_code ? `<span class="badge">${UI.esc(loc.warehouse_code)}</span>` : ''}
            <span class="badge role">${loc.materials_count} materials</span>
            <span class="badge ${loc.total_quantity > 0 ? 'active' : 'disabled'}">
              ${UI.fmtQty(loc.total_quantity)} total qty
            </span>
            ${loc.registered === false ? '<span class="badge disabled">not in bin master</span>' : ''}
          </div>
          ${loc.materials.length ? `
            <div class="table-wrap"><table>
              <thead><tr><th>Item Code</th><th>Description</th><th>Unit</th><th class="text-right">Quantity</th></tr></thead>
              <tbody>
                ${loc.materials.map((m) => `
                  <tr>
                    <td>${UI.esc(m.item_code)}</td>
                    <td class="wrap">${UI.esc(m.description)}</td>
                    <td>${UI.esc(m.unit)}</td>
                    <td class="text-right">${UI.fmtQty(m.quantity)}</td>
                  </tr>`).join('')}
              </tbody>
            </table></div>`
          : '<p class="muted">This location is empty.</p>'}
        </div>`).join('') || '<div class="card"><p class="muted">No locations match.</p></div>';
    };

    renderList('');
    document.getElementById('al-search').addEventListener('input',
      UI.debounce((e) => renderList(e.target.value.trim()), 200));
  },
};
