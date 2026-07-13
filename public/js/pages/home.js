/**
 * Home launchpad — the landing page after login. A tile for every screen the
 * user can access, grouped by business module (SAP Fiori launchpad style), with
 * colour-coded modules, keyboard accessibility and quick filtering.
 */
window.Pages = window.Pages || {};

// Per-module accent colour (drawn from the validated data-viz palette).
const MODULE_ACCENT = {
  overview: '#2a78d6', requests: '#7c3aed', warehouse: '#1baf7a',
  receiving: '#eda100', inventory: '#0891b2', master: '#5b6b86', admin: '#e34948',
};

Pages.home = {
  render(el) {
    this.el = el;
    this.groups = (App.modules || [])
      .map((m) => ({ m, items: m.items.filter((it) => App.can(it.permission)) }))
      .filter((g) => g.items.length);

    if (!this.groups.length) {
      el.innerHTML = `<div class="card"><p class="muted">${t('Your account has no screens yet. Ask an administrator to grant access.')}</p></div>`;
      return;
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');
    const total = this.groups.reduce((n, g) => n + g.items.length, 0);

    el.innerHTML = `
      <div class="launchpad">
        <div class="lp-hero">
          <div>
            <h1>${greeting}, ${UI.esc(App.user.name)}</h1>
            <p>${t('Pick a process to get started.')} · <span class="muted">${total} ${t('processes available')}</span></p>
          </div>
          <div class="lp-search">
            ${App.icon('search')}
            <input type="text" id="lp-filter" placeholder="${t('Filter processes…')}" autocomplete="off" aria-label="${t('Filter processes')}">
          </div>
        </div>
        <div id="lp-body">${this.groupsHtml(this.groups)}</div>
      </div>`;

    const filter = el.querySelector('#lp-filter');
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      const filtered = this.groups
        .map((g) => ({ m: g.m, items: g.items.filter((it) => !q || t(it.label).toLowerCase().includes(q) || t(g.m.label).toLowerCase().includes(q)) }))
        .filter((g) => g.items.length);
      el.querySelector('#lp-body').innerHTML = filtered.length
        ? this.groupsHtml(filtered)
        : `<p class="muted" style="padding:20px">${t('No matching processes.')}</p>`;
    });
  },

  groupsHtml(groups) {
    return groups.map(({ m, items }) => {
      const accent = MODULE_ACCENT[m.key] || '#2a78d6';
      return `
        <section class="lp-group" style="--accent:${accent}">
          <h2 class="lp-group-title">${App.icon(m.icon)}<span>${UI.esc(t(m.label))}</span></h2>
          <div class="lp-tiles">
            ${items.map((it) => `
              <a class="lp-tile" href="#/${it.route}" aria-label="${UI.esc(t(it.label))}">
                <span class="lp-ico">${App.icon(it.icon)}</span>
                <span class="lp-label">${UI.esc(t(it.label))}</span>
                <span class="lp-go" aria-hidden="true">${App.icon('chevron-right')}</span>
              </a>`).join('')}
          </div>
        </section>`;
    }).join('');
  },
};
