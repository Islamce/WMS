/**
 * Stock In screen: material autocomplete -> location dropdown -> quantity.
 * Shows total stock for the material and current stock in the selected
 * location as readonly fields.
 */
window.Pages = window.Pages || {};

Pages.stockin = {
  selectedMaterial: null,
  summary: null,

  async render(el) {
    this.selectedMaterial = null;
    this.summary = null;

    el.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3>Stock In</h3>
        <form id="si-form" novalidate>
          <div class="form-group autocomplete">
            <label>Material *</label>
            <input type="text" id="si-material" placeholder="Type item code or description…" autocomplete="off" />
            <div class="hint">Search and pick a material from the list.</div>
          </div>
          <div class="form-group">
            <label>Total stock (all locations)</label>
            <input type="text" id="si-total" readonly value="—" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Location *</label>
              <select id="si-location" disabled><option value="">Select material first</option></select>
            </div>
            <div class="form-group">
              <label>Stock in selected location</label>
              <input type="text" id="si-loc-stock" readonly value="—" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Quantity *</label>
              <input type="number" id="si-qty" min="0" step="any" placeholder="0" />
            </div>
            <div class="form-group">
              <label>Reservation number <span class="muted">(optional)</span></label>
              <input type="text" id="si-reservation" />
            </div>
          </div>
          <div class="form-group">
            <label>Notes <span class="muted">(optional)</span></label>
            <textarea id="si-notes" rows="2"></textarea>
          </div>
          <button type="submit" class="btn success block" id="si-submit" disabled>📥 Submit Stock In</button>
        </form>
      </div>`;

    // Load all locations for the dropdown once.
    let allLocations = [];
    try {
      ({ locations: allLocations } = await Api.get('/api/locations/all'));
    } catch (err) {
      UI.toast(err.message, 'error');
    }

    const materialInput = el.querySelector('#si-material');
    const locationSelect = el.querySelector('#si-location');
    const submitBtn = el.querySelector('#si-submit');

    const auto = UI.materialAutocomplete(materialInput, async (material) => {
      this.selectedMaterial = material;
      await this.loadSummary();
      locationSelect.disabled = false;
      locationSelect.innerHTML = '<option value="">Select location…</option>' +
        allLocations.map((l) => `<option value="${l.id}">${UI.esc(l.code)}</option>`).join('');
      el.querySelector('#si-loc-stock').value = '—';
      submitBtn.disabled = false;
    });

    // If the user edits the material text again, the selection is void.
    materialInput.addEventListener('input', () => {
      this.selectedMaterial = null;
      this.summary = null;
      el.querySelector('#si-total').value = '—';
      el.querySelector('#si-loc-stock').value = '—';
      locationSelect.innerHTML = '<option value="">Select material first</option>';
      locationSelect.disabled = true;
      submitBtn.disabled = true;
    });

    locationSelect.addEventListener('change', () => {
      const locId = Number(locationSelect.value);
      const row = this.summary?.locations.find((l) => l.location_id === locId);
      el.querySelector('#si-loc-stock').value = locationSelect.value ? UI.fmtQty(row ? row.quantity : 0) : '—';
    });

    el.querySelector('#si-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.selectedMaterial) return UI.toast('Please select a material from the list.', 'error');
      const locationId = locationSelect.value;
      if (!locationId) return UI.toast('Please select a location.', 'error');
      const qty = Number(el.querySelector('#si-qty').value);
      if (!(qty > 0)) return UI.toast('Quantity must be greater than zero.', 'error');

      submitBtn.disabled = true;
      try {
        const { message } = await Api.post('/api/stock/in', {
          material_id: this.selectedMaterial.id,
          location_id: Number(locationId),
          quantity: qty,
          reservation_number: el.querySelector('#si-reservation').value,
          notes: el.querySelector('#si-notes').value,
        });
        UI.toast(message);
        // Refresh the readonly stock figures, keep the material selected.
        await this.loadSummary();
        const row = this.summary.locations.find((l) => l.location_id === Number(locationId));
        el.querySelector('#si-loc-stock').value = UI.fmtQty(row ? row.quantity : 0);
        el.querySelector('#si-qty').value = '';
        el.querySelector('#si-reservation').value = '';
        el.querySelector('#si-notes').value = '';
      } catch (err) {
        UI.toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  },

  async loadSummary() {
    this.summary = await Api.get(`/api/stock/material/${this.selectedMaterial.id}/summary`);
    document.getElementById('si-total').value =
      `${UI.fmtQty(this.summary.total_stock)} ${this.summary.material.unit}`;
  },
};
