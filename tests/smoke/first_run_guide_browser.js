/**
 * Browser regression for what a brand-new CONTRACTING tenant is shown:
 * the first-run setup guide, and the three screens the collapsed workflow
 * routes past.
 *
 * The server test already proves the steps and their order. What only a browser
 * can prove is the part that decides whether this is useful or clutter:
 *
 *   - a brand-new tenant SEES it, with the next step to take;
 *   - a tenant that is already running does NOT, so it can never become
 *     permanent furniture on an established customer's home screen.
 *
 * The second assertion is the one worth having. A setup checklist that outlives
 * setup is a worse outcome than not shipping one.
 */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 3612;
const BASE = `http://localhost:${PORT}`;
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${payload.error || ''}`);
  return payload;
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (server.exitCode === null && !server.signalCode) server.kill('SIGKILL');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-firstrun-'));
  const dbPath = path.join(tmp, 'wms.db');
  let server;
  let browser;

  try {
    // A real provisioned tenant, not a fixture: this is what a customer gets.
    const prov = spawnSync('node', ['scripts/provision-tenant.js', '--name', 'First Run Ltd',
      '--slug', 'firstrun', '--profile', 'contracting', '--admin-email', 'ops@example.com',
      '--db', dbPath], { cwd: ROOT, encoding: 'utf8' });
    const password = (prov.stdout || '').split('\n')
      .filter((l) => /password/i.test(l) && l.includes(':'))
      .map((l) => l.split(':').slice(1).join(':').trim())[0];
    check('a tenant is provisioned', prov.status === 0 && !!password, (prov.stderr || '').slice(-300));
    spawnSync('node', ['scripts/install-starter-data.js', '--db', dbPath], { cwd: ROOT, stdio: 'ignore' });

    server = spawn('node', ['index.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test', SKIP_AUTO_SEED: '1',
        JWT_SECRET: 'k'.repeat(48), PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitForHealth();

    // Provisioning forces a password change before anything else.
    const first = await api('POST', '/api/auth/login', null, { email: 'ops@example.com', password });
    await api('PATCH', '/api/auth/password', first.token,
      { current_password: password, new_password: 'FirstRun!2026x' });

    browser = await chromium.launch({ executablePath: findChromiumExecutable() });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
    await page.locator('#li-email').fill('ops@example.com');
    await page.locator('#li-password').fill('FirstRun!2026x');
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#login-form'));
    await page.waitForSelector('.launchpad', { timeout: 15000 });

    check('a new tenant is shown the setup guide',
      await page.locator('.setup-guide').count() === 1);
    const text = await page.locator('.setup-guide').innerText().catch(() => '');
    check('it names the next step to take', /Post your first goods receipt/i.test(text), text.slice(0, 200));
    check('and warns that stock arrives on quality hold',
      /quality hold/i.test(text), text.slice(0, 400));
    check('the steps are listed in order',
      text.indexOf('Release it from quality hold') < text.indexOf('Put it away in a bin')
      && text.indexOf('Put it away in a bin') < text.indexOf('Request it, approve it'), text.slice(0, 600));

    // Now make the tenant look like one that is running. The guide must go.
    const token = (await api('POST', '/api/auth/login', null,
      { email: 'ops@example.com', password: 'FirstRun!2026x' })).token;
    const { materials } = await api('GET', '/api/materials?search=CEM-OPC-50', token);
    const materialId = (materials || [])[0].id;
    const receipt = await api('POST', '/api/receiving', token,
      { material_id: materialId, received_quantity: 50, warehouse_code: 'SITE-01', po_number: 'PO-1' });
    await api('POST', `/api/master/batches/${receipt.batch_id}/quality`, token, { quality_status: 'RELEASED' });
    await api('PATCH', `/api/receiving/batches/${receipt.batch_id}/bin`, token,
      { bin_location: 'SITE-01-RACK-01' });

    const created = await api('POST', '/api/requests', token, {
      request_type: 'COST_CENTER', plant: 'P100', issue_warehouse_code: 'SITE-01',
      lines: [{ material_id: materialId, requested_quantity: 5 }],
    });
    const rid = (created.request || created).id;
    await api('POST', `/api/requests/${rid}/submit`, token);
    await api('POST', `/api/approvals/${rid}/decision`, token, { decision: 'approve' });
    await api('POST', `/api/picking/requests/${rid}/claim`, token);
    const detail = await api('GET', `/api/requests/${rid}`, token);
    const lineId = (detail.lines || detail.request?.lines || [])[0].id;
    await api('POST', `/api/picking/lines/${lineId}/confirm`, token, { picked_quantity: 5 });
    const tasks = await api('GET', '/api/picking/tasks', token);
    await api('POST', `/api/picking/tasks/${tasks.tasks[0].id}/complete`, token);
    await api('POST', `/api/gi/${rid}/post`, token, {});

    const status = await api('GET', '/api/setup/status', token);
    check('the server calls setup complete once material has been issued',
      status.complete === true, status);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.launchpad', { timeout: 15000 });
    check('and the guide disappears — it cannot become permanent furniture',
      await page.locator('.setup-guide').count() === 0);

    // The collapsed workflow left three screens reachable but no longer on the
    // path. They are deliberately NOT hidden — a tenant switched from an ERP
    // edition can have requests already sitting in those queues, and hiding the
    // screens would strand them. So each must say what it is instead of looking
    // like a screen that is simply broken.
    await page.evaluate(() => { window.location.hash = '#/erp-operator'; });
    await page.waitForSelector('#eo-table', { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#eo-table .loading'), { timeout: 15000 });
    const erpText = await page.locator('#eo-table').innerText();
    check('the ERP queue explains that nothing passes through it here',
      /straight to the site store/i.test(erpText), erpText.slice(0, 200));

    await page.evaluate(() => { window.location.hash = '#/allocation'; });
    await page.waitForSelector('#al-table', { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#al-table .loading'), { timeout: 15000 });
    const allocText = await page.locator('#al-table').innerText();
    check('bin and batch assignment explains that allocation is automatic',
      /runs automatically/i.test(allocText), allocText.slice(0, 200));

    await page.evaluate(() => { window.location.hash = '#/picker-assign'; });
    await page.waitForSelector('#pa-list', { timeout: 15000 });
    const pickerText = await page.locator('.card').first().innerText();
    check('picker assignment says the store claims its own work',
      /claims its own work/i.test(pickerText), pickerText.slice(0, 200));

    // The sidebar and the launchpad tiles used to carry different names for the
    // same screen, both on this page at once. Whatever the names are, they must
    // now be the same names.
    await page.evaluate(() => { window.location.hash = '#/home'; });
    await page.waitForSelector('.launchpad', { timeout: 15000 });
    const mismatched = await page.evaluate(() => {
      const sidebar = new Map();
      document.querySelectorAll('.nav-item').forEach((a) => {
        const label = a.querySelector('.lbl');
        const route = (a.getAttribute('href') || '').replace('#/', '');
        if (label && route) sidebar.set(route, label.textContent.trim());
      });
      const bad = [];
      document.querySelectorAll('.lp-tile[href^="#/"]').forEach((a) => {
        const route = a.getAttribute('href').replace('#/', '');
        const labelEl = a.querySelector('.lp-label');
        const tile = (labelEl ? labelEl.textContent : '').replace(/\s+/g, ' ').trim();
        const nav = sidebar.get(route);
        if (nav && tile && nav !== tile) bad.push(`${route}: sidebar "${nav}" vs tile "${tile}"`);
      });
      return bad;
    });
    check('the sidebar and the launchpad call every screen the same thing',
      mismatched.length === 0, mismatched.join(' | '));

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  } catch (err) {
    check('first-run guide smoke completed', false, err.message);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n===== FIRST-RUN GUIDE: ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
