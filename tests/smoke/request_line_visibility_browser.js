/**
 * Browser regression for approved web-only request-line and picker-state visibility.
 * It proves rendered ERP line context, lazy Warehouse Dashboard expansion, and
 * explicit escalated-picker visibility without changing workflow semantics.
 */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OWN_SERVER = !process.env.BASE_URL;
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log('PASS:', name); }
  else { failed += 1; console.log('FAIL:', name, detail); }
}

function findChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return undefined;
  const entries = fs.readdirSync(base);
  const shell = entries.find((entry) => /^chromium_headless_shell-\d+$/.test(entry));
  if (shell) {
    const executable = path.join(base, shell, 'chrome-linux', 'headless_shell');
    if (fs.existsSync(executable)) return executable;
  }
  const full = entries.find((entry) => /^chromium-\d+$/.test(entry));
  if (full) {
    const executable = path.join(base, full, 'chrome-linux', 'chrome');
    if (fs.existsSync(executable)) return executable;
  }
  return undefined;
}

function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(BASE + '/healthz', (response) => { response.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server did not become healthy'));
          else setTimeout(tick, 250);
        });
    };
    tick();
  });
}

async function api(method, route, token, body) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${payload.error || ''}`);
  return payload;
}

async function login(email, password) {
  const result = await api('POST', '/api/auth/login', null, { email, password });
  return result.token;
}

async function loginUi(page, email, password) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('#li-email').fill(email);
  await page.locator('#li-password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#login-form'));
}

async function goTo(page, hash, selector) {
  await page.evaluate((nextHash) => { window.location.hash = nextHash; }, hash);
  await page.waitForSelector(selector);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (server.exitCode === null && !server.signalCode) server.kill('SIGKILL');
}

(async () => {
  let server;
  let browser;
  try {
    if (OWN_SERVER) {
      spawnSync('node', ['server/db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
      spawnSync('node', ['server/db/seed.js'], { cwd: ROOT, stdio: 'ignore' });
      server = spawn('node', ['index.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env } });
    }
    await waitForHealth();

    const [requester, manager, erp, supervisor, admin] = await Promise.all([
      login('requester@example.com', 'Passw0rd!'),
      login('manager@example.com', 'Passw0rd!'),
      login('erp@example.com', 'Passw0rd!'),
      login('supervisor@example.com', 'Passw0rd!'),
      login('admin@example.com', 'Admin@123456'),
    ]);
    const materials = (await api('GET', '/api/materials/search?q=MAT-', admin)).materials.slice(0, 4);
    const created = await api('POST', '/api/requests', requester, {
      purpose: 'browser-visibility-regression', cost_center: 'CC-1000', plant: 'P100',
      lines: materials.map((material, index) => ({ material_id: material.id, requested_quantity: index + 1 })),
    });
    const requestId = created.id;
    const requestNumber = created.request_number;
    await api('POST', `/api/requests/${requestId}/submit`, requester);
    await api('POST', `/api/approvals/${requestId}/decision`, manager, { decision: 'approve' });
    await api('PATCH', `/api/erp-operator/${requestId}`, erp, {
      erp_reservation_number: `RES-UI-${requestId}`, erp_reference_number: `ERP-UI-${requestId}`,
      movement_type: '201', plant: 'P100', storage_location: '0001', issue_warehouse_code: 'WH01',
    });

    browser = await chromium.launch(findChromiumExecutable() ? { executablePath: findChromiumExecutable() } : {});
    const erpContext = await browser.newContext();
    const erpPage = await erpContext.newPage();
    await loginUi(erpPage, 'erp@example.com', 'Passw0rd!');
    await goTo(erpPage, '#/erp-operator', '#eo-table tr[data-id]');
    await erpPage.locator(`#eo-table tr[data-id="${requestId}"]`).click();
    await erpPage.waitForSelector('#eo-material-lines');
    const collapsedErpText = await erpPage.locator('#eo-material-lines').innerText();
    check('ERP detail bounds long material lists behind a disclosure',
      await erpPage.locator('#eo-material-lines details').count() === 1, collapsedErpText);
    await erpPage.locator('#eo-material-lines summary').click();
    const erpText = await erpPage.locator('#eo-material-lines').innerText();
    check('ERP detail renders requested material descriptions, codes, quantities, and UoM',
      materials.every((material) => erpText.includes(material.item_code)) &&
      erpText.toUpperCase().includes('REQUESTED') && erpText.toUpperCase().includes('UOM'), erpText);
    await erpContext.close();

    await api('POST', `/api/erp-operator/${requestId}/send-to-warehouse`, erp);
    await api('POST', `/api/warehouse/${requestId}/allocate`, supervisor);

    const warehouseContext = await browser.newContext();
    const warehousePage = await warehouseContext.newPage();
    await loginUi(warehousePage, 'supervisor@example.com', 'Passw0rd!');
    await goTo(warehousePage, '#/warehouse', `button[data-lines="${requestId}"]`);
    const lineButton = warehousePage.locator(`button[data-lines="${requestId}"]`);
    check('Warehouse Dashboard starts compact with an explicit Lines control',
      await lineButton.innerText() === '4 lines');
    await lineButton.click();
    await warehousePage.waitForSelector(`#wd-lines-${requestId}`);
    await warehousePage.locator(`#wd-lines-${requestId}`).getByText(materials[0].item_code, { exact: false }).waitFor();
    const expandedText = await warehousePage.locator(`#wd-lines-${requestId}`).innerText();
    check('Warehouse Dashboard lazily expands existing request lines without leaving the page',
      materials.every((material) => expandedText.includes(material.item_code)) &&
      (await warehousePage.url()).endsWith('#/warehouse'), expandedText);
    await lineButton.click();
    check('Warehouse Dashboard Lines control collapses the child row',
      await warehousePage.locator(`#wd-lines-${requestId}`).count() === 0);
    await warehouseContext.close();

    const pickers = await api('GET', '/api/warehouse/pickers', supervisor);
    const picker = pickers.pickers[0];
    await api('POST', `/api/warehouse/${requestId}/assign-picker`, supervisor, { picker_id: picker.id });
    await api('POST', '/api/picking/sweep', supervisor, { testMinutes: 11 });
    await api('POST', '/api/picking/sweep', supervisor, { testMinutes: 16 });

    const pickerContext = await browser.newContext();
    const pickerPage = await pickerContext.newPage();
    await loginUi(pickerPage, 'supervisor@example.com', 'Passw0rd!');
    await goTo(pickerPage, '#/picker-assign', `#pa-table tr[data-id="${requestId}"]`);
    const pickerRow = pickerPage.locator(`#pa-table tr[data-id="${requestId}"]`);
    const pickerText = await pickerRow.innerText();
    check('escalated assignment row shows the existing picker and escalation evidence',
      pickerText.includes('Escalated to Supervisor') && pickerText.includes(picker.name) && pickerText.includes('escalation 1'), pickerText);
    check('escalated assignment exposes explicit Reassign rather than a silent fresh assignment',
      await pickerRow.getByRole('button', { name: 'Reassign' }).count() === 1, pickerText);
    await pickerContext.close();
  } catch (error) {
    check('browser visibility regression completed', false, error.message);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }

  console.log(`\n===== BROWSER VISIBILITY: ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
