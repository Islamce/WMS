/**
 * Import Center — mass-upload master data / opening stock from CSV.
 * Pick an entity, download its template, upload a filled CSV; the file is
 * parsed in the browser and posted as JSON rows to /api/import/:entity.
 */
window.Pages = window.Pages || {};

const IMPORT_LABELS = {
  materials: 'Materials',
  locations: 'Locations (legacy)',
  warehouses: 'Warehouses',
  bins: 'Bin Locations',
  'movement-types': 'Movement Types',
  stock: 'Opening Stock (balances)',
};

Pages.importCenter = {
  entities: [],

  async render(el) {
    this.el = el;
    el.innerHTML = '<div class="loading">Loading…</div>';
    try {
      ({ entities: this.entities } = await Api.get('/api/import/meta'));
    } catch (err) {
      el.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
      return;
    }
    if (!this.entities.length) {
      el.innerHTML = '<div class="card"><p class="muted">You have no data types you can import.</p></div>';
      return;
    }

    el.innerHTML = `
      <div class="card">
        <h3>Import data from CSV</h3>
        <p class="muted" style="margin:6px 0 16px">
          Import data additively. Existing production records must not be deleted by deployments or upgrades.
          For a new production setup, import in this order: <strong>Warehouses → Bin Locations → Materials → Opening Stock</strong>.
        </p>
        <div class="form-row">
          <div class="form-group">
            <label>Data type</label>
            <select id="imp-entity">
              ${this.entities.map((e) => `<option value="${e.key}">${UI.esc(IMPORT_LABELS[e.key] || e.key)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <button class="btn secondary" id="imp-template">⬇ Download template</button>
          </div>
        </div>
        <div id="imp-cols" class="muted" style="font-size:12px;margin-bottom:14px"></div>
        <div class="form-group">
          <label>CSV file</label>
          <input type="file" id="imp-file" accept=".csv,text/csv">
        </div>
        <div id="imp-preview"></div>
        <button class="btn" id="imp-run" disabled>Import</button>
      </div>
      <div id="imp-result"></div>
      ${App.user && App.user.role === 'admin' ? `
      <div class="card" style="border-color:var(--warning)">
        <h3>One-time production initialization</h3>
        <p class="muted" style="margin:6px 0 12px">
          Controlled transition from demo/UAT data to real operational data. The operation requires a verified backup,
          displays the affected row counts before execution, and permanently locks itself after completion.
          <strong>Do not run this after real data entry begins.</strong>
        </p>
        <button class="btn danger" id="imp-initialize">Prepare production initialization…</button>
      </div>` : ''}`;

    this.rows = [];
    const entitySel = el.querySelector('#imp-entity');
    const showCols = () => {
      const def = this.entities.find((e) => e.key === entitySel.value);
      el.querySelector('#imp-cols').textContent = def ? `Columns: ${def.columns.join(', ')}` : '';
    };
    showCols();
    entitySel.addEventListener('change', () => { showCols(); this.resetFile(); });
    el.querySelector('#imp-template').addEventListener('click', () => this.downloadTemplate(entitySel.value));
    el.querySelector('#imp-file').addEventListener('change', (e) => this.onFile(e.target.files[0]));
    el.querySelector('#imp-run').addEventListener('click', () => this.runImport(entitySel.value));
    const initializeBtn = el.querySelector('#imp-initialize');
    if (initializeBtn) initializeBtn.addEventListener('click', () => this.confirmProductionInitialization());
  },

  async confirmProductionInitialization() {
    let status;
    try {
      status = await Api.get('/api/admin/production-initialization?keep_master_data=false');
    } catch (err) {
      UI.toast(err.message, 'error');
      return;
    }

    if (status.locked) {
      UI.modal({
        title: 'Production initialization is locked',
        submitLabel: 'Close',
        bodyHtml: `<div class="inline-alert success">
          Initialization was completed on ${UI.esc(status.lock?.completed_at || 'an earlier date')}.
          Production data is protected from another reset.
        </div>`,
        onSubmit: async (_overlay, close) => close(),
      });
      return;
    }

    const rows = Object.entries(status.counts || {})
      .filter(([, count]) => count > 0)
      .map(([table, count]) => `<tr><td>${UI.esc(table)}</td><td>${count}</td></tr>`)
      .join('');

    UI.modal({
      title: 'Initialize production data once?',
      submitLabel: 'Initialize and permanently lock',
      bodyHtml: `
        <div class="inline-alert warning">
          ${status.enabled
    ? 'The controlled initialization window is enabled.'
    : 'Initialization is disabled on the server. An administrator must temporarily set PRODUCTION_INITIALIZATION_ENABLED=true.'}
        </div>
        <p>This will clear <strong>${status.total || 0}</strong> demo/UAT rows. Users, roles, permissions and configuration are kept.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Table</th><th>Rows to clear</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="2">No current demo/UAT rows detected.</td></tr>'}</tbody>
        </table></div>
        <label class="perm-item" style="margin-top:12px">
          <input type="checkbox" id="pi-backup-confirmed">
          <span>I confirm a verified backup exists and can be restored.</span>
        </label>
        <div class="form-group" style="margin-top:10px">
          <label for="pi-backup-reference">Backup reference / run ID</label>
          <input type="text" id="pi-backup-reference" autocomplete="off" placeholder="Example: offsite run 30000000000">
        </div>
        <div class="form-group">
          <label for="pi-confirm">Type <strong>RESET PRODUCTION DATA</strong></label>
          <input type="text" id="pi-confirm" autocomplete="off">
        </div>`,
      onSubmit: async (overlay, close) => {
        try {
          const result = await Api.post('/api/admin/production-initialization', {
            confirm: overlay.querySelector('#pi-confirm').value.trim(),
            backup_confirmed: overlay.querySelector('#pi-backup-confirmed').checked,
            backup_reference: overlay.querySelector('#pi-backup-reference').value.trim(),
            keep_master_data: false,
          });
          UI.toast(result.message, 'success');
          close();
          this.render(this.el);
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  resetFile() {
    this.rows = [];
    this.el.querySelector('#imp-file').value = '';
    this.el.querySelector('#imp-preview').innerHTML = '';
    this.el.querySelector('#imp-run').disabled = true;
    this.el.querySelector('#imp-result').innerHTML = '';
  },

  columnsFor(key) { return (this.entities.find((e) => e.key === key) || { columns: [] }).columns; },

  downloadTemplate(key) {
    const cols = this.columnsFor(key);
    const csv = cols.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wms-${key}-template.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  onFile(file) {
    if (!file) return this.resetFile();
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.rows = this.parseCSV(reader.result);
      } catch (err) {
        this.el.querySelector('#imp-preview').innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
        return;
      }
      const preview = this.rows.slice(0, 5);
      const cols = this.rows.length ? Object.keys(this.rows[0]) : [];
      this.el.querySelector('#imp-preview').innerHTML = `
        <p class="muted" style="margin:8px 0">${this.rows.length} row(s) detected. Preview:</p>
        <div class="table-wrap"><table>
          <thead><tr>${cols.map((c) => `<th>${UI.esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${preview.map((r) => `<tr>${cols.map((c) => `<td>${UI.esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
      this.el.querySelector('#imp-run').disabled = this.rows.length === 0;
    };
    reader.readAsText(file);
  },

  /** Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines). */
  parseCSV(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    text = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
    if (nonEmpty.length < 2) throw new Error('CSV needs a header row and at least one data row.');
    const headers = nonEmpty[0].map((h) => h.trim());
    return nonEmpty.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
  },

  async runImport(key) {
    const btn = this.el.querySelector('#imp-run');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const res = await Api.post(`/api/import/${key}`, { rows: this.rows });
      const errs = (res.results || []).filter((r) => r.status === 'error');
      this.el.querySelector('#imp-result').innerHTML = `
        <div class="card">
          <div class="inline-alert ${res.errors ? 'warning' : 'success'}">${UI.esc(res.message)}</div>
          ${errs.length ? `
            <h4 style="margin:12px 0 6px">Rows with errors</h4>
            <div class="table-wrap"><table>
              <thead><tr><th>Row</th><th>Error</th></tr></thead>
              <tbody>${errs.slice(0, 100).map((r) => `<tr><td>${r.row}</td><td>${UI.esc(r.message)}</td></tr>`).join('')}</tbody>
            </table></div>` : ''}
        </div>`;
      UI.toast(res.message, res.errors ? 'error' : 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Import';
    }
  },
};