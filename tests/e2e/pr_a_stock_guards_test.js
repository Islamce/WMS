'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');

const root = path.resolve(__dirname, '../..');
const fixtureParent = path.join(root, 'tenants');
fs.mkdirSync(fixtureParent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(fixtureParent, 'pr-a-guards-'));
const database = path.join(fixture, 'scratch.db');
const env = { ...process.env, DB_PATH: database, NODE_ENV: 'test',
  SKIP_AUTO_SEED: '1', SCHEDULER_ENABLED: '0', PORT: '3191' };
const base = 'http://127.0.0.1:3191';
let server;
let db;
let token;

async function call(method, route, body, expected = 200, bearer = token) {
  const response = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${route}: ${text}`);
  return text.startsWith('{') ? JSON.parse(text) : {};
}

async function openFreeze() {
  const result = await call('POST', '/api/inventory', {
    session_type: 'CYCLE', warehouse_code: 'WH01', freeze_stock: true,
  }, 201);
  return result.id;
}

async function frozen(route, body) {
  const result = await call('POST', route, body, 400);
  assert.match(result.error, /frozen for physical inventory/);
}

async function request(materialId) {
  const result = await call('POST', '/api/requests', {
    purpose: 'PR A regression', plant: 'P100', issue_warehouse_code: 'WH01',
    lines: [{ material_id: materialId, requested_quantity: 5 }],
  }, 201);
  await call('POST', `/api/requests/${result.id}/submit`);
  await call('POST', `/api/approvals/${result.id}/decision`, { decision: 'approve' });
  return result.id;
}

async function main() {
  for (const script of ['server/db/migrate.js', 'server/db/seed.js']) {
    const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  process.env.DB_PATH = database;
  db = require('../../server/db/connection');
  db.prepare("INSERT OR REPLACE INTO tenant_profile (id,tenant_name,industry_profile) VALUES (1,'Guard fixture','contracting')").run();
  db.prepare("UPDATE warehouses SET is_active=0 WHERE warehouse_code <> 'WH01'").run();
  server = spawn(process.execPath, ['index.js'], { cwd: root, env, stdio: 'ignore' });
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) });
      if (response.ok) { healthy = true; break; }
    } catch { /* Wait for this fixture's server. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(healthy, 'Fixture server started');
  token = (await call('POST', '/api/auth/login', {
    email: 'admin@example.com', password: 'Admin@123456',
  })).token;

  const signupEmail = 'signup-guard@example.com';
  const signup = await fetch(base + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Signup guard', email: signupEmail, password: 'GuardOnly!2026' }),
    signal: AbortSignal.timeout(10000),
  });
  await signup.text();
  assert.ok(signup.status >= 400 && signup.status < 500, 'Unauthenticated registration is rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get(signupEmail).n, 0,
    'Registration cannot create an account');
  const role = db.prepare("SELECT id FROM roles WHERE name='user'").get();
  const forbidden = db.prepare(`SELECT COUNT(*) AS n FROM role_permissions rp
    JOIN permissions p ON p.id=rp.permission_id
    WHERE rp.role_id=? AND p.key IN ('stock_in','stock_out')`).get(role.id);
  assert.equal(forbidden.n, 0, 'Default role has no legacy stock mutation grants');
  console.log('PASS: PR A signup is closed and the default role has no legacy stock grants');

  const bolt = db.prepare("SELECT id FROM materials WHERE item_code='MAT-0001'").get();
  const rid = await request(bolt.id);
  let freeze = await openFreeze();
  await frozen(`/api/picking/requests/${rid}/claim`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM picking_tasks WHERE request_id=?').get(rid).n, 0);
  console.log('PASS: PR A frozen claim is refused without creating a task');
  await call('POST', `/api/inventory/${freeze}/cancel`);
  const claim = await call('POST', `/api/picking/requests/${rid}/claim`);
  const task = await call('GET', `/api/picking/tasks/${claim.task_id}`);
  for (const allocation of task.allocations) {
    const qr = await call('GET', `/api/receiving/qr?search=${encodeURIComponent(allocation.batch_number)}`);
    await call('POST', `/api/picking/allocations/${allocation.id}/scan`, { qr_value: qr.qr_codes[0].qr_code_value });
  }
  const quantity = () => db.prepare('SELECT SUM(remaining_quantity) AS n FROM batches WHERE material_id=?').get(bolt.id).n;
  const beforePick = quantity();
  freeze = await openFreeze();
  await frozen(`/api/picking/lines/${task.lines[0].id}/confirm`, { picked_quantity: 5 });
  assert.equal(quantity(), beforePick);
  console.log('PASS: PR A frozen pick is refused without reducing stock');
  await call('POST', `/api/inventory/${freeze}/cancel`);
  await call('POST', `/api/picking/lines/${task.lines[0].id}/confirm`, { picked_quantity: 5 });
  await call('POST', `/api/picking/tasks/${claim.task_id}/complete`);
  freeze = await openFreeze();
  const issues = () => db.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE transaction_type='OUT'").get().n;
  const beforeIssue = issues();
  await frozen(`/api/gi/${rid}/post`, {});
  assert.equal(issues(), beforeIssue);
  console.log('PASS: PR A frozen GI is refused without writing an issue');
  await call('POST', `/api/inventory/${freeze}/cancel`);
  await call('POST', `/api/gi/${rid}/post`, {});
  assert.ok(issues() > beforeIssue, 'The same workflow succeeds after unfreezing');

  const nut = db.prepare("SELECT id FROM materials WHERE item_code='MAT-0002'").get();
  const owner = await call('POST', '/api/subcontractor/subcontractors', { name: 'Guard subcontractor', trade_category: 'Steel' }, 201);
  const receipt = await call('POST', '/api/receiving', {
    material_id: nut.id, received_quantity: 10, warehouse_code: 'WH01',
    owner_type: 'SUBCONTRACTOR', owner_subcontractor_id: owner.id, delivery_note: 'GUARD-001',
  }, 201);
  await call('POST', `/api/master/batches/${receipt.batch_id}/quality`, { quality_status: 'RELEASED', reason: 'Guard fixture inspection' });
  const companyRequest = await request(nut.id);
  const proposal = require('../../server/services/allocation').propose({ materialId: nut.id, warehouseCode: 'WH01', quantity: 5 });
  assert.equal(proposal.shortfall, 5, 'Company request has a full shortfall despite released subcontractor stock');
  assert.equal(proposal.allocations.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM picking_allocations WHERE request_id=?').get(companyRequest).n, 0);
  console.log('PASS: PR A company request cannot allocate released subcontractor property');
}

main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  if (db) db.close();
  assert.ok(fixture.startsWith(fixtureParent + path.sep));
  fs.rmSync(fixture, { recursive: true, force: true });
});
