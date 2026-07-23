/** All Locations screen: each location with its contents. */
window.Pages = window.Pages || {};

Pages.alllocations = {
  state: { occupancy: 'all' },

  async render(el) {
    el.innerHTML = '<div class="loading">Loading locations…</div>';
    let locations;
    try {
      ({ locations } = await Api.get('/api/locations/overview'));
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }

    const initialOccupancy = ['all', 'occupied', 'empty'].includes(this.state?.occupancy)
      ? this.state.occupancy : 'all';

    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="text" class="search-input" id="al-search" placeholder="Filter by location code…" />
          <select id="al-occupancy" aria-label="Occupancy filter">
            <option value="all">All locations</option>
            <option value="occupied">Occupied only</option>
            <option value="empty">Empty only</option>
          </select>
          <div class="spacer"></div>
          <span class="muted" id="al-count"></span>
          <span id="al-export"></span>
        </div>
      </div>
      <div id="al-list"></div>`;

    const occupancySelect = el.querySelector('#al-occupancy');
    occupancySelect.value = initialOccupancy;

    const filteredRows = () => {
      const text = el.querySelector('#al-search').value.trim().toLowerCase();
      const occupancy = occupancySelect.value;
      return locations.filter((l) => {
        const occupied = Number(l.total_quantity || 0) > 0;
        const occupancyMatch = occupancy === 'all'
          || (occupancy === 'occupied' && occupied)
          || (occupancy === 'empty' && !occupied);
        const textMatch = !text || String(l.code || '').toLowerCase().includes(text)
          || String(l.warehouse_code || '').toLowerCase().includes(text);
        return occupancyMatch && textMatch;
      });
    };

    el.querySelector('#al-export').appendChild(UI.exportControl({
      filename: 'locations', title: 'All Locations',
      rows: () => filteredRows().map((l) => ({
        code: l.code, warehouse_code: l.warehouse_code || '', materials_count: l.materials_count,
        total_quantity: l.total_quantity, materials: l.materials.map((m) => `${m.item_code}:${UI.fmtQty(m.quantity)}`).join(' | '),
      })),
      columns: [
        { key: 'code', label: 'Bin / Location' }, { key: 'warehouse_code', label: 'Warehouse' },
        { key: 'materials_count', label: 'Materials' }, { key: 'total_quantity', label: 'Total Qty' },
        { key: 'materials', label: 'Contents' },
      ],
    }));

    const renderList = () => {
      const list = filteredRows();
      el.querySelector('#al-count').textContent = `${list.length} locations`;
      el.querySelector('#al-list').innerHTML = list.map((loc) => `
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
                  <tr${App.can('batch_tracking') ? ' data-nav="batches" class="row-link"' : ''}>
                    <td>${UI.esc(m.item_code)}</td>
                    <td class="wrap">${UI.esc(m.description)}</td>
                    <td>${UI.esc(m.unit)}</td>
                    <td class="text-right">${UI.fmtQty(m.quantity)}</td>
                  </tr>`).join('')}
              </tbody>
            </table></div>`
          : '<p class="muted">This location is empty.</p>'}
        </div>`).join('') || '<div class="card"><p class="muted">No locations match.</p></div>';

      el.querySelectorAll('[data-nav="batches"]').forEach((row) => {
        row.addEventListener('click', () => { location.hash = '#/batches'; });
      });
    };

    renderList();
    el.querySelector('#al-search').addEventListener('input', UI.debounce(renderList, 200));
    occupancySelect.addEventListener('change', () => {
      this.state = { occupancy: occupancySelect.value };
      renderList();
    });
    this.state = { occupancy: 'all' };
  },
};