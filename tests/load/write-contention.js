#!/usr/bin/env node
'use strict';

/**
 * Write-contention load test — what actually decides whether SQLite is enough.
 *
 * tests/load/smoke-load.js exercises four READ endpoints. That measures the
 * dimension SQLite was never at risk on: in WAL mode readers do not block each
 * other or the writer. SQLite serialises WRITERS, so a read-only load test
 * cannot find the ceiling, however large you make it.
 *
 * This drives concurrent WRITES through POST /api/stock/in, whose transaction
 * upserts material_location_stock and appends a stock_transactions row — real
 * contention on a shared row, which is the worst realistic case.
 *
 * TWO MODES, because they bracket the real world:
 *   --contention same    every worker writes the SAME material+location.
 *                        Maximum row contention; the pessimistic bound.
 *   --contention spread  workers write different materials (default).
 *                        Table/WAL-level contention only; the realistic case
 *                        for a site store where storekeepers handle different
 *                        items.
 *
 * WHAT TO READ IN THE OUTPUT. better-sqlite3 defaults busy_timeout to 5000ms, so
 * a contended database goes SLOW long before it goes WRONG: requests queue up to
 * five seconds and only then fail. Judging by mean latency therefore hides the
 * problem entirely. The headline numbers are p99 and the SQLITE_BUSY count.
 *
 * Safety: refuses any non-local target unless ALLOW_REMOTE_LOAD_TEST=1. Never
 * point this at a customer's deployment — it writes real stock movements.
 *
 * Usage:
 *   node tests/load/write-contention.js --workers 20 --writes 50 --contention spread
 */

const BASE = process.env.LOAD_BASE_URL || 'http://127.0.0.1:3000';
const EMAIL = process.env.LOAD_EMAIL || 'load@test.local';
const PASSWORD = process.env.LOAD_PASSWORD || 'LoadTest@123456';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv);
const WORKERS = Number(args.workers || process.env.LOAD_WORKERS || 20);
const WRITES = Number(args.writes || process.env.LOAD_WRITES || 50);
const CONTENTION = String(args.contention || 'spread').toLowerCase();

const target = new URL(BASE);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
    && process.env.ALLOW_REMOTE_LOAD_TEST !== '1') {
  throw new Error('Remote load testing is blocked: this writes real stock movements. '
    + 'Use localhost, or set ALLOW_REMOTE_LOAD_TEST=1 deliberately against a disposable target.');
}
if (!['same', 'spread'].includes(CONTENTION)) {
  throw new Error("--contention must be 'same' or 'spread'");
}
if (!Number.isInteger(WORKERS) || WORKERS < 1 || WORKERS > 500) {
  throw new Error('--workers must be an integer between 1 and 500');
}
if (!Number.isInteger(WRITES) || WRITES < 1 || WRITES > 5000) {
  throw new Error('--writes must be an integer between 1 and 5000');
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* empty or non-JSON body */ }
  return { status: res.status, body: payload };
}

/**
 * Classify a failure. SQLITE_BUSY is the signal that matters: it means the
 * database gave up waiting for the write lock, which is the ceiling this test
 * exists to find. Everything else is a bug or a setup problem, and lumping them
 * together would hide the one number worth reporting.
 */
function classify(status, body) {
  const text = JSON.stringify(body || '');
  if (/SQLITE_BUSY|database is locked/i.test(text)) return 'SQLITE_BUSY';
  // 429 means the API rate limiter refused the request — the application
  // protecting itself, NOT the database failing. Conflating the two is the
  // worst misreading this test could produce: it would report a working
  // safeguard as a capacity ceiling and send you off migrating a database that
  // was never stressed. Counted separately and excluded from the database
  // verdict; raise API_RATE_LIMIT on the target to measure past it.
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server_error';
  if (status >= 400) return `http_${status}`;
  return 'ok';
}

