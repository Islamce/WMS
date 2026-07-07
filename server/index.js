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

// --- API routes -----------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/dashboard', require('./routes/dashboard'));

// --- Static frontend ------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
// Chart.js is served from node_modules so the app has no CDN dependency.
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

// Unknown API routes -> JSON 404 (instead of the SPA page).
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// Everything else -> SPA entry point.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Central error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(config.port, () => {
  console.log(`WMS server running on http://localhost:${config.port}`);
});
