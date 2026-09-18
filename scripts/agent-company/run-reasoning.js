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
const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_PROVIDER_TIMEOUT_MS || 30_000);
const MAX_PROVIDER_ATTEMPTS = Math.max(1, Number(process.env.AGENT_PROVIDER_MAX_ATTEMPTS || 1));
const RETRY_BASE_MS = Math.max(500, Number(process.env.AGENT_PROVIDER_RETRY_BASE_MS || 3_000));
const AGENT_PACING_MS = Math.max(0, Number(process.env.AGENT_PROVIDER_PACING_MS || 3_000));
const BATCH_SIZE = Math.max(1, Number(process.env.AGENT_REASONING_BATCH_SIZE || 2));
const STOP_BATCH_ON_PROVIDER_LIMIT = String(process.env.AGENT_STOP_BATCH_ON_PROVIDER_LIMIT || 'true').toLowerCase() !== 'false';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Provider request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutError.retryable = true;
      timeoutError.providerLimited = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
        const completed = Array.isArray(prior.completed) ? prior.completed : [];
        const pending = selected.filter((id) => !completed.includes(id));
        return { ...prior, completed, pending };
      }
      console.log(`Ignoring checkpoint for stale SHA ${prior.sha}; current SHA is ${sha}.`);
    } catch { /* start fresh */ }
  }
  return {
    schemaVersion: '1.2.0',
    sha,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: [],
    pending: [...selected],
    providerFailures: [],
    results: {},
    lastBatch: null,
  };
}

function saveCheckpoint(checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function annotateRetry(error, body, response) {
  const retryHeader = response?.headers?.get?.('retry-after');
  if (retryHeader && /^\d+(\.\d+)?$/.test(retryHeader)) {
    error.retryAfterMs = Math.ceil(Number(retryHeader) * 1000);
  }
  const retryMatch = String(body || '').match(/Please retry in\s+([0-9.]+)s/i);
  if (retryMatch) error.retryAfterMs = Math.ceil(Number(retryMatch[1]) * 1000);
  return error;
}

async function callGemini(systemPrompt, taskPrompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY not configured'), { unavailable: true });
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(url, {
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
    const error = annotateRetry(new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 1000)}`), body, response);
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      error.retryable = true;
      error.providerLimited = true;
    }
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
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
    const error = annotateRetry(new Error(`Anthropic HTTP ${response.status}: ${body.slice(0, 1000)}`), body, response);
    if ([429, 500, 502, 503, 504, 529].includes(response.status)) {
      error.retryable = true;
      error.providerLimited = true;
    }
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
  const response = await fetchWithTimeout(`${base.replace(/\/$/, '')}/api/chat`, {
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
    const error = annotateRetry(new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 1000)}`), body, response);
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      error.retryable = true;
      error.providerLimited = true;
    }
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

function completedReasoningContext(checkpoint) {
  const sections = [];
  for (const [agentId, result] of Object.entries(checkpoint.results || {})) {
    if (agentId === 'wms-chief-of-staff') continue;
    const absolute = path.join(ROOT, result.path || '');
    if (!result.path || !fs.existsSync(absolute)) continue;
    sections.push(fs.readFileSync(absolute, 'utf8').slice(0, 8_000));
  }
  return sections.length ? sections.join('\n\n---\n\n') : '(No specialist reasoning reports completed yet.)';
}

function buildContext(deterministic, checkpoint, includeSpecialists = false) {
  const gitLog = run('git', ['log', '--oneline', '-8']).stdout;
  const changed = run('git', ['diff', '--name-status', 'HEAD~1..HEAD']).stdout;
  const kaafSummary = fs.existsSync(path.join(ROOT, '.ai', 'summary.md')) ? read('.ai/summary.md').slice(0, 25_000) : 'KAAF summary unavailable';
  const deterministicMd = fs.existsSync(path.join(OUT_DIR, 'deterministic-report.md'))
    ? fs.readFileSync(path.join(OUT_DIR, 'deterministic-report.md'), 'utf8').slice(0, 30_000)
    : JSON.stringify(deterministic, null, 2).slice(0, 30_000);
  const parts = [
    '# KAAF architecture summary',
    kaafSummary,
    '# Deterministic company report',
    deterministicMd,
    '# Recent commits',
    gitLog,
    '# Last-commit changed paths',
    changed || '(none)',
  ];
  if (includeSpecialists) {
    parts.push('# Completed specialist reports', completedReasoningContext(checkpoint));
    parts.push('# Still-pending specialist roles', checkpoint.pending.filter((id) => id !== 'wms-chief-of-staff').join(', ') || '(none)');
  }
  return parts.join('\n\n');
}

function recordFailure(checkpoint, agentId, providerName, attempt, error) {
  checkpoint.providerFailures.push({
    agent: agentId,
    provider: providerName,
    attempt,
    at: new Date().toISOString(),
    retryAfterMs: error.retryAfterMs || null,
    providerLimited: Boolean(error.providerLimited),
    message: String(error.message || error).slice(0, 1200),
  });
  saveCheckpoint(checkpoint);
}

