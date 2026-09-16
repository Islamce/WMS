#!/usr/bin/env node
'use strict';

// Only an explicitly selected, repo-local scratch database may be reset.
const fs = require('fs');
const path = require('path');

function resetTestDatabase(root, env = process.env) {
  const refuse = reason => { throw new Error(`REFUSING: ${reason}`); };
  if (env.NODE_ENV === 'production') refuse('NODE_ENV=production. This deletes the database.');
  if (!env.DB_PATH) refuse('DB_PATH must explicitly select a scratch database inside the repo.');
  if (/^(\/opt\/apps\/wms|\/app\/data)\//.test(env.DB_PATH)) refuse('DB_PATH is a production path.');
  root = fs.realpathSync(root);
  const requested = path.resolve(root, env.DB_PATH);
  // Resolve the parent too: a directory symlink must not escape the repository.
  const target = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    refuse('DB_PATH must stay inside the repo.');
  }
  const protectedPaths = ['', '-wal', '-shm'].map(suffix => path.join(root, 'data', `wms.db${suffix}`));
  const targets = ['', '-wal', '-shm'].map(suffix => target + suffix);
  // Validate the entire deletion set before deleting any file, including aliases.
  for (const file of targets) {
    if (protectedPaths.some(p => path.relative(p, file) === '')) refuse('data/wms.db and its siblings are protected.');
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1) refuse('Scratch database files must be regular files without hard links.');
  }
  for (const file of targets) fs.rmSync(file, { force: true });
}

if (require.main === module) {
  try {
    resetTestDatabase(path.resolve(__dirname, '..'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resetTestDatabase };
