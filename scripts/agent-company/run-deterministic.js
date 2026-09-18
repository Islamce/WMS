#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(ROOT, '.agent-company', 'registry.json');
const args = new Set(process.argv.slice(2));
const FULL = args.has('--full');
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, outArg ? outArg.slice('--out-dir='.length) : 'artifacts/agent-company');

const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || 'Islamce/WMS',
  sha: null,
  mode: FULL ? 'full' : 'fast',
  governance: { kaaf: 'UNKNOWN', registry: 'UNKNOWN', providerIndependent: true },
  checks: [],
  findings: [],
  reasoningQueue: [],
  blocking: false,
};

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 12 * 60 * 1000,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function addCheck(id, ok, summary, evidence = '', blocking = false) {
  report.checks.push({ id, status: ok ? 'PASS' : 'FAIL', summary, evidence });
  if (!ok && blocking) report.blocking = true;
}

function addFinding(priority, id, summary, evidence, owner) {
  report.findings.push({ priority, id, summary, evidence, owner });
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function gitSha() {
  const result = run('git', ['rev-parse', 'HEAD'], { timeout: 30_000 });
  report.sha = result.ok ? result.stdout : process.env.GITHUB_SHA || 'UNKNOWN';
}

function validateRegistry() {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    addCheck('registry-integrity', false, 'Agent registry cannot be parsed.', String(error), true);
    return null;
  }

  const ids = new Set();
  const errors = [];
  if (registry.governance?.architectureAuthority !== 'KAAF') errors.push('architectureAuthority must be KAAF');
  if (registry.runtime?.controller !== 'agent-company-runtime') errors.push('controller must be agent-company-runtime');
  if (!Array.isArray(registry.agents) || registry.agents.length < 1) errors.push('agents[] is empty');

  for (const agent of registry.agents || []) {
    if (!agent.id || ids.has(agent.id)) errors.push(`duplicate/missing agent id: ${agent.id || '(missing)'}`);
    ids.add(agent.id);
    if (!agent.prompt || !fs.existsSync(path.join(ROOT, agent.prompt))) errors.push(`${agent.id}: prompt missing: ${agent.prompt}`);
    if (!['none', 'docs/vault/**'].includes(agent.writeScope)) errors.push(`${agent.id}: unsupported writeScope ${agent.writeScope}`);
  }

  addCheck(
    'registry-integrity',
    errors.length === 0,
    errors.length ? 'Agent registry has governance errors.' : `Agent registry valid (${registry.agents.length} agents).`,
    errors.join('\n'),
    true,
  );
  report.governance.registry = errors.length ? 'FAIL' : 'PASS';

  for (const agent of registry.agents || []) {
    if (agent.requiresReasoning) report.reasoningQueue.push(agent.id);
  }
  return registry;
}

function checkProviderIndependence() {
  const companyReadme = read('.claude/agents/README.md');
  const soleClaudeController = /Top-level Claude session \(controller\)/i.test(companyReadme);
  addCheck(
    'provider-independence',
    !soleClaudeController,
    soleClaudeController
      ? 'Company documentation still makes a top-level Claude session the sole controller.'
      : 'Company runtime is not documented as dependent on Claude approval.',
    soleClaudeController ? '.claude/agents/README.md still contains the old controller statement.' : '',
    true,
  );
}

function checkKaaf() {
  const freshness = run('python3', ['scripts/architecture/generate.py', '--check']);
  addCheck(
    'kaaf-freshness',
    freshness.ok,
    freshness.ok ? 'KAAF generated context is current.' : 'KAAF generated context is stale.',
    freshness.ok ? freshness.stdout : `${freshness.stdout}\n${freshness.stderr}`.trim(),
    true,
  );
  report.governance.kaaf = freshness.ok ? 'PASS' : 'FAIL';

  const driftPath = path.join(ROOT, '.ai', 'drift.json');
  if (!fs.existsSync(driftPath)) {
    addCheck('kaaf-drift', false, 'KAAF drift report is missing.', '.ai/drift.json', true);
    return;
  }
  try {
    const drift = JSON.parse(fs.readFileSync(driftPath, 'utf8'));
    const errors = (drift.findings || []).filter((f) => f.severity === 'error');
    addCheck(
      'kaaf-drift',
      errors.length === 0,
      errors.length ? `KAAF reports ${errors.length} architecture error(s).` : 'KAAF reports no architecture errors.',
      errors.map((f) => `${f.summary}: ${f.recommendation || ''}`).join('\n'),
      true,
    );
  } catch (error) {
    addCheck('kaaf-drift', false, 'KAAF drift report cannot be parsed.', String(error), true);
  }
}

function secretScan() {
  const tracked = run('git', ['ls-files']);
  if (!tracked.ok) {
    addCheck('secret-pattern-scan', false, 'Cannot enumerate tracked files for secret scan.', tracked.stderr, true);
    return;
  }
  const allowedExtensions = new Set([
    '.js', '.json', '.md', '.yml', '.yaml', '.py', '.dart', '.html', '.css', '.sh', '.txt', '.toml', '.xml', '.gradle', '.properties', '.env',
  ]);
  const patterns = [
    { name: 'Google-style AQ key', regex: /AQ\.[A-Za-z0-9_-]{30,}/g },
    { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
    { name: 'OpenAI-style key', regex: /sk-[A-Za-z0-9_-]{20,}/g },
  ];
  const hits = [];
  for (const relative of tracked.stdout.split('\n').filter(Boolean)) {
    const full = path.join(ROOT, relative);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile() || stat.size > 750_000) continue;
    const ext = path.extname(relative).toLowerCase();
    if (!allowedExtensions.has(ext) && !['Dockerfile', 'Caddyfile'].includes(path.basename(relative))) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    for (const pattern of patterns) {
      if (pattern.regex.test(text)) hits.push(`${relative}: ${pattern.name}`);
      pattern.regex.lastIndex = 0;
    }
  }
  addCheck(
    'secret-pattern-scan',
    hits.length === 0,
    hits.length ? 'Potential API secret committed in tracked text.' : 'No high-confidence API key pattern found in tracked text.',
    hits.join('\n'),
    true,
  );
}

