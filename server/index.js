/**
 * WMS server entry point.
 * Serves the JSON API under /api and the static frontend from /public.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');

// Ensure the schema exists before handling requests (idempotent).
require('./db/migrate');

// Startup database identity + first-run seed policy.
//
// The identity line exists because "which file is the app actually using?" was
// the decisive question in INC-2026-07-25-01 and is an explicit ask in issue
// #40. Logging it every boot makes a mispointed DB_PATH or an unexpectedly
// empty database visible immediately, instead of being inferred later from
// "the admin password reset itself".
//
// Auto-seed is OPT-IN (ALLOW_AUTO_SEED=1). See server/services/firstRunSeed.js
// for why the previous NODE_ENV-keyed guard was unsafe.
try {
  const fs = require('fs');
  const db = require('./db/connection');
  const { shouldAutoSeed, emptyDatabaseWarning } = require('./services/firstRunSeed');

  const { n: userCount } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  let migrationCount = 0;
  try {
    migrationCount = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  } catch { /* table may not exist on a brand-new file */ }
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(config.dbPath).size; } catch { /* not yet created */ }

  console.log(`[db] path=${config.dbPath} size=${sizeBytes}B users=${userCount} migrations=${migrationCount}`);

  if (userCount === 0) {
    const decision = shouldAutoSeed(process.env);
    if (decision.allowed) {
      console.log(`Empty database detected — running first-run seed (${decision.reason})…`);
      require('./db/seed').seed();
    } else {
      console.warn(emptyDatabaseWarning(config.dbPath, decision.reason));
    }
  }
} catch (err) {
  console.error('Startup database check failed:', err.message);
}

const app = express();

// Behind Hostinger's (or any) reverse proxy, trust the first proxy hop so
// req.ip / X-Forwarded-For reflect the real client — the login rate limiter
// keys on it, and it keeps request logging accurate. Harmless in local dev.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],           // all JS is served from /js and /vendor
      scriptSrcAttr: ["'none'"],       // no inline event handlers anywhere
      styleSrc: ["'self'", "'unsafe-inline'"], // pages use inline style attributes
      imgSrc: ["'self'", 'data:', 'blob:'],    // QR previews are data:/blob: images
      objectSrc: ["'none'"],
      // Not upgrading requests keeps plain-HTTP localhost testing working;
      // TLS termination is the reverse proxy's job in production.
      upgradeInsecureRequests: null,
    },
  },
}));

// The bulk CSV upload screens send up to ~2,000 rows in one JSON body, which
// exceeds express.json()'s default 100 KB cap.
app.use(express.json({ limit: '2mb' }));

// Coarse global rate limit per client IP across the whole API surface
// (complements the stricter per-email login limiter). Generous by default;
// tune with API_RATE_LIMIT / API_RATE_WINDOW_MS, disable with API_RATE_LIMIT=0.
const { apiRateLimit } = require('./middleware/apiRateLimit');
app.use('/api', apiRateLimit);

// Lightweight structured request logging for API calls (skip health + static).
// Set LOG_REQUESTS=0 to silence. One line per request on response finish.
if (process.env.LOG_REQUESTS !== '0') {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') || req.path === '/api') return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const uid = req.user ? req.user.id : '-';
      console.log(`[${new Date().toISOString()}] ${req.method} ${res.statusCode} ${ms.toFixed(0)}ms ${req.originalUrl} user=${uid} ip=${req.ip}`);
    });
    next();
  });
}

// Unauthenticated health check — handy for verifying the server is reachable
// through a proxy/port-forward (e.g. GitHub Codespaces). A 200 here means the
// app is up; a 401 on the site root then points at the proxy, not the app.
app.get('/healthz', (req, res) => res.json({ status: 'ok', service: 'wms' }));

// Malformed JSON in a request body is a client error, not a server error.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  next(err);
});

// --- API routes -----------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/dashboard', require('./routes/dashboard'));

