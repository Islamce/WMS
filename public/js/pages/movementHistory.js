window.Pages = window.Pages || {};

(function attachMovementHistoryWindow() {
  const originalRender = Pages.importCenter && Pages.importCenter.render;
  if (!originalRender) return;

  Pages.importCenter.render = async function renderWithMovementHistory(el) {
    await originalRender.call(this, el);
    const categories = ['RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL'];
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Analytical Movement History</h3>
      <div class="inline-alert warning"><strong>Analytics only.</strong> This append-only import never changes batches, available stock, reservations, or the operational stock ledger.</div>
      <div class="form-row">
        <div class="form-group"><label>Movement category</label><select id="mh-type">${categories.map((category) => `<option>${category}</option>`).join('')}</select></div>
        <div class="form-group"><label>Reversal of</label><select id="mh-reversal" disabled><option value="">Select original category</option>${categories.filter((category) => category !== 'REVERSAL').map((category) => `<option>${category}</option>`).join('')}</select></div>
        <div class="form-group"><label>Source system</label><input id="mh-source" value="SAP_CSV"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Declared coverage start</label><input id="mh-start" type="date"></div>
        <div class="form-group"><label>Declared coverage end</label><input id="mh-end" type="date"></div>
        <div class="form-group"><label>CSV file</label><input id="mh-file" type="file" accept=".csv,text/csv"></div>
      </div>
      <details><summary>Optional field mapping</summary>
        <p class="muted">JSON maps canonical fields to CSV column names, for example <code>{"material_code":"Material","posting_date":"Posting Date"}</code>.</p>
        <textarea id="mh-mapping" rows="3" placeholder='{"material_code":"Material","quantity":"Qty"}'></textarea>
      </details>
      <div id="mh-preview"></div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn secondary" id="mh-dry" disabled>Validate / dry run</button><button class="btn" id="mh-run" disabled>Import movement history</button></div>
      <div id="mh-progress" class="muted" style="margin-top:10px"></div>
      <div id="mh-summary" style="margin-top:12px"></div>`;
    el.insertBefore(card, el.firstChild);

    let rows = []; let fileName = ''; let checksum = '';
    const $ = (selector) => card.querySelector(selector);
    const fileInput = $('#mh-file'); const dryBtn = $('#mh-dry'); const runBtn = $('#mh-run');
    const preview = $('#mh-preview'); const progress = $('#mh-progress'); const summary = $('#mh-summary');
    $('#mh-type').addEventListener('change', () => { $('#mh-reversal').disabled = $('#mh-type').value !== 'REVERSAL'; });

    function mapping() {
      const raw = $('#mh-mapping').value.trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Field mapping must be a JSON object.');
      return parsed;
    }
    function payload(extra = {}) {
      return { movement_category: $('#mh-type').value, reversal_of_category: $('#mh-reversal').value || null,
        source_system: $('#mh-source').value.trim() || 'CSV', source_filename: fileName, source_file_checksum: checksum,
        field_mapping: mapping(), period_start: $('#mh-start').value || null, period_end: $('#mh-end').value || null,
        rows, ...extra };
    }
    function reconciliationHtml(rec) {
      return `<div class="inline-alert ${rec.invalid_rows ? 'warning' : 'success'}">
        <strong>${rec.insertable_rows} insertable</strong> · ${rec.duplicate_rows} duplicates · ${rec.invalid_rows} invalid · quantity ${UI.fmtQty(rec.total_quantity)}<br>
        <span class="muted">Actual period ${UI.esc(rec.period_start || '—')} to ${UI.esc(rec.period_end || '—')} · matched materials ${rec.matched_materials.length} · unmatched ${rec.unmatched_materials.length} · live stock changed: ${rec.live_stock_changed ? 'YES' : 'no'}</span>
      </div>`;
    }
    async function loadSummary() {
      try {
        const data = await Api.get('/api/import/movements/summary');
        const totals = (data.totals || []).map((row) => `<tr><td>${UI.esc(row.movement_category)}</td><td>${row.rows}</td><td>${UI.fmtQty(row.quantity)}</td><td>${UI.esc(row.period_start || '')}</td><td>${UI.esc(row.period_end || '')}</td></tr>`).join('');
        const batches = (data.batches || []).filter((batch) => batch.invalid_rows > 0).slice(0, 5).map((batch) => `<button class="btn secondary mh-errors" data-batch="${batch.id}">Batch #${batch.id} rejected rows (${batch.invalid_rows})</button>`).join(' ');
        summary.innerHTML = totals ? `<h4>Imported analytical history</h4><div class="table-wrap"><table><thead><tr><th>Category</th><th>Rows</th><th>Quantity</th><th>From</th><th>To</th></tr></thead><tbody>${totals}</tbody></table></div>${batches ? `<p>${batches}</p>` : ''}` : '';
        summary.querySelectorAll('.mh-errors').forEach((button) => button.addEventListener('click', async () => {
          try {
            const rejected = await Api.get(`/api/import/movements/batches/${button.dataset.batch}/errors`);
            const lines = ['row,external_id,error_code,error_message,raw_row_json'];
            const csv = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
            rejected.errors.forEach((row) => lines.push([row.source_row_number, row.external_id, row.error_code, row.error_message, row.raw_row_json].map(csv).join(',')));
            UI._download(new Blob([lines.join('\n')], { type: 'text/csv' }), `movement-import-${button.dataset.batch}-errors.csv`);
          } catch (error) { UI.toast(error.message, 'error'); }
        }));
      } catch (_) { /* Permission or migration not available. */ }
    }
    loadSummary();

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0]; rows = []; fileName = ''; checksum = ''; dryBtn.disabled = true; runBtn.disabled = true;
      if (!file) return;
      fileName = file.name;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          rows = Pages.importCenter.parseCSV(reader.result);
          checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reader.result)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
          const columns = rows.length ? Object.keys(rows[0]) : [];
          preview.innerHTML = `<p class="muted">${rows.length.toLocaleString()} rows detected · SHA-256 ${checksum.slice(0, 16)}…</p><div class="table-wrap"><table><thead><tr>${columns.map((column) => `<th>${UI.esc(column)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 5).map((row) => `<tr>${columns.map((column) => `<td>${UI.esc(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
          dryBtn.disabled = rows.length === 0; runBtn.disabled = rows.length === 0;
        } catch (error) { preview.innerHTML = `<div class="inline-alert error">${UI.esc(error.message)}</div>`; }
      };
      reader.readAsText(file);
    });

    dryBtn.addEventListener('click', async () => {
      try {
        dryBtn.disabled = true;
        const previewRows = rows.slice(0, 5000);
        const result = await Api.post('/api/import/movements/preview', payload({ rows: previewRows }));
        progress.innerHTML = `${rows.length > previewRows.length ? '<div class="inline-alert warning">Dry run covers the first 5,000 rows; import validation still isolates errors in every chunk.</div>' : ''}${reconciliationHtml(result.reconciliation)}`;
        if (result.invalid_rows.length) progress.innerHTML += `<details><summary>Rejected-row preview</summary><pre>${UI.esc(JSON.stringify(result.invalid_rows, null, 2))}</pre></details>`;
      } catch (error) { progress.innerHTML = `<div class="inline-alert error">${UI.esc(error.message)}</div>`; }
      finally { dryBtn.disabled = false; }
    });

    runBtn.addEventListener('click', async () => {
      if (!rows.length) return;
      runBtn.disabled = true;
      const chunkSize = 4000; let batchId = null; let inserted = 0; let duplicates = 0; let invalid = 0;
      try {
        for (let offset = 0; offset < rows.length; offset += chunkSize) {
          const chunk = rows.slice(offset, offset + chunkSize);
          progress.textContent = `Importing ${Math.min(offset + chunk.length, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}…`;
          const result = await Api.post('/api/import/movements/chunk', payload({ batch_id: batchId, row_offset: offset,
            finalize: offset + chunk.length >= rows.length, rows: chunk }));
          batchId = result.batch_id; inserted += result.inserted || 0; duplicates += result.duplicates || 0; invalid += result.invalid || 0;
        }
        progress.innerHTML = `<div class="inline-alert ${invalid ? 'warning' : 'success'}">Batch #${batchId}: ${inserted} inserted, ${duplicates} duplicates, ${invalid} invalid. Live stock was not changed. Rejected rows are available in the batch summary below.</div>`;
        await loadSummary();
      } catch (error) { progress.innerHTML = `<div class="inline-alert error">${UI.esc(error.message)}</div>`; }
      finally { runBtn.disabled = false; }
    });
  };
})();