function knownPolicyRegressionChecks() {
  const analyticsPath = 'server/routes/analytics.js';
  if (fs.existsSync(path.join(ROOT, analyticsPath))) {
    const text = read(analyticsPath);
    if (text.includes("requirePermission('ai_analytics')") && !text.includes('requireModule(')) {
      addFinding(
        'P1',
        'edition-api-parity-analytics',
        'Analytics API is permission-gated but not edition/module-gated; UI/commercial entitlement can drift from API reachability.',
        analyticsPath,
        'wms-architecture + wms-security + wms-product',
      );
    }
  }

  const mobileSession = 'wms flutter application/lib/core/session.dart';
  if (fs.existsSync(path.join(ROOT, mobileSession))) {
    const text = read(mobileSession);
    if (/embedded, not user-editable/i.test(text) && /https:\/\/wms\.kynox\.io/.test(text)) {
      addFinding(
        'P1',
        'mobile-server-target',
        'Flutter still embeds the production server as a non-editable target, blocking safe mutating UAT on a demo/test tenant.',
        mobileSession,
        'wms-mobile + wms-qa + wms-ops',
      );
    }
  }
}

function runFullDeterministicSuite() {
  if (!FULL) return;
  const commands = [
    ['syntax', 'bash', ['-lc', "find server public/js index.js tests/load scripts/agent-company -name '*.js' -print0 | xargs -0 -n1 node --check"]],
    ['lint', 'npm', ['run', 'lint']],
    ['dependency-audit', 'npm', ['audit', '--omit=dev', '--audit-level=high']],
    ['e2e-tests', 'npm', ['test']],
  ];
  for (const [id, command, commandArgs] of commands) {
    const result = run(command, commandArgs);
    addCheck(
      id,
      result.ok,
      result.ok ? `${id} passed.` : `${id} failed.`,
      (result.ok ? result.stdout : `${result.stdout}\n${result.stderr}`).slice(-12_000),
      true,
    );
  }
}

async function checkGithubGovernance() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return;
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${repo}/branches/main`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const branch = await response.json();
    if (!branch.protected) {
      addFinding(
        'P1',
        'main-branch-unprotected',
        'GitHub main branch is not protected; deterministic CI can be bypassed by a direct push.',
        `GET /repos/${repo}/branches/main -> protected=false`,
        'wms-ops + wms-security',
      );
    }
    addCheck('github-governance-read', true, 'GitHub branch governance state read successfully.', `main protected=${branch.protected}`);
  } catch (error) {
    addCheck('github-governance-read', false, 'Could not read GitHub branch governance state.', String(error), false);
  }
}

function writeReports() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  report.findings.sort((a, b) => ['P0', 'P1', 'P2'].indexOf(a.priority) - ['P0', 'P1', 'P2'].indexOf(b.priority));
  fs.writeFileSync(path.join(OUT_DIR, 'deterministic-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# KYNOX WMS Deterministic Company Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- SHA: \`${report.sha}\``,
    `- Mode: **${report.mode}**`,
    `- KAAF: **${report.governance.kaaf}**`,
    `- Registry: **${report.governance.registry}**`,
    `- Blocking deterministic failure: **${report.blocking ? 'YES' : 'NO'}**`,
    '',
    '## Deterministic checks',
    '',
    '| Check | Status | Summary |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.id} | ${c.status} | ${String(c.summary).replace(/\|/g, '\\|')} |`),
    '',
    '## Current findings',
    '',
  ];
  if (report.findings.length === 0) lines.push('NO MATERIAL DETERMINISTIC FINDING');
  for (const finding of report.findings) {
    lines.push(`### ${finding.priority} — ${finding.id}`);
    lines.push(finding.summary);
    lines.push(`- Evidence: ${finding.evidence}`);
    lines.push(`- Owner: ${finding.owner}`);
    lines.push('');
  }
  lines.push('## Reasoning queue');
  lines.push('');
  lines.push('These roles are queued for semantic review when any reasoning provider is available. Deterministic work does not wait for them.');
  lines.push('');
  for (const id of report.reasoningQueue) lines.push(`- ${id}`);
  lines.push('');
  lines.push('## Governance');
  lines.push('');
  lines.push('KAAF remains the architecture authority. Reasoning providers are advisory and cannot mutate production. Provider limits do not stop deterministic checks; pending reasoning work is checkpointed by the reasoning runtime.');
  fs.writeFileSync(path.join(OUT_DIR, 'deterministic-report.md'), `${lines.join('\n')}\n`);
}

async function main() {
  gitSha();
  validateRegistry();
  checkProviderIndependence();
  checkKaaf();
  secretScan();
  knownPolicyRegressionChecks();
  runFullDeterministicSuite();
  await checkGithubGovernance();
  writeReports();
  console.log(fs.readFileSync(path.join(OUT_DIR, 'deterministic-report.md'), 'utf8'));
  process.exitCode = report.blocking ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
