#!/usr/bin/env node
'use strict';

/**
 * Bounded local performance smoke test for CI.
 * Safety: this script refuses non-local targets unless ALLOW_REMOTE_LOAD_TEST=1.
 */

const BASE = process.env.LOAD_BASE_URL || 'http://127.0.0.1:3000';
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 20);
const REQUESTS_PER_WORKER = Number(process.env.LOAD_REQUESTS_PER_WORKER || 30);
const P95_LIMIT_MS = Number(process.env.LOAD_P95_LIMIT_MS || 750);
const ERROR_RATE_LIMIT = Number(process.env.LOAD_ERROR_RATE_LIMIT || 0.01);

const target = new URL(BASE);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localHosts.has(target.hostname) && process.env.ALLOW_REMOTE_LOAD_TEST !== '1') {
  throw new Error('Remote load testing is blocked. Use localhost or explicitly set ALLOW_REMOTE_LOAD_TEST=1.');
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function request(path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, options);
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status, ms: performance.now() - started };
  } catch (error) {
    return { ok: false, status: 0, ms: performance.now() - started, error: error.message };
  }
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Admin@123456' }),
  });
  if (!response.ok) throw new Error(`Load-test login failed with ${response.status}`);
  const payload = await response.json();
  if (!payload.token) throw new Error('Load-test login returned no token');
  return payload.token;
}

async function main() {
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 100) {
    throw new Error('LOAD_CONCURRENCY must be an integer between 1 and 100');
  }
  if (!Number.isInteger(REQUESTS_PER_WORKER) || REQUESTS_PER_WORKER < 1 || REQUESTS_PER_WORKER > 500) {
    throw new Error('LOAD_REQUESTS_PER_WORKER must be an integer between 1 and 500');
  }

  const token = await login();
  const headers = { authorization: `Bearer ${token}` };
  const routes = [
    { path: '/healthz' },
    { path: '/' },
    { path: '/api/auth/me', headers },
    { path: '/api/dashboard', headers },
    { path: '/api/kpi', headers },
  ];

  const results = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, worker) => {
    for (let i = 0; i < REQUESTS_PER_WORKER; i += 1) {
      const route = routes[(worker + i) % routes.length];
      results.push(await request(route.path, { headers: route.headers || {} }));
    }
  }));
  const elapsedSeconds = (performance.now() - started) / 1000;

  const latency = results.map((r) => r.ms);
  const failures = results.filter((r) => !r.ok);
  const errorRate = failures.length / results.length;
  const summary = {
    requests: results.length,
    concurrency: CONCURRENCY,
    duration_seconds: Number(elapsedSeconds.toFixed(2)),
    requests_per_second: Number((results.length / elapsedSeconds).toFixed(2)),
    average_ms: Number((latency.reduce((a, b) => a + b, 0) / latency.length).toFixed(2)),
    p95_ms: Number(percentile(latency, 0.95).toFixed(2)),
    max_ms: Number(Math.max(...latency).toFixed(2)),
    failures: failures.length,
    error_rate: Number(errorRate.toFixed(4)),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length) console.error('Failure sample:', failures.slice(0, 10));
  if (summary.p95_ms > P95_LIMIT_MS) {
    throw new Error(`p95 ${summary.p95_ms}ms exceeds ${P95_LIMIT_MS}ms`);
  }
  if (errorRate > ERROR_RATE_LIMIT) {
    throw new Error(`error rate ${errorRate} exceeds ${ERROR_RATE_LIMIT}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