// --- Material Request → Goods Issue workflow ------------------------------
app.use('/api/meta', require('./routes/meta'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/erp-operator', require('./routes/erpOperator'));
app.use('/api/warehouse', require('./routes/warehouse'));
app.use('/api/picking', require('./routes/picking'));
app.use('/api/gi', require('./routes/gi'));
app.use('/api/receiving', require('./routes/receiving'));
app.use('/api/master', require('./routes/masterdata'));
// Mount the safety-scoped reconciliation endpoint before the general import router.
app.use('/api/import/stock/reconcile-dates', require('./routes/openingStockReconcile'));
app.use('/api/import', require('./routes/import'));
app.use('/api/analytical-attestations', require('./routes/analyticalAttestations'));
app.use('/api/export', require('./routes/export'));
app.use('/api/cycle-count', require('./routes/cycleCount'));
app.use('/api/reallocation', require('./routes/reallocation'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/shipping', require('./routes/shipping'));
app.use('/api/subcontractor', require('./routes/subcontractors'));
app.use('/api/admin', require('./routes/admin'));
// Attachment routes live under /api (paths: /requests/:id/attachments, /attachments/:aid/...).
app.use('/api', require('./routes/attachments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/kpi', require('./routes/kpi'));
app.use('/api/analytics', require('./routes/analytics'));

// --- Static frontend ------------------------------------------------------
const publicRoot = path.join(__dirname, '..', 'public');
// Hostinger's edge cache has been observed serving stale same-path assets even
// with max-age=0 and query-string cache busting. A release-scoped URL path
// keeps the browser/CDN cache key distinct without copying or mutating assets.
app.use('/release-assets/:release', (req, res, next) => {
  const relativeAsset = req.path.replace(/^\//, '');
  if (!relativeAsset || relativeAsset.includes('..') || relativeAsset.startsWith('release-assets/')) return next();
  return express.static(publicRoot)(req, res, next);
});
app.use(express.static(publicRoot));
// Chart.js is served from node_modules so the app has no CDN dependency.
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

// Unknown API routes -> JSON 404 (instead of the SPA page).
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// Everything else -> SPA entry point (any method, any path).
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Central error handler: never leak stack traces to clients. Routes/services
// deliberately throw with a `.status` (400/403/409/...) and a user-safe
// `.message` for validation and workflow errors (see server/services/requests.js,
// picking.js, etc.) — those are surfaced as-is; anything without a `.status`
// is a genuinely unexpected exception and stays a generic 500.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status < 500 ? err.message : 'Internal server error.' });
});

// Background scheduler: reminder/escalation sweep for unaccepted picking tasks
// and release of timed-out stock reservations. Runs every 60s; both are also
// exposed as on-demand endpoints for deterministic testing.
//
// Set SCHEDULER_ENABLED=0 to turn the in-process scheduler off entirely (e.g.
// when a dedicated worker owns it). When several app processes are live (PM2
// cluster, overlapping deploy), a DB lease keyed per job ensures only ONE of
// them runs each tick — otherwise every process would double-process the same
// rows every minute.
if (process.env.SCHEDULER_ENABLED !== '0') {
  const { sweepReminders } = require('./routes/picking');
  const { sweepReservations } = require('./services/requests');
  const { pruneRetention } = require('./services/retention');
  const { acquireTick } = require('./services/scheduler');
  setInterval(() => {
    try {
      if (acquireTick('reminders')) sweepReminders();
    } catch (err) { console.error('Reminder sweep error:', err); }
    try {
      if (acquireTick('reservations')) sweepReservations();
    } catch (err) { console.error('Reservation sweep error:', err); }
  }, 60 * 1000).unref();

  // Daily data-retention sweep (O-3): prune aged operational logs when
  // RETENTION_DAYS is set. The audit trail is never touched. A one-hour lease
  // keeps it single-runner across instances.
  if (Number(process.env.RETENTION_DAYS) > 0) {
    const runPrune = () => {
      try {
        if (acquireTick('retention', 3600000)) {
          const r = pruneRetention();
          if (r.total) console.log(`Retention: pruned ${r.total} aged log row(s).`);
        }
      } catch (err) { console.error('Retention sweep error:', err); }
    };
    runPrune();
    setInterval(runPrune, 24 * 60 * 60 * 1000).unref();
  }
}

// Optional automated daily database backup (enable by setting BACKUP_DIR).
if (process.env.BACKUP_DIR) {
  const { backup } = require('./services/backup');
  const runBackup = () => backup().then((d) => console.log(`Backup written: ${d}`))
    .catch((e) => console.error('Backup failed:', e.message));
  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000).unref();
}

// Bind to 0.0.0.0 so containerized/port-forwarded environments (Docker,
// GitHub Codespaces) can reach and auto-detect the port.
app.listen(config.port, '0.0.0.0', () => {
  console.log(`WMS server running on http://0.0.0.0:${config.port} (health: /healthz)`);
});