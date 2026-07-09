/** Empty Locations screen: locations with no stock (or all zero). */
window.Pages = window.Pages || {};

Pages.emptylocations = {
  async render(el) {
    el.innerHTML = '<div class="loading">Loading empty locations…</div>';
    let locations;
    try {
      ({ locations } = await Api.get('/api/locations/empty'));
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
        <h3>Empty Locations <span class="badge pending">${locations.length}</span></h3>
        <p class="muted" style="margin-bottom:12px">
          Locations with no stock records or where every material quantity is zero.
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Location Code</th></tr></thead>
            <tbody>
              ${locations.map((l) => `
                <tr><td>${l.id}</td><td><strong>${UI.esc(l.code)}</strong></td></tr>`).join('')
                || '<tr><td colspan="2" class="muted">No empty locations — the warehouse is fully occupied.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  },
};
