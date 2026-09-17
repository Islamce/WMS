#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-company/registry.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'artifacts', 'agent-company');
const RESULTS_DIR = path.join(OUT_DIR, 'reasoning');
const CHECKPOINT_PATH = path.join(OUT_DIR, 'reasoning-checkpoint.json');
const DETERMINISTIC_PATH = path.join(OUT_DIR, 'deterministic-report.json');

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  return { ok: result.status === 0, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  return end === -1 ? markdown : markdown.slice(end + 5);
}

function loadCheckpoint(sha, selected) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const prior = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
      if (prior.sha === sha) {
        const pending = selected.filter((id) => !prior.completed.includes(id));
        return { ...prior, pending };
      }
    } catch { /* start fresh */ }
  }
  return {
    schemaVersion: '1.0.0',
    sha,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: [],
    pending: [...selected],
    providerFailures: [],
    results: {},
  };
}

function saveCheckpoint(checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

async function callGemini(systemPrompt, taskPrompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY not configured'), { unavailable: true });
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: taskPrompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 1000)}`);
    if ([429, 503].includes(response.status)) error.rateLimited = true;
    throw error;
  }
  const data = await response.json();
  const text = (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

async function callAnthropic(systemPrompt, taskPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;
  if (!key || !model) throw Object.assign(new Error('ANTHROPIC_API_KEY/ANTHROPIC_MODEL not configured'), { unavailable: true });
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 5000),
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: taskPrompt }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Anthropic HTTP ${response.status}: ${body.slice(0, 1000)}`);
    if ([429, 529].includes(response.status)) error.rateLimited = true;
    throw error;
  }
  const data = await response.json();
  const text = (data.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
  if (!text) throw new Error('Anthropic returned no text');
  return text;
}

async function callOllama(systemPrompt, taskPrompt) {
  const base = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL;
  if (!base || !model) throw Object.assign(new Error('OLLAMA_BASE_URL/OLLAMA_MODEL not configured'), { unavailable: true });
  const response = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: taskPrompt },
      ],
      options: { temperature: 0.1 },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 1000)}`);
    if ([429, 503].includes(response.status)) error.rateLimited = true;
    throw error;
  }
  const data = await response.json();
  const text = data.message?.content?.trim();
  if (!text) throw new Error('Ollama returned no text');
  return text;
}

const providers = {
  gemini: callGemini,
  anthropic: callAnthropic,
  ollama: callOllama,
};

function buildContext(deterministic) {
  const gitLog = run('git', ['log', '--oneline', '-8']).stdout;
  const changed = run('git', ['diff', '--name-status', 'HEAD~1..HEAD']).stdout;
  const kaafSummary = fs.existsSync(path.join(ROOT, '.ai', 'summary.md')) ? read('.ai/summary.md').slice(0, 25_000) : 'KAAF summary unavailable';
  const deterministicMd = fs.existsSync(path.join(OUT_DIR, 'deterministic-report.md'))
    ? fs.readFileSync(path.join(OUT_DIR, 'deterministic-report.md'), 'utf8').slice(0, 30_000)
    : JSON.stringify(deterministic, null, 2).slice(0, 30_000);
  return [
    '# KAAF architecture summary',
    kaafSummary,
    '# Deterministic company report',
    deterministicMd,
    '# Recent commits',
    gitLog,
    '# Last-commit changed paths',
    changed || '(none)',
  ].join('\n\n');
}

async function runAgent(agent, context, checkpoint) {
  const systemPrompt = stripFrontmatter(read(agent.prompt));
  const taskPrompt = `${context}\n\n# Your task\nReview only the evidence relevant to your specialist brief. Do not invent access to files or tools you were not given. Re-verify historical traps before calling them current. Return concise findings with severity/evidence and explicitly say CLEAN where appropriate.`;
  const providerOrder = REGISTRY.runtime.providerOrder || [];

  for (const providerName of providerOrder) {
    const provider = providers[providerName];
    if (!provider) continue;
    try {
      const text = await provider(systemPrompt, taskPrompt);
      const resultPath = path.join(RESULTS_DIR, `${agent.id}.md`);
      fs.writeFileSync(resultPath, `# ${agent.id}\n\nProvider: ${providerName}\n\n${text}\n`);
      checkpoint.completed.push(agent.id);
      checkpoint.pending = checkpoint.pending.filter((id) => id !== agent.id);
      checkpoint.results[agent.id] = { provider: providerName, path: path.relative(ROOT, resultPath) };
      saveCheckpoint(checkpoint);
      return true;
    } catch (error) {
      checkpoint.providerFailures.push({ agent: agent.id, provider: providerName, at: new Date().toISOString(), message: String(error.message || error).slice(0, 1200) });
      saveCheckpoint(checkpoint);
      if (error.unavailable || error.rateLimited) continue;
      continue;
    }
  }
  return false;
}

async function main() {
  if (!fs.existsSync(DETERMINISTIC_PATH)) {
    console.error('Run run-deterministic.js first. Reasoning never bypasses deterministic/KAAF governance.');
    process.exit(2);
  }
  const deterministic = JSON.parse(fs.readFileSync(DETERMINISTIC_PATH, 'utf8'));
  if (deterministic.governance?.kaaf !== 'PASS' || deterministic.governance?.registry !== 'PASS' || deterministic.blocking) {
    console.error('Reasoning blocked: KAAF/registry/deterministic gate is not green.');
    process.exit(2);
  }

  const sha = deterministic.sha;
  const requested = argValue('agents');
  const available = REGISTRY.agents.filter((agent) => agent.requiresReasoning);
  const selectedIds = requested ? requested.split(',').map((id) => id.trim()).filter(Boolean) : available.map((agent) => agent.id);
  const selected = available.filter((agent) => selectedIds.includes(agent.id));
  const missing = selectedIds.filter((id) => !selected.some((agent) => agent.id === id));
  if (missing.length) {
    console.error(`Unknown reasoning agents: ${missing.join(', ')}`);
    process.exit(2);
  }

  const checkpoint = loadCheckpoint(sha, selectedIds);
  const context = buildContext(deterministic);
  for (const agent of selected) {
    if (!checkpoint.pending.includes(agent.id)) continue;
    const completed = await runAgent(agent, context, checkpoint);
    if (!completed) {
      console.warn(`${agent.id}: no reasoning provider available; kept pending.`);
    }
  }

  checkpoint.finishedAt = checkpoint.pending.length ? null : new Date().toISOString();
  saveCheckpoint(checkpoint);
  console.log(`Reasoning completed: ${checkpoint.completed.length}; pending: ${checkpoint.pending.length}`);
  if (checkpoint.pending.length) {
    console.log('Deterministic company work remains valid; pending semantic reviews can resume from checkpoint when any provider is available.');
  }
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
