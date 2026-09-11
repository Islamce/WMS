/**
 * Browser regression for the subcontractor-ownership screens (phases 2–3 UI).
 *
 * Server-side tests already pin the rules. What only a browser can prove is that
 * the screens exist, are reachable from the navigation, and — the part that
 * matters most — that an approver is TOLD why they cannot approve a
 * subcontractor request instead of clicking approve and being refused by the
 * server after the fact.
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${payload.error || ''}`);
  return payload;
}

async function login(email, password) {
  return (await api('POST', '/api/auth/login', null, { email, password })).token;
}

async function loginUi(page, email, password) {
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
  await page.locator('#li-email').fill(email);
  await page.locator('#li-password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#login-form'));
}

async function goTo(page, hash, selector) {
  await page.evaluate((nextHash) => { window.location.hash = nextHash; }, hash);
  await page.waitForSelector(selector, { timeout: 15000 });
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

    const admin = await login('admin@example.com', 'Admin@123456');
    const subcontractor = await api('POST', '/api/subcontractor/subcontractors', admin,
      { name: 'UI Browser Contracting', trade_category: 'Finishes' });

    // Give the subcontractor a batch to own, so the report has a row and the
    // return queue has something returnable.
    const { batches } = await api('GET', '/api/master/batches?limit=3', admin);
    const batch = batches[0];
    const Database = require('better-sqlite3');
    const db = new Database(path.join(ROOT, 'data', 'wms.db'));
    db.prepare("UPDATE batches SET owner_type='SUBCONTRACTOR', owner_subcontractor_id=? WHERE id=?")
      .run(subcontractor.id, batch.id);
    db.close();

    await api('POST', '/api/subcontractor/returns', admin,
      { batch_id: batch.id, quantity: 1, reason: 'Browser regression' });

    browser = await chromium.launch(findChromiumExecutable()
      ? { executablePath: findChromiumExecutable() } : {});
    const consoleErrors = [];

    // The seeded administrator is forced to change the default password on first
    // login, so UI assertions use the demo role accounts — which is the more
    // honest test anyway: these screens are for warehouse and project staff.

    // ---- The warehouse can see the queue but NOT approve ----
    // This is the authority split as a user experiences it. Nobody holds
    // subcontractor_return_approval yet: the permission ships granted to no role.
    const warehousePage = await (await browser.newContext()).newPage();
    warehousePage.on('pageerror', (e) => consoleErrors.push(String(e)));
    await loginUi(warehousePage, 'supervisor@example.com', 'Passw0rd!');

    await goTo(warehousePage, '#/subcontractor-returns', '#ret-table table');
    const returnRows = await warehousePage.locator('#ret-table tbody tr').count();
    check('return queue renders the pending return', returnRows >= 1, returnRows);
    const warehouseApprove = await warehousePage.locator('#ret-table [data-act="approve"]').count();
    check('the warehouse is NOT offered the approve action', warehouseApprove === 0, warehouseApprove);
    const queueText = await warehousePage.locator('#ret-table, .card').first().textContent();
    check('the screen states the movement type rather than hiding it',
      /542/.test(await warehousePage.locator('.card').first().textContent() || ''), queueText);

    await goTo(warehousePage, '#/subcontractor-owned-stock', '#os-table table');
    const reportRows = await warehousePage.locator('#os-table tbody tr').count();
    check('owned-stock report renders a row', reportRows >= 1, reportRows);
    const engagement = await warehousePage.locator('#os-table tbody .badge').first().textContent();
    check('engagement type is shown for presentation', /Supply/.test(engagement || ''), engagement);
    const basis = await warehousePage.locator('#os-basis').textContent();
    check('the basis of the numbers is stated on screen',
      /BOQ/.test(basis || '') && /left the store/.test(basis || ''), basis);

    await warehousePage.selectOption('#os-threshold', '25');
    await warehousePage.waitForTimeout(800);
    check('changing the depletion threshold reloads without error', consoleErrors.length === 0, consoleErrors);

    // ---- A requester can attribute a request to a subcontractor ----
    const requesterPage = await (await browser.newContext()).newPage();
    requesterPage.on('pageerror', (e) => consoleErrors.push(String(e)));
    await loginUi(requesterPage, 'requester@example.com', 'Passw0rd!');
    await goTo(requesterPage, '#/create-request', '#cr-form');
    const selectorCount = await requesterPage.locator('#cr-subcontractor').count();
    check('the request form offers the subcontractor field', selectorCount === 1, selectorCount);
    const defaultOption = await requesterPage.locator('#cr-subcontractor option').first().textContent();
    check('it defaults to company labour, not to a subcontractor',
      /Company labour/i.test(defaultOption || ''), defaultOption);

    // ---- The approver is told about the authority BEFORE being refused ----
    const requesterToken = await login('requester@example.com', 'Passw0rd!');
    const { materials } = await api('GET', '/api/materials/search?q=MAT-', admin);
    const created = await api('POST', '/api/requests', requesterToken, {
      purpose: 'browser authority notice',
      subcontractor_id: subcontractor.id,
      lines: [{ material_id: materials[0].id, requested_quantity: 1 }],
    });
    await api('POST', `/api/requests/${created.id}/submit`, requesterToken);

    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    managerPage.on('pageerror', (e) => consoleErrors.push(String(e)));
    await loginUi(managerPage, 'manager@example.com', 'Passw0rd!');
    await goTo(managerPage, '#/approvals', '#ap-table tr[data-id]');
    const inboxText = await managerPage.locator('#ap-table').textContent();
    check('the inbox shows who the request is raised for',
      /UI Browser Contracting/.test(inboxText || ''), (inboxText || '').slice(0, 200));

    await managerPage.locator(`#ap-table tr[data-id="${created.id}"]`).click();
    // #ap-detail .card also matches the "Loading…" placeholder, so waiting on it
    // races the fetch. #ap-approve only exists once the real detail rendered.
    await managerPage.waitForSelector('#ap-detail #ap-approve');
    const detailText = await managerPage.locator('#ap-detail').textContent();
    check('the approver is warned about the missing authority up front',
      /Project Management Approval/.test(detailText || ''), (detailText || '').slice(0, 300));
    check('and is told they can still reject or return',
      /return or reject/i.test(detailText || ''), (detailText || '').slice(0, 300));

    // ---- Assigning the authority makes the warning go away ----
    // The permissions ship granted to no role precisely so this is a deliberate
    // administrative act. Proving the grant works is proving the feature is
    // usable rather than permanently locked.
    const { permissions } = await api('GET', '/api/permissions', admin);
    const { roles } = await api('GET', '/api/permissions/roles', admin);
    const managerRole = roles.find((r) => r.name === 'manager');
    const extra = permissions
      .filter((p) => ['project_management_approval', 'subcontractor_return_approval'].includes(p.key))
      .map((p) => p.id);
    check('both new authorities exist as assignable permissions', extra.length === 2, extra);
    await api('PUT', `/api/permissions/roles/${managerRole.id}`, admin,
      { permission_ids: [...new Set([...managerRole.permission_ids, ...extra])] });

    const grantedPage = await (await browser.newContext()).newPage();
    grantedPage.on('pageerror', (e) => consoleErrors.push(String(e)));
    await loginUi(grantedPage, 'manager@example.com', 'Passw0rd!');
    await goTo(grantedPage, '#/approvals', '#ap-table tr[data-id]');
    await grantedPage.locator(`#ap-table tr[data-id="${created.id}"]`).click();
    await grantedPage.waitForSelector('#ap-detail #ap-approve');
    const grantedText = await grantedPage.locator('#ap-detail').textContent();
    check('once the authority is assigned the warning is gone',
      !/Project Management Approval<\/strong> authority/.test(grantedText || '')
      && !/needs the/.test(grantedText || ''), (grantedText || '').slice(0, 300));

    await goTo(grantedPage, '#/subcontractor-returns', '#ret-table table');
    const grantedApprove = await grantedPage.locator('#ret-table [data-act="approve"]').count();
    check('and project management is now offered the approve action',
      grantedApprove >= 1, grantedApprove);

    check('no uncaught page errors on any screen', consoleErrors.length === 0, consoleErrors);
  } catch (error) {
    failed += 1;
    console.log('FAIL: unexpected error —', error.message);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
