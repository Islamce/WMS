window.Pages = window.Pages || {};

(function attachMovementHistoryWindow() {
  const originalRender = Pages.importCenter && Pages.importCenter.render;
  if (!originalRender) return;

  Pages.importCenter.render = async function renderWithMovementHistory(el) {
    await originalRender.call(this, el);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Stock Movement History / حركات المخزون</h3>
      <p class="muted" style="margin:6px 0 14px">
        Upload historical receipts, issues/handovers and returns for analytics. This import is additive only,
        does not change current stock balances, and skips duplicate rows automatically.
      </p>
      <div class="form-row">
        <div class="form-group"><label>Movement category</label>
          <select id="mh-type"><option value="RECEIPT">Receipt / استلام</option><option value="ISSUE">Issue or handover / صرف أو تسليم</option><option value="RETURN">Return / إرجاع</option></select>
        </div>
        <div class="form-group"><label>Period start</label><input id="mh-start" type="date"></div>
        <div class="form-group"><label>Period end</label><input id="mh-end" type="date"></div>
      </div>
      <div class="form-group"><label>CSV file</label><input id="mh-file" type="file" accept=".csv,text/csv"></div>
      <div id="mh-preview"></div>
      <button class="btn" id="mh-run" disabled>Import movement history</button>
      <div id="mh-progress" class="muted" style="margin-top:10px"></div>
      <div id="mh-summary" style="margin-top:12px"></div>`;
    el.insertBefore(card, el.firstChild);

    let rows = [];
    let fileName = '';
    const fileInput = card.querySelector('#mh-file');
    const runBtn = card.querySelector('#mh-run');
    const preview = card.querySelector('#mh-preview');
    const progress = card.querySelector('#mh-progress');
    const summary = card.querySelector('#mh-summary');

    async function loadSummary() {
      try {
        const data = await Api.get('/api/import/movements/summary');
        const totals = (data.totals || []).map((r) => `<tr><td>${UI.esc(r.movement_type)}</td><td>${r.rows}</td><td>${Number(r.quantity || 0).toLocaleString()}</td><td>${UI.esc(r.period_start || '')}</td><td>${UI.esc(r.period_end || '')}</td></tr>`).join('');
        summary.innerHTML = totals ? `<h4>Imported movement history</h4><div class="table-wrap"><table><thead><tr><th>Type</th><th>Rows</th><th>Quantity</th><th>From</th><th>To</th></tr></thead><tbody>${totals}</tbody></table></div>` : '';
      } catch (_) { /* permissions or migration not yet available */ }
    }
    loadSummary();

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      rows = []; fileName = '';
      runBtn.disabled = true;
      if (!file) return;
      fileName = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          rows = Pages.importCenter.parseCSV(reader.result);
          const cols = rows.length ? Object.keys(rows[0]) : [];
          const sample = rows.slice(0, 5);
          preview.innerHTML = `<p class="muted">${rows.length.toLocaleString()} rows detected. Preview:</p><div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${UI.esc(c)}</th>`).join('')}</tr></thead><tbody>${sample.map((r) => `<tr>${cols.map((c) => `<td>${UI.esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
          runBtn.disabled = rows.length === 0;
        } catch (err) { preview.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`; }
      };
      reader.readAsText(file);
    });

    runBtn.addEventListener('click', async () => {
      if (!rows.length) return;
      runBtn.disabled = true;
      const movementType = card.querySelector('#mh-type').value;
      const periodStart = card.querySelector('#mh-start').value;
      const periodEnd = card.querySelector('#mh-end').value;
      const chunkSize = 4000;
      let batchId = null, inserted = 0, duplicates = 0, invalid = 0;
      try {
        for (let offset = 0; offset < rows.length; offset += chunkSize) {
          const chunk = rows.slice(offset, offset + chunkSize);
          progress.textContent = `Uploading ${Math.min(offset + chunk.length, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}…`;
          const result = await Api.post('/api/import/movements/chunk', {
            batch_id: batchId,
            movement_type: movementType,
            source_filename: fileName,
            period_start: periodStart || null,
            period_end: periodEnd || null,
            row_offset: offset,
            finalize: offset + chunk.length >= rows.length,
            rows: chunk,
          });
          batchId = result.batch_id;
          inserted += result.inserted || 0;
          duplicates += result.duplicates || 0;
          invalid += result.invalid || 0;
        }
        progress.innerHTML = `<div class="inline-alert ${invalid ? 'warning' : 'success'}">Batch #${batchId}: ${inserted.toLocaleString()} inserted, ${duplicates.toLocaleString()} duplicates skipped, ${invalid.toLocaleString()} invalid.</div>`;
        UI.toast('Movement history import completed.', invalid ? 'warning' : 'success');
        await loadSummary();
      } catch (err) {
        progress.innerHTML = `<div class="inline-alert error">${UI.esc(err.message)}</div>`;
        UI.toast(err.message, 'error');
      } finally { runBtn.disabled = false; }
    });
  };
})();
