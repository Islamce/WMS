/**
 * Shared UI helpers: toasts, modals, tables with pagination, autocomplete.
 */
const UI = {
  /**
   * Theme-aware chart palette (validated categorical slots + chrome inks for
   * each mode). Charts call this at render time so a theme switch re-colors
   * them on the next render.
   */
  viz() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return dark
      ? { c1: '#3987e5', c2: '#199e70', c3: '#c98500', red: '#e66767', violet: '#9085e9',
          grid: '#26314d', muted: '#8ea0bd', ink: '#c3c2b7' }
      : { c1: '#2a78d6', c2: '#1baf7a', c3: '#eda100', red: '#e34948', violet: '#4a3aa7',
          grid: '#e1e0d9', muted: '#898781', ink: '#52514e' };
  },

  /** Escape a value for safe insertion into HTML. */
  esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  fmtQty(n) {
    const num = Number(n) || 0;
    return num % 1 === 0 ? num.toLocaleString() : num.toLocaleString(undefined, { maximumFractionDigits: 3 });
  },

  fmtDate(s) {
    if (!s) return '';
    // SQLite datetimes are UTC; render in the browser's locale.
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return isNaN(d) ? s : d.toLocaleString();
  },

  toast(message, type = 'success') {
    let zone = document.getElementById('toast-zone');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'toast-zone';
      document.body.appendChild(zone);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    zone.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  /**
   * Show a modal. bodyHtml is the inner content; returns the modal element.
   * onSubmit (optional) is wired to the form with id "modal-form".
   */
  modal({ title, bodyHtml, wide = false, onSubmit, submitLabel = 'Save' }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}">
        <h3>${UI.esc(title)}</h3>
        <form id="modal-form" novalidate>
          <div class="modal-body">${bodyHtml}</div>
          <div class="actions">
            <button type="button" class="btn secondary" data-close>Cancel</button>
            <button type="submit" class="btn">${UI.esc(submitLabel)}</button>
          </div>
        </form>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.hasAttribute('data-close')) close();
    });
    overlay.querySelector('#modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close();
      const btn = overlay.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await onSubmit(overlay, close);
      } finally {
        btn.disabled = false;
      }
    });
    document.body.appendChild(overlay);
    const first = overlay.querySelector('input, select, textarea');
    if (first) first.focus();
    return overlay;
  },

  /** Confirmation dialog; runs onConfirm when accepted. */
  confirm(message, onConfirm) {
    UI.modal({
      title: 'Please confirm',
      bodyHtml: `<p>${UI.esc(message)}</p>`,
      submitLabel: 'Confirm',
      onSubmit: async (_overlay, close) => { close(); await onConfirm(); },
    });
  },

  /** Render pagination controls into a container. */
  pagination(container, { total, page, limit }, onPage) {
    const pages = Math.max(1, Math.ceil(total / limit));
    if (pages <= 1) { container.innerHTML = total ? `<span class="info">${total} records</span>` : ''; return; }
    let html = `<span class="info">${total} records</span>`;
    html += `<button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">&laquo;</button>`;
    const start = Math.max(1, page - 2);
    const end = Math.min(pages, start + 4);
    for (let p = start; p <= end; p++) {
      html += `<button class="${p === page ? 'current' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button ${page >= pages ? 'disabled' : ''} data-page="${page + 1}">&raquo;</button>`;
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach((b) => {
      b.addEventListener('click', () => onPage(Number(b.dataset.page)));
    });
  },

  /**
   * CSV mass-upload modal. Parses a pasted/uploaded CSV (first line = headers)
   * into row objects and hands them to onUpload(rows); shows per-row results.
   */
  csvUploadModal({ title, headersHint, example, onUpload }) {
    UI.modal({
      title, wide: true, submitLabel: 'Upload',
      bodyHtml: `
        <p class="muted" style="margin-bottom:8px">CSV with a header row. Columns: <code>${UI.esc(headersHint)}</code></p>
        <div class="form-group"><label>Choose a .csv file</label><input type="file" id="csv-file" accept=".csv,text/csv"></div>
        <div class="form-group"><label>…or paste CSV content</label>
          <textarea id="csv-text" rows="7" placeholder="${UI.esc(example)}"></textarea></div>
        <div id="csv-result"></div>`,
      onSubmit: async (overlay, close) => {
        let text = overlay.querySelector('#csv-text').value.trim();
        const file = overlay.querySelector('#csv-file').files[0];
        if (!text && file) text = await file.text();
        if (!text) return UI.toast('Provide CSV content or choose a file.', 'error');

        // Minimal CSV parse: handles quoted fields with commas.
        const parseLine = (line) => {
          const out = []; let cur = ''; let inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
            else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
            else cur += ch;
          }
          out.push(cur);
          return out.map((v) => v.trim());
        };
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) return UI.toast('CSV needs a header row plus at least one data row.', 'error');
        const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
        const rows = lines.slice(1).map((l) => {
          const vals = parseLine(l);
          const row = {};
          headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
          return row;
        });

        try {
          const r = await onUpload(rows);
          UI.toast(r.message);
          const bad = (r.results || []).filter((x) => x.status !== 'created');
          overlay.querySelector('#csv-result').innerHTML = `
            <div class="inline-alert ${r.errors ? 'error' : 'success'}">
              Created ${r.created}, skipped ${r.skipped}, errors ${r.errors}.</div>
            ${bad.length ? `<div class="table-wrap" style="max-height:180px;overflow-y:auto"><table>
              <thead><tr><th>Row</th><th>Status</th><th>Message</th></tr></thead>
              <tbody>${bad.slice(0, 50).map((x) => `<tr><td>${x.row}</td><td>${x.status}</td><td>${UI.esc(x.message)}</td></tr>`).join('')}</tbody>
            </table></div>` : ''}`;
          if (!bad.length) setTimeout(close, 1200);
        } catch (err) { UI.toast(err.message, 'error'); }
      },
    });
  },

  /** Debounce helper for search boxes / autocomplete. */
  debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  /**
   * Material picker: a searchable dropdown. Attaches to a text input; opens on
   * focus (showing the first materials) and filters as you type. Calls
   * onSelect(material) — where material includes total_available — when an
   * entry is chosen. Returns { clear } to reset the field.
   */
  materialAutocomplete(input, onSelect) {
    const wrap = input.closest('.autocomplete');
    let list = null;

    const closeList = () => { if (list) { list.remove(); list = null; } };

    const run = async () => {
      // Strip a previously-chosen "code — desc" label so focus re-opens cleanly.
      const raw = input.value.trim();
      const q = raw.includes(' — ') ? '' : raw;
      let materials = [];
      try {
        ({ materials } = await Api.get(`/api/materials/search?q=${encodeURIComponent(q)}`));
      } catch { return; }
      closeList();
      list = document.createElement('div');
      list.className = 'autocomplete-list';
      if (!materials.length) {
        list.innerHTML = '<div class="empty">No materials found</div>';
      } else {
        materials.forEach((m) => {
          const avail = Number(m.total_available || 0);
          const item = document.createElement('div');
          item.className = 'item';
          item.innerHTML = `<div class="code">${UI.esc(m.item_code)}
                              <span class="muted" style="font-weight:400">· available ${UI.fmtQty(avail)} ${UI.esc(m.unit)}</span></div>
                            <div class="desc">${UI.esc(m.description)} — ${UI.esc(m.plant || '')}</div>`;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = `${m.item_code} — ${m.description}`;
            closeList();
            onSelect(m);
          });
          list.appendChild(item);
        });
      }
      wrap.appendChild(list);
    };

    const search = UI.debounce(run, 200);
    input.addEventListener('input', () => { search(); });
    input.addEventListener('focus', () => { run(); });   // open as a dropdown
    input.addEventListener('blur', () => setTimeout(closeList, 180));

    return {
      clear() { input.value = ''; closeList(); },
    };
  },
};
