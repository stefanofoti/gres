/**
 * server.js — HomeApp entry point
 *
 * Starts an Express HTTP server that:
 *   - Serves the static frontend (./frontend)
 *   - Exposes REST API routes for Home Assistant, Jellyfin, and Proxmox
 *   - Logs every request/response with a unique requestId via Pino
 *
 * Environment variables (see .env):
 *   PORT      — TCP port to listen on (default: 3000)
 *   LOG_LEVEL — Pino log level: trace|debug|info|warn|error (default: info)
 */

'use strict';

require('dotenv').config();

var express       = require('express');
var cors          = require('cors');
var path          = require('path');
var logger        = require('./logger');
var requestLogger = require('./middleware/requestLogger');

var app  = express();
var PORT = process.env.PORT || 3000;

/* ── Global middleware ──────────────────────────────────
   Order matters: body parsing must come before route
   handlers; request logging should wrap everything.    */
app.use(cors());
app.use(express.json());

/* Structured request/response logging — attaches req.log
   (a pino child logger with a unique requestId) to every
   incoming request.                                    */
app.use(requestLogger);

/* Serve compiled/static frontend assets from ./frontend */
app.use(express.static(path.join(__dirname, '../frontend')));

/* ── API routes ─────────────────────────────────────────
   Each sub-router is isolated in its own file under
   ./routes/ and mounts on a dedicated path prefix.    */

/* Home Assistant — device states, service calls */
app.use('/api/ha', require('./routes/homeassistant'));

/* Jellyfin — library browsing, image proxy */
app.use('/api/jf', require('./routes/jellyfin'));

/* Proxmox VE — cluster nodes, VMs, RRD stats, actions */
app.use('/api/px', require('./routes/proxmox'));

/* Meteo — Open-Meteo geocoding + forecast proxy */
app.use('/api/weather', require('./routes/weather'));

/* Markets — Yahoo Finance search, quotes, charts */
app.use('/api/markets', require('./routes/markets'));

/* Settings — persistent key/value store (JSON file) */
app.use('/api/settings', require('./routes/settings'));

/* ── SPA fallback ───────────────────────────────────────
   Any non-API path returns index.html so that the
   single-page app can handle client-side navigation.  */
app.get('*', function (req, res) {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/* ── Global error handler ───────────────────────────────
   Catches any error passed to next(err) in route
   handlers and returns a structured JSON response.    */
app.use(function (err, req, res, next) { // eslint-disable-line no-unused-vars
  var log = req.log || logger;
  log.error({ err: err }, 'unhandled error');
  res.status(500).json({ error: err.message || 'Internal server error' });
});

/* ── Start server ───────────────────────────────────────  */
app.listen(PORT, function () {
  logger.info({ port: PORT, logLevel: process.env.LOG_LEVEL || 'info' },
    'HomeApp server started');
});
