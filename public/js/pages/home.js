/**
 * Home launchpad — role-focused process discovery with a current-user
 * notification preview. It does not aggregate or infer action queues; D05 is
 * intentionally deferred until a server-authorized attention contract exists.
 */
window.Pages = window.Pages || {};

const MODULE_ACCENT = {
  overview: '#2a78d6', requests: '#7c3aed', warehouse: '#1baf7a',
  receiving: '#eda100', inventory: '#0891b2', master: '#5b6b86', admin: '#e34948',
};

// Presentation profiles only: App.can() remains the authority for access and
// the full set of permitted destinations remains available through Show all.
const HOME_ROLE_PROFILE = {
  picker: { label: 'Picker', modules: ['warehouse', 'receiving', 'inventory'] },
  erp_operator: { label: 'ERP Operator', modules: ['requests', 'overview', 'master'] },
  warehouse_supervisor: { label: 'Warehouse Manager', modules: ['warehouse', 'inventory', 'receiving', 'outbound', 'overview'] },
  admin: { label: 'Admin / System', modules: null },
};

Pages.home = {
  async render(el) {
    this.el = el;
    this.allGroups = (App.modules || [])
      .map((m) => ({ m, items: m.items.filter((it) => App.can(it.permission)) }))
      .filter((g) => g.items.length);

    if (!this.allGroups.length) {
      el.innerHTML = `<div class="card"><p class="muted">${t('Your account has no screens yet. Ask an administrator to grant access.')}</p></div>`;
      return;
    }

    this.profile = HOME_ROLE_PROFILE[App.user.role] || { label: 'Your role', modules: null };
    this.focusGroups = this.profile.modules
      ? this.allGroups.filter((group) => this.profile.modules.includes(group.m.key))
      : this.allGroups;
    if (!this.focusGroups.length) this.focusGroups = this.allGroups;
    this.showAll = !this.profile.modules || this.focusGroups.length === this.allGroups.length;
    this.notifications = [];

    if (App.can('notifications')) {
      try {
        const { notifications = [] } = await Api.get('/api/notifications');
        this.notifications = notifications.slice(0, 3);
      } catch { /* Home remains useful when the optional preview fails. */ }
    }
    this.renderLaunchpad();
  },

  visibleGroups() { return this.showAll ? this.allGroups : this.focusGroups; },

  renderLaunchpad() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');
    const total = this.allGroups.reduce((n, group) => n + group.items.length, 0);
    const focusedCount = this.focusGroups.reduce((n, group) => n + group.items.length, 0);
    const hasFocusedView = !this.showAll && focusedCount < total;

    this.el.innerHTML = `
      <div class="launchpad">
        <div class="lp-hero">
          <div>
            <h1>${greeting}, ${UI.esc(App.user.name)}</h1>
            <p>${t('Your role-focused processes are ready.')} · <span class="muted">${total} ${t('processes available')}</span></p>
          </div>
          <div class="lp-search">
            ${App.icon('search')}
            <input type="text" id="lp-filter" placeholder="${t('Filter processes…')}" autocomplete="off" aria-label="${t('Filter processes')}">
          </div>
        </div>
        ${this.alertPreviewHtml()}
        <div class="lp-process-head">
          <div><h2>${hasFocusedView ? `${UI.esc(this.profile.label)} processes` : t('All permitted processes')}</h2>
            <p class="muted">${hasFocusedView ? 'A focused view of your permitted work. Use Show all to browse the full catalog.' : 'Every destination shown is available under your current permissions.'}</p></div>
          ${this.profile.modules && focusedCount < total ? `<button class="btn secondary sm" id="lp-show-all" aria-pressed="${this.showAll}">${this.showAll ? 'Show role-focused processes' : 'Show all processes'}</button>` : ''}
        </div>
        <div id="lp-body">${this.groupsHtml(this.visibleGroups())}</div>
      </div>`;

    const filter = this.el.querySelector('#lp-filter');
    filter.addEventListener('input', () => this.applyFilter(filter.value));
    this.el.querySelector('#lp-show-all')?.addEventListener('click', () => {
      this.showAll = !this.showAll;
      this.renderLaunchpad();
    });
  },

  alertPreviewHtml() {
    const content = this.notifications.length
      ? `<div class="lp-alert-list">${this.notifications.map((notice) => `
          <a class="lp-alert" href="#/notifications">
            <span class="lp-alert-dot ${notice.status === 'SENT' ? 'unread' : ''}" aria-hidden="true"></span>
            <span><strong>${UI.esc(notice.notification_title || notice.notification_type || 'Notification')}</strong>
              <span class="lp-alert-message">${UI.esc(notice.notification_message || 'View notification details.')}</span></span>
          </a>`).join('')}</div>`
      : UI.meaningfulEmptyState({
        title: 'No recent alerts',
        description: 'You have no current notifications. New workflow alerts will appear here when they are sent to you.',
      });
    return `<section class="lp-attention" aria-labelledby="lp-attention-title">
      <div class="lp-attention-head"><div><span class="lp-eyebrow">${t('Attention')}</span><h2 id="lp-attention-title">Recent alerts</h2></div>
        ${App.can('notifications') ? '<a class="btn secondary sm" href="#/notifications">View all notifications</a>' : ''}</div>
      <p class="muted">Your latest workflow notifications. This preview does not replace the full notification center.</p>
      ${content}
    </section>`;
  },

  applyFilter(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    const filtered = this.visibleGroups()
      .map((group) => ({
        m: group.m,
        items: group.items.filter((item) => !query || t(item.label).toLowerCase().includes(query) || t(group.m.label).toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length);
    this.el.querySelector('#lp-body').innerHTML = filtered.length
      ? this.groupsHtml(filtered)
      : UI.meaningfulEmptyState({
        title: 'No matching processes',
        description: 'Try a different search term or clear the filter to see the processes available to your role.',
      });
  },

  groupsHtml(groups) {
    return groups.map(({ m, items }) => {
      const accent = MODULE_ACCENT[m.key] || '#2a78d6';
      return `
        <section class="lp-group" style="--accent:${accent}">
          <h2 class="lp-group-title">${App.icon(m.icon)}<span>${UI.esc(t(m.label))}</span></h2>
          <div class="lp-tiles">
            ${items.map((item) => `
              <a class="lp-tile" href="#/${item.route}" aria-label="${UI.esc(t(item.label))}">
                <span class="lp-ico">${App.icon(item.icon)}</span>
                <span class="lp-label">${UI.esc(t(item.label))}</span>
                <span class="lp-go" aria-hidden="true">${App.icon('chevron-right')}</span>
              </a>`).join('')}
          </div>
        </section>`;
    }).join('');
  },
};