async function tryProvider(agentId, providerName, provider, systemPrompt, taskPrompt, checkpoint) {
  let providerLimited = false;
  let retryAfterMs = null;
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      console.log(`${agentId}: ${providerName} attempt ${attempt}/${MAX_PROVIDER_ATTEMPTS}`);
      const text = await provider(systemPrompt, taskPrompt);
      return { text, providerLimited: false, retryAfterMs: null };
    } catch (error) {
      providerLimited = providerLimited || Boolean(error.providerLimited);
      retryAfterMs = Math.max(Number(retryAfterMs || 0), Number(error.retryAfterMs || 0)) || null;
      recordFailure(checkpoint, agentId, providerName, attempt, error);
      if (error.unavailable) return { text: null, providerLimited, retryAfterMs };
      if (!error.retryable || attempt === MAX_PROVIDER_ATTEMPTS) return { text: null, providerLimited, retryAfterMs };
      const exponentialDelay = RETRY_BASE_MS * (2 ** (attempt - 1));
      const providerDelay = Number(error.retryAfterMs || 0);
      const delay = Math.max(exponentialDelay, providerDelay) + 1000;
      console.warn(`${agentId}: ${providerName} temporary failure; retrying after ${delay}ms.`);
      await sleep(delay);
    }
  }
  return { text: null, providerLimited, retryAfterMs };
}

async function runAgent(agent, context, checkpoint) {
  const systemPrompt = stripFrontmatter(read(agent.prompt));
  const taskPrompt = `${context}\n\n# Your task\nReview only the evidence relevant to your specialist brief. Do not invent access to files or tools you were not given. Re-verify historical traps before calling them current. Return concise findings with severity/evidence and explicitly say CLEAN where appropriate.`;
  const providerOrder = REGISTRY.runtime.providerOrder || [];
  let providerLimited = false;
  let retryAfterMs = null;

  for (const providerName of providerOrder) {
    const provider = providers[providerName];
    if (!provider) continue;
    const outcome = await tryProvider(agent.id, providerName, provider, systemPrompt, taskPrompt, checkpoint);
    providerLimited = providerLimited || outcome.providerLimited;
    retryAfterMs = Math.max(Number(retryAfterMs || 0), Number(outcome.retryAfterMs || 0)) || null;
    if (!outcome.text) continue;

    const resultPath = path.join(RESULTS_DIR, `${agent.id}.md`);
    fs.writeFileSync(resultPath, `# ${agent.id}\n\nProvider: ${providerName}\n\n${outcome.text}\n`);
    if (!checkpoint.completed.includes(agent.id)) checkpoint.completed.push(agent.id);
    checkpoint.pending = checkpoint.pending.filter((id) => id !== agent.id);
    checkpoint.results[agent.id] = { provider: providerName, path: path.relative(ROOT, resultPath) };
    saveCheckpoint(checkpoint);
    console.log(`${agent.id}: completed with ${providerName}`);
    return { completed: true, providerLimited: false, retryAfterMs: null };
  }
  return { completed: false, providerLimited, retryAfterMs };
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
  const chief = selected.find((agent) => agent.id === 'wms-chief-of-staff');
  const specialists = selected.filter((agent) => agent.id !== 'wms-chief-of-staff');
  const specialistContext = buildContext(deterministic, checkpoint, false);
  let attempted = 0;
  let completedThisBatch = 0;
  let stoppedOnProviderLimit = false;
  let retryAfterMs = null;

  for (const agent of specialists) {
    if (!checkpoint.pending.includes(agent.id)) continue;
    if (attempted >= BATCH_SIZE) break;
    attempted += 1;
    const outcome = await runAgent(agent, specialistContext, checkpoint);
    if (outcome.completed) completedThisBatch += 1;
    if (!outcome.completed) {
      console.warn(`${agent.id}: no reasoning provider completed; kept pending.`);
    }
    if (outcome.providerLimited && STOP_BATCH_ON_PROVIDER_LIMIT) {
      stoppedOnProviderLimit = true;
      retryAfterMs = outcome.retryAfterMs || null;
      console.warn(`${agent.id}: provider limited; stopping this short batch so the checkpoint can resume in a later run.`);
      break;
    }
    if (AGENT_PACING_MS > 0 && attempted < BATCH_SIZE) await sleep(AGENT_PACING_MS);
  }

  const remainingSpecialists = specialists.filter((agent) => checkpoint.pending.includes(agent.id));
  if (chief && remainingSpecialists.length === 0 && checkpoint.pending.includes(chief.id)) {
    const chiefContext = buildContext(deterministic, checkpoint, true);
    const outcome = await runAgent(chief, chiefContext, checkpoint);
    if (outcome.completed) completedThisBatch += 1;
    if (!outcome.completed) {
      console.warn(`${chief.id}: no reasoning provider completed; kept pending.`);
    }
    if (outcome.providerLimited) {
      stoppedOnProviderLimit = true;
      retryAfterMs = outcome.retryAfterMs || retryAfterMs;
    }
  } else if (chief && checkpoint.pending.includes(chief.id)) {
    console.log(`Chief of Staff deferred until all ${remainingSpecialists.length} pending specialist review(s) complete.`);
  }

  checkpoint.lastBatch = {
    at: new Date().toISOString(),
    attempted,
    completed: completedThisBatch,
    stoppedOnProviderLimit,
    retryAfterMs,
    batchSize: BATCH_SIZE,
  };
  checkpoint.finishedAt = checkpoint.pending.length ? null : new Date().toISOString();
  saveCheckpoint(checkpoint);
  console.log(`Reasoning completed total: ${checkpoint.completed.length}; pending: ${checkpoint.pending.length}; attempted this batch: ${attempted}.`);
  if (checkpoint.pending.length) {
    console.log('Deterministic company work remains valid; pending semantic reviews will resume from checkpoint on a later run/provider.');
  }
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
