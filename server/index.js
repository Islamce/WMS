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

// First-run bootstrap: on an empty database — e.g. a fresh git-connected
// deploy (Hostinger Web Apps, etc.) with no shell to run `npm run seed` — create
// the default admin, roles/permissions, movement types, warehouses/bins and demo
// data so the app is usable immediately. No-op once any user exists; the seed is
// idempotent. Disable by setting SKIP_AUTO_SEED=1.
if (process.env.SKIP_AUTO_SEED !== '1') {
  try {
    const db = require('./db/connection');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (n === 0) {
      console.log('Empty database detected — running first-run seed…');
      require('./db/seed').seed();
    }
  } catch (err) {
    console.error('First-run seed check failed:', err.message);
  }
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
app.use('/api/import', require('./routes/import'));
app.use('/api/export', require('./routes/export'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/kpi', require('./routes/kpi'));
app.use('/api/analytics', require('./routes/analytics'));

// --- Static frontend ------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
// Chart.js is served from node_modules so the app has no CDN dependency.
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

// Unknown API routes -> JSON 404 (instead of the SPA page).
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// Everything else -> SPA entry point (any method, any path).
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Central error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error.' });
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
  const { acquireTick } = require('./services/scheduler');
  setInterval(() => {
    try {
      if (acquireTick('reminders')) sweepReminders();
    } catch (err) { console.error('Reminder sweep error:', err); }
    try {
      if (acquireTick('reservations')) sweepReservations();
    } catch (err) { console.error('Reservation sweep error:', err); }
  }, 60 * 1000).unref();
}

// Optional automated daily database backup (enable by setting BACKUP_DIR).
if (process.env.BACKUP_DIR) {
  const { backup } = require('../scripts/backup');
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
