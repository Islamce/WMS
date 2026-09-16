/* global UI, Pages */
/** Browser regression for authorized D01 shared presentation and D03 Home work. */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * Mirrors playwright_smoke.js: in this environment Chromium is pre-installed
 * under PLAYWRIGHT_BROWSERS_PATH but may be a different build number than the
 * `playwright` package expects, so point launch() straight at it.
 */
function findChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return undefined;
  const entries = fs.readdirSync(base);
  const shell = entries.find((d) => /^chromium_headless_shell-\d+$/.test(d));
  if (shell) {
    const exe = path.join(base, shell, 'chrome-linux', 'headless_shell');
    if (fs.existsSync(exe)) return exe;
  }
  const full = entries.find((d) => /^chromium-\d+$/.test(d));
  if (full) {
    const exe = path.join(base, full, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

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
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
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

    const executablePath = findChromiumExecutable();
    browser = await chromium.launch(executablePath ? { executablePath } : {});
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

    await erpPage.evaluate(() => document.getElementById('menu-toggle').click());
    await erpPage.waitForSelector('#layout.nav-open');
    const navState = await erpPage.evaluate(() => ({
      profile: document.querySelector('.nav-profile')?.textContent.trim(),
      groups: [...document.querySelectorAll('.nav-group')].map((group) => ({ key: group.dataset.key, open: group.classList.contains('open') })),
      permissionsLinkCount: document.querySelectorAll('.nav-item[href="#/permissions"]').length,
    }));
    check('ERP sidebar applies its workspace profile by ordering and opening the relevant permitted module',
      navState.profile === 'ERP Operator workspace' && navState.groups[0]?.key === 'v2-demand' && navState.groups.some((group) => group.key === 'v2-demand' && group.open), JSON.stringify(navState));
    check('Role presentation does not expose a destination that the ERP role lacks permission to access',
      navState.permissionsLinkCount === 0, JSON.stringify(navState));
    await erpPage.locator('#nav-search').click();
    await erpPage.locator('#cmd-input').fill('Notifications');
    check('Command palette retains discovery of permitted screens outside the role-focused default navigation view',
      await erpPage.locator('#cmd-results a[href="#/notifications"]').count() === 1);
    await erpPage.keyboard.press('Escape');

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

    // Light-theme status legibility. kynox-v2.css defines :root as the dark
    // palette and once redefined only twelve tokens for light - none of the
    // status ones - so badges drew dark-theme text on white at ~1.3:1. This
    // measures the rendered result, not the stylesheet.
    const legibility = await erpPage.evaluate(() => {
      const root = document.documentElement;
      const prevTheme = root.dataset.theme;
      root.dataset.theme = 'light';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = [
        '<span class="badge role" data-k="badge.role">Warehouse Assigned</span>',
        '<span class="badge pending" data-k="badge.pending">Pending</span>',
        '<span class="badge active" data-k="badge.active">Active</span>',
        '<span class="badge OUT" data-k="badge.OUT">OUT</span>',
        '<div class="inline-alert error" data-k="inline-alert.error">Error</div>',
        '<div class="inline-alert warning" data-k="inline-alert.warning">Warning</div>',
        '<button class="btn" data-k="btn.plain">Submit</button>',
        '<button class="btn success" data-k="btn.success">Approve</button>',
        '<button class="btn warn" data-k="btn.warn">Reverse GI</button>',
      ].join('');
      document.body.appendChild(card);
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
          const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const out = {};
      card.querySelectorAll('[data-k]').forEach((el) => {
        const cs = getComputedStyle(el);
        out[el.dataset.k] = { bg: cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor, fg: cs.color,
          ratio: Number(contrast(cs.color, cs.backgroundColor).toFixed(2)) };
      });
      card.remove();
      if (prevTheme === undefined) delete root.dataset.theme; else root.dataset.theme = prevTheme;
      return out;
    });
    const weak = Object.entries(legibility)
      .filter(([k]) => k.startsWith('badge.') || k.startsWith('inline-alert.'))
      .filter(([, v]) => v.ratio < 4.5).map(([k, v]) => `${k}=${v.ratio}`);
    check('light-theme status badges and alerts are legible (>= 4.5:1, measured)',
      weak.length === 0, weak.join(', ') || JSON.stringify(legibility));
    check('a success button does not render as the plain primary button',
      legibility['btn.success'].bg !== legibility['btn.plain'].bg, JSON.stringify({ plain: legibility['btn.plain'].bg, success: legibility['btn.success'].bg }));
    check('a warn button has a rule of its own (Reverse GI is not pixel-identical to Submit)',
      legibility['btn.warn'].bg !== legibility['btn.plain'].bg && legibility['btn.warn'].bg !== legibility['btn.success'].bg,
      JSON.stringify({ plain: legibility['btn.plain'].bg, warn: legibility['btn.warn'].bg }));

    // Approvals: the tick boxes must mean something. The server approves every
    // line on 'approve' and ignores approvedLineIds, so the client decides what
    // a click means from what is ticked. Pure function, asserted directly.
    const resolved = await erpPage.evaluate(() => ({
      allTicked: Pages.approvals.resolveDecision('approve', [1, 2, 3], [1, 2, 3]),
      someUnticked: Pages.approvals.resolveDecision('approve', [1, 3], [1, 2, 3]),
      partialAll: Pages.approvals.resolveDecision('partial', [1, 2, 3], [1, 2, 3]),
      reject: Pages.approvals.resolveDecision('reject', [1], [1, 2, 3]),
    }));
    check('Approve with every line ticked is a full approval',
      resolved.allTicked.decision === 'approve' && resolved.allTicked.approvedLineIds === undefined, JSON.stringify(resolved.allTicked));
    check('Approve with a line unticked is recorded as a partial approval of the ticked lines only',
      resolved.someUnticked.decision === 'partial' && JSON.stringify(resolved.someUnticked.approvedLineIds) === '[1,3]' && resolved.someUnticked.demoted === true,
      JSON.stringify(resolved.someUnticked));
    check('Partial Approve with every line ticked is simply an approval',
      resolved.partialAll.decision === 'approve', JSON.stringify(resolved.partialAll));
    check('reject and return ignore the tick boxes',
      resolved.reject.decision === 'reject' && resolved.reject.approvedLineIds === undefined, JSON.stringify(resolved.reject));
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
