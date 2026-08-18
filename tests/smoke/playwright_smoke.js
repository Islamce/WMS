/**
 * Playwright browser smoke test.
 *
 * Boots the app against a fresh DB, drives a real Chromium through the two
 * things that must never break — the login page renders and an admin can sign
 * in and reach the app shell — and fails on any console error. This is the
 * fast browser-level guard that complements the API-level e2e suites.
 *
 * Runs in CI after `npx playwright install chromium`. Locally it reuses the
 * pre-installed browser via PLAYWRIGHT_BROWSERS_PATH. Set BASE_URL to point at
 * an already-running server; otherwise this script starts and stops its own.
 */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

/**
 * In this environment Chromium is pre-installed under PLAYWRIGHT_BROWSERS_PATH
 * but may be a different build number than the `playwright` package expects, so
 * point launch() straight at it. In CI (no such path) we return undefined and
 * let Playwright use the browser installed by `npx playwright install chromium`.
 */
function findChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return undefined;
  const entries = fs.readdirSync(base);
  // Prefer the headless-shell build: it implements the old headless mode this
  // Playwright build launches with, which the full chrome binary has removed.
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
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OWN_SERVER = !process.env.BASE_URL;

function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(BASE_URL + '/healthz', (r) => { r.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server did not become healthy'));
          else setTimeout(tick, 500);
        });
    };
    tick();
  });
}

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS:', name); }
  else { failed++; console.log('FAIL:', name, detail || ''); }
}

(async () => {
  let server;
  if (OWN_SERVER) {
    // Fresh DB so the run is deterministic.
    spawnSync('node', ['server/db/migrate.js'], { cwd: ROOT, stdio: 'ignore' });
    spawnSync('node', ['server/db/seed.js'], { cwd: ROOT, stdio: 'ignore' });
    server = spawn('node', ['index.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env } });
  }
  const cleanup = () => { if (server) try { process.kill(server.pid); } catch { /* already gone */ } };

  try {
    await waitForHealth();
    const executablePath = findChromiumExecutable();
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    // bypassCSP lets the test inject axe-core; the app's strict CSP still applies
    // to the app's own code — we only relax it for the test harness.
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    check('login form renders', await page.locator('#login-form').count() > 0);
    check('login email field present', await page.locator('#li-email').count() > 0);

    const releaseId = await page.locator('meta[name="kynox-release"]').getAttribute('content');
    const versionedAsset = await page.evaluate(async (id) => {
      const url = `/release-assets/${id}/js/pages/requestDetail.js`;
      const response = await fetch(url);
      const text = await response.text();
      return { url, status: response.status, marker: text.includes('Back to filtered requests') };
    }, releaseId);
    check('release marker is present', /^[0-9a-f]{7,40}$/.test(releaseId || ''), releaseId || 'missing');
    check('versioned request-detail asset is served', versionedAsset.status === 200 && versionedAsset.marker,
      `${versionedAsset.url} status=${versionedAsset.status} marker=${versionedAsset.marker}`);

    // Accessibility gate: no serious/critical WCAG 2.0 A/AA violations on the login page.
    await page.addScriptTag({ path: require.resolve('axe-core') });
    const axeResult = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
    const blocking = axeResult.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('no serious/critical a11y violations on login', blocking.length === 0,
      blocking.map((v) => `${v.impact}:${v.id}`).join(', '));

    // Sign in as the seeded admin (the login form is the second form on the page).
    await page.locator('#li-email').fill('admin@example.com');
    await page.locator('#li-password').fill('Admin@123456');
    await page.locator('#login-form button[type="submit"]').click();

    // The seeded admin is forced to change its default password on first login,
    // so a successful sign-in lands on either the forced-password screen or the
    // app shell — both mean auth worked and the login form is gone.
    await page.waitForTimeout(1500);
    const forcedPw = await page.locator('#fp-new').count() > 0;
    const shell = await page.locator('#menu-toggle, .sidebar, .layout, [data-nav]').first().count() > 0;
    check('authenticated view renders after login', forcedPw || shell, `forcedPw=${forcedPw} shell=${shell}`);
    check('login form no longer present', await page.locator('#login-form').count() === 0);
    check('no console errors during smoke', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    await browser.close();
  } catch (err) {
    check('smoke run completed', false, err.message);
  } finally {
    cleanup();
  }

  console.log(`\n===== SMOKE: ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
