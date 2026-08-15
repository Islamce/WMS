/* global UI */
/** Browser regression for authorized D01 shared presentation and D03 Home work. */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
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

function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => http.get(BASE + '/healthz', (response) => { response.resume(); resolve(); })
      .on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('server did not become healthy'));
        else setTimeout(tick, 250);
      });
    tick();
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (server.exitCode === null && !server.signalCode) server.kill('SIGKILL');
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

async function token(email, password) {
  return (await api('POST', '/api/auth/login', null, { email, password })).token;
}

async function loginUi(page, email, password) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('#li-email').fill(email);
  await page.locator('#li-password').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForSelector('#lp-filter');
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

    // Generate one ordinary workflow notification through existing API behavior;
    // D03 is read-only and must not invent a new Home aggregation endpoint.
    const requester = await token('requester@example.com', 'Passw0rd!');
    const material = (await api('GET', '/api/materials/search?q=MAT-0001', requester)).materials[0];
    const created = await api('POST', '/api/requests', requester, {
      purpose: 'design-foundation-browser-regression', cost_center: 'CC-1000', plant: 'P100',
      lines: [{ material_id: material.id, requested_quantity: 1 }],
    });
    await api('POST', `/api/requests/${created.id}/submit`, requester);

    browser = await chromium.launch();
    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await loginUi(managerPage, 'manager@example.com', 'Passw0rd!');
    check('Home renders the current-user recent-alert preview',
      await managerPage.locator('#lp-attention-title').innerText() === 'Recent alerts');
    check('Home shows no more than three existing notification previews',
      (await managerPage.locator('.lp-alert').count()) > 0 && (await managerPage.locator('.lp-alert').count()) <= 3);
    check('Home notification preview links only to the established notification center',
      await managerPage.locator('.lp-alert').first().getAttribute('href') === '#/notifications');
    await managerContext.close();

    const erpContext = await browser.newContext();
    const erpPage = await erpContext.newPage();
    await loginUi(erpPage, 'erp@example.com', 'Passw0rd!');
    const initialGroups = await erpPage.locator('.lp-group').count();
    const toggle = erpPage.locator('#lp-show-all');
    check('ERP Home defaults to a focused role-process catalog with explicit Show all',
      (await toggle.count()) === 1 && (await toggle.innerText()) === 'Show all processes');
    await toggle.click();
    check('Show all exposes additional already-permitted process groups without changing authorization',
      (await erpPage.locator('.lp-group').count()) > initialGroups && (await toggle.getAttribute('aria-pressed')) === 'true');

    const d01 = await erpPage.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.innerHTML = UI.requestCard({
        id: 101, request_number: 'MR-D01-101', request_status: 'Reminder Sent', priority: 'HIGH',
        requester_name: 'Test Requester', issue_warehouse_code: 'WH01', required_date: '2026-08-15',
      }, {
        materialsHtml: UI.materialDisclosure({ lineCount: 2, bodyHtml: '<p>Material detail</p>' }),
        actionHtml: '<button type="button">Open</button>',
      });
      document.body.appendChild(fixture);
      const reminder = {
        hasCard: Boolean(fixture.querySelector('.request-card')),
        assignedWarning: Boolean(fixture.querySelector('.request-stage-step.current.warning')),
        warningMarker: Boolean(fixture.querySelector('.request-stage-exception.warning')),
        status: fixture.querySelector('.request-stage-status')?.textContent.trim(),
        closedBeforeClick: !fixture.querySelector('details').open,
      };
      fixture.querySelector('summary').click();
      reminder.openAfterClick = fixture.querySelector('details').open;
      const exceptionHtml = UI.requestStageIndicator({ request_status: 'Escalated to Supervisor' })
        + UI.requestStageIndicator({ request_status: 'ERP Error' })
        + UI.requestStageIndicator({ request_status: 'Closed with Shortage' });
      reminder.dangerExceptions = (exceptionHtml.match(/request-stage-exception danger/g) || []).length;
      reminder.warningExceptions = (exceptionHtml.match(/request-stage-exception warning/g) || []).length;
      fixture.remove();
      return reminder;
    });
    check('RequestCard retains canonical Reminder Sent status with an Assigned-stage warning marker',
      d01.hasCard && d01.assignedWarning && d01.warningMarker && d01.status.includes('Reminder Sent'), JSON.stringify(d01));
    check('Material disclosure remains closed until the user explicitly expands it',
      d01.closedBeforeClick && d01.openAfterClick, JSON.stringify(d01));
    check('escalation, ERP error, and shortage receive distinct stage exceptions',
      d01.dangerExceptions === 2 && d01.warningExceptions === 1, JSON.stringify(d01));
    await erpContext.close();
  } catch (error) {
    check('D01/D03 browser regression completed', false, error.message);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }

  console.log(`\n===== DESIGN FOUNDATION BROWSER: ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
