/**
 * WMS server entry point.
 * Serves the JSON API under /api and the static frontend from /public.
 */
const path = require('path');
const express = require('express');
const config = require('./config');

// Ensure the schema exists before handling requests (idempotent).
require('./db/migrate');

const app = express();

app.use(express.json());

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
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/kpi', require('./routes/kpi'));

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

// Background scheduler: reminder/escalation sweep for unaccepted picking tasks.
// Runs every 60s; the same logic is exposed via POST /api/picking/sweep for
// on-demand runs and deterministic testing.
const { sweepReminders } = require('./routes/picking');
setInterval(() => {
  try { sweepReminders(); } catch (err) { console.error('Reminder sweep error:', err); }
}, 60 * 1000).unref();

// Bind to 0.0.0.0 so containerized/port-forwarded environments (Docker,
// GitHub Codespaces) can reach and auto-detect the port.
app.listen(config.port, '0.0.0.0', () => {
  console.log(`WMS server running on http://0.0.0.0:${config.port} (health: /healthz)`);
});
