/**
 * Spend by project — what was issued to which project, valued at the current
 * material price, over a bounded window. The one report a contracting owner
 * actually opens.
 */
window.Pages = window.Pages || {};

Pages.projectSpend = {
  state: { from: '', to: '', project: '' },

  async render(el) {
    this.el = el;
    const today = new Date().toISOString().slice(0, 10);
    if (!this.state.from) this.state.from = `${today.slice(0, 7)}-01`;
    if (!this.state.to) this.state.to = today;
    let projects = [];
    try { ({ projects } = await Api.get('/api/meta')); } catch { projects = []; }
    this.projects = projects || [];

    el.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <label class="muted sm" for="ps-from">From</label><input type="date" id="ps-from" value="${this.state.from}" style="max-width:160px" />
          <label class="muted sm" for="ps-to">To</label><input type="date" id="ps-to" value="${this.state.to}" style="max-width:160px" />
          <select id="ps-project" style="max-width:240px" aria-label="Project">
            <option value="">All projects</option>
            ${this.projects.map((prj) => `<option value="${UI.esc(prj.code)}" ${prj.code === this.state.project ? 'selected' : ''}>${UI.esc(prj.code)} — ${UI.esc(prj.label)}</option>`).join('')}
          </select>
          <button class="btn sm" id="ps-run">Run</button>
          <span class="muted" id="ps-count" aria-live="polite"></span>
          <div class="spacer"></div>
          <span id="ps-export"></span>
        </div>
        <p class="muted sm" id="ps-basis" style="margin:8px 0 0"></p>
        <div class="table-wrap" id="ps-table"><div class="loading">Loading…</div></div>
      </div>
      ${App.can('users_management') ? `
      <div class="card">
        <h3>Project register</h3>
        <p class="muted">Requests choose a project from this list, so the report never splits one project across two spellings. Retired projects stay on old requests.</p>
        <div class="toolbar">
          <input id="pr-code" placeholder="Code, e.g. PRJ-002" style="max-width:180px" aria-label="Project code" />
          <input id="pr-label" placeholder="Name, e.g. Nasr City tower" style="max-width:320px" aria-label="Project name" />
          <button class="btn sm" id="pr-add">Add project</button>
        </div>
        <div class="table-wrap" id="pr-table"></div>
      </div>` : ''}`;

    const run = () => {
      this.state.from = el.querySelector('#ps-from').value;
      this.state.to = el.querySelector('#ps-to').value;
      this.state.project = el.querySelector('#ps-project').value;
      this.load();
    };
    el.querySelector('#ps-run').addEventListener('click', run);
    el.querySelector('#ps-project').addEventListener('change', run);
    if (App.can('users_management')) {
      el.querySelector('#pr-add').addEventListener('click', () => this.addProject());
      this.loadRegister();
    }
    await this.load();
  },

  async load() {
    const { from, to, project } = this.state;
    const table = this.el.querySelector('#ps-table');
    let data;
    try {
      data = await Api.get(`/api/reports/project-spend?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${project ? `&project=${encodeURIComponent(project)}` : ''}`);
    } catch (err) { table.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    this.rows = data.rows || [];
    const cov = data.coverage || {};
    const basis = [];
    if (cov.total_issues > cov.attributable_issues) {
      basis.push(`${UI.fmtQty(cov.attributable_issues)} of ${UI.fmtQty(cov.total_issues)} issues in this window carry a request line and are counted; the rest predate request-level attribution and are not.`);
    }
    if (cov.unpriced_materials > 0) basis.push(`${UI.fmtQty(cov.unpriced_materials)} material(s) here have no price, so their spend shows as 0.`);
    basis.push(data.price_basis || '');
    this.el.querySelector('#ps-basis').textContent = basis.join(' ');
    this.el.querySelector('#ps-count').textContent = `${this.rows.length} row${this.rows.length === 1 ? '' : 's'}`;

    const detail = Boolean(project);
    const columns = detail
      ? [{ key: 'item_code', label: 'Item' }, { key: 'description', label: 'Description' }, { key: 'quantity', label: 'Issued qty' },
        { key: 'unit', label: 'Unit' }, { key: 'price', label: 'Price' }, { key: 'spend', label: 'Spend' }]
      : [{ key: 'project', label: 'Project' }, { key: 'movements', label: 'Issues' }, { key: 'quantity', label: 'Issued qty' }, { key: 'spend', label: 'Spend' }];
    const exp = this.el.querySelector('#ps-export');
    exp.innerHTML = '';
    exp.appendChild(UI.exportControl({ filename: `spend-by-project-${from}-${to}`, title: `Spend by project ${from} → ${to}`, columns, rows: () => this.rows }));

    table.innerHTML = this.rows.length ? `
      <table><thead><tr>${columns.map((c) => `<th${/qty|Spend|Price|Issues/.test(c.label) ? ' class="text-right"' : ''}>${UI.esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${this.rows.map((r) => `<tr${detail ? '' : ` class="row-link" data-project="${UI.esc(r.project)}" role="button" tabindex="0"`}>
        ${columns.map((c) => `<td${/qty|Spend|Price|Issues/.test(c.label) ? ' class="text-right"' : ''}>${c.key === 'spend' || c.key === 'price' ? UI.fmtQty(r[c.key] || 0) : c.key === 'quantity' || c.key === 'movements' ? UI.fmtQty(r[c.key] || 0) : UI.esc(r[c.key] == null ? '' : String(r[c.key]))}</td>`).join('')}
      </tr>`).join('')}</tbody></table>`
      : UI.meaningfulEmptyState({
        title: 'No issues in this window',
        description: 'Spend appears here once material is issued against an approved request. Widen the dates, or check the project filter.',
      });
    if (!detail) {
      UI.makeRowsActionable(table.querySelectorAll('tr[data-project]'), (tr) => {
        const code = tr.dataset.project;
        if (code === '(no project)') return;
        this.state.project = code;
        this.el.querySelector('#ps-project').value = code;
        this.load();
      });
    }
  },

  async loadRegister() {
    const box = this.el.querySelector('#pr-table');
    if (!box) return;
    let items = [];
    try { ({ items } = await Api.get('/api/master/reference/PROJECT')); } catch (err) { box.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; return; }
    box.innerHTML = items.length ? `<table><thead><tr><th>Code</th><th>Name</th><th>Status</th><th></th></tr></thead>
      <tbody>${items.map((prj) => `<tr><td><span class="chip">${UI.esc(prj.code)}</span></td><td>${UI.esc(prj.label)}</td>
        <td><span class="badge ${prj.is_active ? 'active' : 'disabled'}">${prj.is_active ? 'active' : 'retired'}</span></td>
        <td><button class="btn secondary sm" data-toggle="${prj.id}" data-active="${prj.is_active ? 0 : 1}">${prj.is_active ? 'Retire' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table>`
      : UI.meaningfulEmptyState({ title: 'No projects yet', description: 'Add the first one above. Requests will then require a project.' });
    box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await Api.patch(`/api/master/reference/${b.dataset.toggle}/active`, { is_active: Number(b.dataset.active) === 1 });
        UI.toast(r.message); this.loadRegister(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  },

  async addProject() {
    const code = this.el.querySelector('#pr-code').value.trim();
    const label = this.el.querySelector('#pr-label').value.trim();
    if (!code || !label) return UI.toast('Code and name are both required.', 'error');
    try {
      const r = await Api.post('/api/master/reference', { category: 'PROJECT', code, label });
      UI.toast(r.message);
      this.el.querySelector('#pr-code').value = ''; this.el.querySelector('#pr-label').value = '';
      this.loadRegister();
      ({ projects: this.projects } = await Api.get('/api/meta'));
      const sel = this.el.querySelector('#ps-project');
      sel.innerHTML = `<option value="">All projects</option>${this.projects.map((prj) => `<option value="${UI.esc(prj.code)}">${UI.esc(prj.code)} — ${UI.esc(prj.label)}</option>`).join('')}`;
    } catch (err) { UI.toast(err.message, 'error'); }
  },
};
