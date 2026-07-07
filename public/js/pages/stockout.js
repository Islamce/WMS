/**
 * Stock Out screen: material autocomplete -> material details -> location
 * dropdown limited to locations that hold this material (> 0) -> quantity
 * (validated against available stock) + required reservation number.
 */
window.Pages = window.Pages || {};

Pages.stockout = {
  selectedMaterial: null,
  summary: null,

  async render(el) {
    this.selectedMaterial = null;
    this.summary = null;

    el.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3>Stock Out</h3>
        <form id="so-form" novalidate>
          <div class="form-group autocomplete">
            <label>Material *</label>
            <input type="text" id="so-material" placeholder="Type item code or description…" autocomplete="off" />
            <div class="hint">Search and pick a material from the list.</div>
          </div>

          <div class="card mb-0" id="so-details" style="display:none">
            <div class="details-list">
              <div class="item"><div class="k">Plant</div><div class="v" id="so-d-plant">—</div></div>
              <div class="item"><div class="k">Item Code</div><div class="v" id="so-d-code">—</div></div>
              <div class="item"><div class="k">Unit</div><div class="v" id="so-d-unit">—</div></div>
              <div class="item"><div class="k">Total Available</div><div class="v" id="so-d-total">—</div></div>
            </div>
            <p class="muted" style="margin-top:10px" id="so-d-desc"></p>
          </div>

          <div class="form-row" style="margin-top:14px">
            <div class="form-group">
              <label>Location *</label>
              <select id="so-location" disabled><option value="">Select material first</option></select>
              <div class="hint">Only locations that contain this material.</div>
            </div>
            <div class="form-group">
              <label>Available in selected location</label>
              <input type="text" id="so-loc-stock" readonly value="—" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Quantity out *</label>
              <input type="number" id="so-qty" min="0" step="any" placeholder="0" />
            </div>
            <div class="form-group">
              <label>Reservation number *</label>
              <input type="text" id="so-reservation" required />
            </div>
          </div>
          <div class="form-group">
            <label>Notes <span class="muted">(optional)</span></label>
            <textarea id="so-notes" rows="2"></textarea>
          </div>
          <button type="submit" class="btn danger block" id="so-submit" disabled>📤 Submit Stock Out</button>
        </form>
      </div>`;

    const materialInput = el.querySelector('#so-material');
    const locationSelect = el.querySelector('#so-location');
    const submitBtn = el.querySelector('#so-submit');

    UI.materialAutocomplete(materialInput, async (material) => {
      this.selectedMaterial = material;
      await this.loadSummary(el);
      submitBtn.disabled = false;
    });

    materialInput.addEventListener('input', () => {
      this.selectedMaterial = null;
      this.summary = null;
      el.querySelector('#so-details').style.display = 'none';
      el.querySelector('#so-loc-stock').value = '—';
      locationSelect.innerHTML = '<option value="">Select material first</option>';
      locationSelect.disabled = true;
      submitBtn.disabled = true;
    });

    locationSelect.addEventListener('change', () => {
      const locId = Number(locationSelect.value);
      const row = this.summary?.locations.find((l) => l.location_id === locId);
      el.querySelector('#so-loc-stock').value = locationSelect.value ? UI.fmtQty(row ? row.quantity : 0) : '—';
    });

    el.querySelector('#so-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.selectedMaterial) return UI.toast('Please select a material from the list.', 'error');
      const locationId = Number(locationSelect.value);
      if (!locationId) return UI.toast('Please select a location.', 'error');
      const qty = Number(el.querySelector('#so-qty').value);
      if (!(qty > 0)) return UI.toast('Quantity must be greater than zero.', 'error');
      const reservation = el.querySelector('#so-reservation').value.trim();
      if (!reservation) return UI.toast('Reservation number is required.', 'error');

      const row = this.summary.locations.find((l) => l.location_id === locationId);
      const available = row ? row.quantity : 0;
      if (qty > available) {
        return UI.toast(`Quantity out (${qty}) exceeds available stock (${UI.fmtQty(available)}) in this location.`, 'error');
      }

      submitBtn.disabled = true;
      try {
        const { message } = await Api.post('/api/stock/out', {
          material_id: this.selectedMaterial.id,
          location_id: locationId,
          quantity: qty,
          reservation_number: reservation,
          notes: el.querySelector('#so-notes').value,
        });
        UI.toast(message);
        // Refresh figures; the location list may shrink if it hit zero.
        await this.loadSummary(el);
        el.querySelector('#so-qty').value = '';
        el.querySelector('#so-reservation').value = '';
        el.querySelector('#so-notes').value = '';
      } catch (err) {
        UI.toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  },

  async loadSummary(el) {
    this.summary = await Api.get(`/api/stock/material/${this.selectedMaterial.id}/summary`);
    const m = this.summary.material;

    el.querySelector('#so-details').style.display = '';
    el.querySelector('#so-d-plant').textContent = m.plant || '—';
    el.querySelector('#so-d-code').textContent = m.item_code;
    el.querySelector('#so-d-unit').textContent = m.unit;
    el.querySelector('#so-d-total').textContent = UI.fmtQty(this.summary.total_stock);
    el.querySelector('#so-d-desc').textContent = m.description;

    // Only locations that currently hold this material with quantity > 0.
    const stocked = this.summary.locations.filter((l) => l.quantity > 0);
    const locationSelect = el.querySelector('#so-location');
    if (!stocked.length) {
      locationSelect.innerHTML = '<option value="">No stock available for this material</option>';
      locationSelect.disabled = true;
    } else {
      locationSelect.innerHTML = '<option value="">Select location…</option>' +
        stocked.map((l) => `<option value="${l.location_id}">${UI.esc(l.code)} (${UI.fmtQty(l.quantity)})</option>`).join('');
      locationSelect.disabled = false;
    }
    el.querySelector('#so-loc-stock').value = '—';
  },
};
