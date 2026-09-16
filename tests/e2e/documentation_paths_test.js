'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const missing = new Map();
let checked = 0;
for (const file of files) {
  if (!file.startsWith('.ai/') && !/\.(?:js|py|sh|dart|kts|ya?ml|json)$/.test(file)) continue;
  if (file.startsWith('docs/') || !fs.existsSync(path.join(root, file))) continue;
  const contents = fs.readFileSync(path.join(root, file), 'utf8');
  // Literal repository documentation paths; wildcards and interpolated paths are not citations.
  for (const match of contents.matchAll(/\bdocs\/[A-Za-z0-9_./-]+/g)) {
    const target = match[0].replace(/[.,]+$/, '');
    if (!target.endsWith('/') && !path.posix.extname(target)) continue;
    checked++;
    if (!fs.existsSync(path.join(root, target))) {
      if (!missing.has(target)) missing.set(target, new Set());
      missing.get(target).add(file);
    }
  }
}
assert.equal(missing.size, 0, `Missing documentation paths:\n${[...missing].map(([target, sources]) => `${target}: ${[...sources].join(', ')}`).join('\n')}`);
console.log(`PASS: ${checked} documentation path citations exist`);
