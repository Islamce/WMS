'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resetTestDatabase } = require('../reset-test-db');

const root = fs.mkdtempSync(path.join(__dirname, 'guard-fixture-'));
fs.mkdirSync(path.join(root, 'data'));
const scratch = path.join(root, 'data', 'scratch.db');
const files = ['', '-wal', '-shm'].map(suffix => scratch + suffix);
try {
  files.forEach(file => fs.writeFileSync(file, 'sentinel'));
  const refused = env => {
    assert.throws(() => resetTestDatabase(root, env), /REFUSING:/);
    files.forEach(file => assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel'));
  };
  refused({});
  refused({ DB_PATH: scratch, NODE_ENV: 'production' });
  refused({ DB_PATH: '/app/data/wms.db' });
  refused({ DB_PATH: '/opt/apps/wms/data/wms.db' });
  refused({ DB_PATH: path.join(root, '..', 'outside.db') });
  for (const suffix of ['', '-wal', '-shm']) {
    refused({ DB_PATH: path.join(root, 'data', `wms.db${suffix}`) });
  }
  const alias = path.join(root, 'data', 'alias.db');
  fs.linkSync(scratch, alias);
  refused({ DB_PATH: alias });
  fs.unlinkSync(alias);
  for (const guardedEnv of [
    { NODE_ENV: 'production', DB_PATH: scratch },
    { NODE_ENV: 'test', DB_PATH: '/app/data/wms.db' },
    { NODE_ENV: 'test', DB_PATH: '/opt/apps/wms/data/wms.db' },
  ]) {
    const result = spawnSync(process.execPath, ['server/db/seed.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, ...guardedEnv }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REFUSING:/, 'Seeder refuses before loading its database connection');
    files.forEach(file => assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel'));
  }
  resetTestDatabase(root, { DB_PATH: scratch });
  files.forEach(file => assert.equal(fs.existsSync(file), false));
  console.log('PASS: test database guard refuses unsafe paths and resets only scratch files');
} finally {
  // This is a freshly generated fixture directory, never the application data directory.
  fs.rmSync(root, { recursive: true, force: true });
}
