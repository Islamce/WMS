/**
 * Shared UI helpers: toasts, modals, tables with pagination, autocomplete.
 */
const UI = {
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
