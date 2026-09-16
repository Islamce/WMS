'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/production-release.yml'), 'utf8'));
const steps = workflow.jobs.deploy.steps;
const health = steps.find(step => step.id === 'health');
assert.ok(health, 'Release workflow has a health gate');
const wanted = 'a'.repeat(40);
const script = health.run.replaceAll('${{ inputs.release_ref }}', wanted);
const mocks = `curl() { printf '%s' "$WMS_GATE_BODY"; }; sleep() { :; };\n`;
for (const [label, body, expected] of [
  ['requested build', JSON.stringify({ status: 'ok', release: wanted }), 0],
  ['old healthy build', JSON.stringify({ status: 'ok', release: 'b'.repeat(40) }), 1],
  ['health without build', JSON.stringify({ status: 'ok' }), 1],
  ['invalid response', '<html>unavailable</html>', 1],
]) {
  const result = spawnSync('bash', ['-c', mocks + script], {
    cwd: root, env: { ...process.env, HEALTH_URL: 'mock://health', WMS_GATE_BODY: body }, encoding: 'utf8',
  });
  assert.equal(result.status, expected, `${label}: ${result.stdout}\n${result.stderr}`);
  console.log(`PASS: release gate ${expected ? 'rejects' : 'accepts'} ${label}`);
}

const rollback = steps.find(step => step.name === 'Roll back').run;
assert.ok(rollback.includes('steps.keep_image.outputs.image_ref'), 'Rollback restores the captured image reference');
assert.ok(rollback.includes('--no-build --force-recreate'), 'Rollback recreates from the saved image');
assert.ok(!rollback.includes('docker compose build'), 'Rollback never rebuilds over the network');
assert.ok(steps.find(step => step.id === 'backup').run.includes('GITHUB_STEP_SUMMARY'), 'Backup manifest reaches the job summary');
for (const step of steps.filter(step => step.run)) {
  const parsed = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
  assert.equal(parsed.status, 0, `${step.name}: ${parsed.stderr}`);
}
console.log('PASS: rollback, backup summary and workflow shell syntax');