async function main() {
  console.log(`\n  Write-contention load test`);
  console.log(`  Target      : ${BASE}`);
  console.log(`  Workers     : ${WORKERS}`);
  console.log(`  Writes each : ${WRITES}  (${(WORKERS * WRITES).toLocaleString()} total)`);
  console.log(`  Contention  : ${CONTENTION}\n`);

  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (!login.body || !login.body.token) {
    throw new Error(`Login failed (${login.status}). Seed a load database first with tests/load/seed-scale.js.`);
  }
  const token = login.body.token;

  const mats = await call('/api/materials?limit=100', { token });
  const locs = await call('/api/locations/all', { token });
  const materials = (mats.body && mats.body.materials) || [];
  const locations = (locs.body && locs.body.locations) || [];
  if (!materials.length || !locations.length) {
    throw new Error('No materials or locations available on the target.');
  }
  console.log(`  Dataset     : ${materials.length} materials sampled, ${locations.length} locations\n`);

  const latencies = [];
  const outcomes = new Map();
  const record = (key) => outcomes.set(key, (outcomes.get(key) || 0) + 1);

  const started = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, worker) => {
    for (let i = 0; i < WRITES; i += 1) {
      // 'same' pins every worker to one row so the write lock is always contended.
      // 'spread' gives each worker its own slice of the catalogue.
      const material = CONTENTION === 'same'
        ? materials[0]
        : materials[(worker * WRITES + i) % materials.length];
      const location = CONTENTION === 'same'
        ? locations[0]
        : locations[worker % locations.length];

      const t0 = Date.now();
      let result;
      try {
        result = await call('/api/stock/in', {
          method: 'POST',
          token,
          body: { material_id: material.id, location_id: location.id, quantity: 1, notes: 'load test' },
        });
      } catch (error) {
        latencies.push(Date.now() - t0);
        record(`transport:${error.code || error.message}`);
        continue;
      }
      latencies.push(Date.now() - t0);
      record(classify(result.status, result.body));
    }
  }));
  const elapsedMs = Date.now() - started;

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;
  const ok = outcomes.get('ok') || 0;
  const busy = outcomes.get('SQLITE_BUSY') || 0;
  const throttled = outcomes.get('rate_limited') || 0;
  // The database was only actually asked to do the work that got past the rate
  // limiter, so that is the population the verdict is about.
  const reachedDb = total - throttled;
  const otherErrors = total - ok - busy - throttled;

  console.log('  ─────────────────────────────────────────────');
  console.log(`  Throughput  : ${(total / (elapsedMs / 1000)).toFixed(1)} req/sec  (${(elapsedMs / 1000).toFixed(1)}s)`);
  console.log(`  Latency p50 : ${percentile(sorted, 0.5)} ms`);
  console.log(`  Latency p95 : ${percentile(sorted, 0.95)} ms`);
  console.log(`  Latency p99 : ${percentile(sorted, 0.99)} ms      <- the number that matters`);
  console.log(`  Latency max : ${sorted[sorted.length - 1]} ms`);
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Succeeded   : ${ok.toLocaleString()} / ${total.toLocaleString()}`);
  console.log(`  SQLITE_BUSY : ${busy.toLocaleString()}      <- the database ceiling, when non-zero`);
  if (throttled > 0) {
    console.log(`  Rate limited: ${throttled.toLocaleString()}      <- the API limiter, NOT the database`);
  }
  if (otherErrors > 0) {
    console.log(`  Other errors: ${otherErrors.toLocaleString()}`);
    for (const [key, count] of outcomes) {
      if (!['ok', 'SQLITE_BUSY', 'rate_limited'].includes(key)) console.log(`      ${key}: ${count}`);
    }
  }
  console.log('  ─────────────────────────────────────────────\n');

  // Deliberately no pass/fail threshold. This tool exists to produce a number
  // for a capacity decision, not to gate a build — a threshold here would
  // invite tuning the test until it passes instead of reading what it says.
  if (throttled > total * 0.1) {
    console.log(`  Read: ${throttled.toLocaleString()} of ${total.toLocaleString()} requests never reached the database —`);
    console.log('  the API rate limiter refused them. This run measured the limiter, not SQLite.');
    console.log('  Raise API_RATE_LIMIT on the target and re-run to find the database ceiling.\n');
  } else if (busy > 0) {
    console.log(`  Read: the write lock was exhausted ${busy} time(s) at ${WORKERS} concurrent writers.`);
    console.log('  That is this configuration\'s database ceiling.\n');
  } else if (percentile(sorted, 0.99) > 1000) {
    console.log(`  Read: no failures, but p99 of ${percentile(sorted, 0.99)}ms means writers are queueing.`);
    console.log('  Approaching the ceiling; the next step up in concurrency is likely to fail.\n');
  } else {
    console.log(`  Read: ${WORKERS} concurrent writers sustained, ${reachedDb.toLocaleString()} writes reached the`);
    console.log('  database, no lock exhaustion.\n');
  }
}

main().catch((error) => {
  console.error(`\n  ✗ ${error.message}\n`);
  process.exit(1);
});
