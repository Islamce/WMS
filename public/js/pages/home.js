/**
 * Home launchpad — the landing page after login. Shows a tile for every screen
 * the user can access, grouped by business module (SAP Fiori launchpad style).
 * Uses the same permission-filtered model (App.modules) and icon set (App.icon)
 * as the sidebar.
 */
window.Pages = window.Pages || {};

Pages.home = {
  render(el) {
    const groups = (App.modules || [])
      .map((m) => ({ m, items: m.items.filter((it) => App.can(it.permission)) }))
      .filter((g) => g.items.length);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');

    if (!groups.length) {
      el.innerHTML = `<div class="card"><p class="muted">${t('Your account has no screens yet. Ask an administrator to grant access.')}</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="launchpad">
        <div class="lp-hero">
          <h1>${greeting}, ${UI.esc(App.user.name)}</h1>
          <p>${t('Pick a process to get started.')}</p>
        </div>
        ${groups.map(({ m, items }) => `
          <section class="lp-group">
            <h2 class="lp-group-title">${App.icon(m.icon)}<span>${UI.esc(t(m.label))}</span></h2>
            <div class="lp-tiles">
              ${items.map((it) => `
                <a class="lp-tile" href="#/${it.route}">
                  <span class="lp-ico">${App.icon(it.icon)}</span>
                  <span class="lp-label">${UI.esc(t(it.label))}</span>
                </a>`).join('')}
            </div>
          </section>`).join('')}
      </div>`;
  },
};
