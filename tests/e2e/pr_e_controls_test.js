'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');

const root = path.resolve(__dirname, '../..');
const fixtureParent = path.join(root, 'tenants');
fs.mkdirSync(fixtureParent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(fixtureParent, 'pr-e-guards-'));
const database = path.join(fixture, 'scratch.db');
const env = { ...process.env, DB_PATH: database, NODE_ENV: 'test',
  SKIP_AUTO_SEED: '1', SCHEDULER_ENABLED: '0', PORT: '3193' };
const base = 'http://127.0.0.1:3193';
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

async function main() {
  for (const script of ['server/db/migrate.js', 'server/db/seed.js']) {
    const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  process.env.DB_PATH = database;
  db = require('../../server/db/connection');

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


  const role = db.prepare("SELECT id FROM roles WHERE name='site_storekeeper'").get();
  assert.ok(role);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM role_permissions WHERE role_id=?').get(role.id).n, 12);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE role_id=?').get(role.id).n, 0);
  db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role.id);
  db.prepare('DELETE FROM roles WHERE id=?').run(role.id);
  const grants = db.prepare('SELECT * FROM role_permissions ORDER BY role_id, permission_id').all();
  const count = db.prepare('SELECT COUNT(*) n FROM roles').get().n;
  const migration = require('../../server/db/migrations').MIGRATIONS.find(m => m.id === '029_site_storekeeper_role');
  migration.up(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, count + 1);
  const created = db.prepare("SELECT id FROM roles WHERE name='site_storekeeper'").get().id;
  assert.deepEqual(db.prepare('SELECT * FROM role_permissions WHERE role_id<>? ORDER BY role_id, permission_id').all(created), grants);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM role_permissions WHERE role_id=?').get(created).n, 12);
  migration.up(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM role_permissions WHERE role_id=?').get(created).n, 12);
  console.log('PASS: additive role migration preserves all existing grants and is idempotent');
  const counter = (await call('POST', '/api/auth/login', {email:'supervisor@example.com',password:'Passw0rd!'})).token;
  const poster = (await call('POST', '/api/auth/login', {email:'whoperator@example.com',password:'Passw0rd!'})).token;
  const batch = db.prepare("SELECT * FROM batches WHERE warehouse_code='WH01' LIMIT 1").get();
  const cc = await call('POST','/api/cycle-count',{batch_id:batch.id},201,counter);
  await call('POST',`/api/cycle-count/${cc.id}/count`,{counted_quantity:batch.remaining_quantity+3},200,counter);
  await call('POST',`/api/cycle-count/${cc.id}/post`,{},403,counter);
  const freeze = await call('POST','/api/inventory',{session_type:'CYCLE',warehouse_code:'WH01',freeze_stock:true},201);
  await call('POST',`/api/cycle-count/${cc.id}/post`,{},400,poster);
  assert.equal(db.prepare('SELECT remaining_quantity n FROM batches WHERE id=?').get(batch.id).n,batch.remaining_quantity);
  await call('POST',`/api/inventory/${freeze.id}/cancel`,{});
  await call('POST',`/api/cycle-count/${cc.id}/post`,{},200,poster);
  const row = (await call('GET','/api/cycle-count')).counts.find(c=>c.id===cc.id);
  assert.ok(row.counted_by_name && row.posted_by_name && row.counted_by!==row.posted_by);
  assert.equal(db.prepare('SELECT remaining_quantity n FROM batches WHERE id=?').get(batch.id).n,batch.remaining_quantity+3);
  console.log('PASS: cycle count requires a second user, respects freeze, and identifies both users');
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
