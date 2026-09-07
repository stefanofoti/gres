/**
 * server.js — HomeApp entry point
 *
 * Starts an Express HTTP server that:
 *   - Serves the static frontend (./frontend)
 *   - Exposes REST API routes for Home Assistant, Jellyfin, and Proxmox
 *   - Logs every request/response with a unique requestId via Pino
 *
 * Environment variables (see .env):
 *   PORT                    — TCP port to listen on (default: 3000)
 *   LOG_LEVEL               — Pino log level: trace|debug|info|warn|error (default: info)
 *   HA_REFRESH_INTERVAL_SEC — Smart Home auto-refresh interval in seconds (default: 15, 0 = off)
 *   SETTINGS_PIN            — Numeric PIN protecting settings + credentials (unset = no protection)
 *   DEVICES_PIN             — Numeric PIN protecting locked smart devices (unset = no protection)
 *   SERVER_PIN              — Numeric PIN protecting Proxmox power actions (unset = no protection)
 *   SESSION_SECRET          — HMAC key for session cookies (unset = generated once into data/)
 *   TRUST_PROXY             — hop count or Express trust-proxy value when gres
 *                             runs behind a reverse proxy (unset = trust nothing)
 */

'use strict';

require('dotenv').config();

var express       = require('express');
var path          = require('path');
var rateLimit     = require('express-rate-limit');
var logger        = require('./logger');
var requestLogger = require('./middleware/requestLogger');
var session       = require('./middleware/session');

var app  = express();
var PORT = process.env.PORT || 3000;

/* ── Client IP resolution ───────────────────────────────
   The rate limiter and the PIN lockout both key on req.ip.
   Behind a reverse proxy that is the proxy's address unless
   Express is told to trust the forwarding header, which
   would make both treat every client as one caller.

   Opt-in rather than automatic: trusting X-Forwarded-For
   when there is no proxy in front lets anyone set their own
   apparent IP and walk straight past both protections.
   Set TRUST_PROXY=1 for a single reverse proxy.          */
if (process.env.TRUST_PROXY) {
  var rawTrust = String(process.env.TRUST_PROXY).trim();
  var hops     = parseInt(rawTrust, 10);
  app.set('trust proxy', String(hops) === rawTrust ? hops : rawTrust);
}

/* ── Global middleware ──────────────────────────────────
   Order matters: body parsing must come before route
   handlers; request logging should wrap everything.

   No CORS. The frontend is served by this same process from
   this same origin, so it has never needed it — while the
   wildcard it used to send (Access-Control-Allow-Origin: *)
   let any page open in any browser on the network read this
   API and issue device and VM commands cross-origin.     */
app.use(express.json());

/* Structured request/response logging — attaches req.log
   (a pino child logger with a unique requestId) to every
   incoming request.                                    */
app.use(requestLogger);

/* Serve compiled/static frontend assets from ./frontend */
app.use(express.static(path.join(__dirname, '../frontend')));

/* ── API middleware ─────────────────────────────────────
   Everything below applies to /api only, so static asset
   requests pay none of it.                             */

/* Makes req.scopes available to handlers that need a
   conditional check rather than a hard gate. */
app.use('/api', session.attachSession);

/* Throttle state-changing calls. Every mutating route is
   also scope-gated, but a PIN is only as strong as the
   number of guesses behind it, and several of these fan out
   to upstream services. */
var writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit:    60,
  standardHeaders: true,
  legacyHeaders:   false,
  /* Reads are cheap and the wall panel makes a lot of them. */
  skip: function (req) { return req.method === 'GET' || req.method === 'HEAD'; },
  message: { error: 'Too many requests. Slow down.' }
});
app.use('/api', writeLimiter);

/* Tighter still on PIN verification. auth.js has its own
   per-IP lockout on failures; this bounds the request rate
   regardless of outcome. */
app.use('/api/auth', rateLimit({
  windowMs: 60 * 1000,
  limit:    20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many attempts. Try again later.' }
}));

/* The two endpoints that fan out to several upstream calls
   each. Both are already cached server-side; this bounds a
   caller who ignores that. */
var summaryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit:    120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Slow down.' }
});
app.use('/api/px/home-summary', summaryLimiter);
app.use('/api/jf/home-summary', summaryLimiter);

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

/* Runtime config — read-only env-backed values for the frontend */
app.use('/api/config', require('./routes/config'));

/* Auth — numeric PIN gate for the Settings tab */
app.use('/api/auth', require('./routes/auth'));

/* ── Unmatched API paths ────────────────────────────────
   Must come before the SPA fallback. Without it a mistyped
   or removed /api route falls through to index.html and
   returns HTML with HTTP 200; the client's JSON.parse then
   fails and the user sees "Invalid response", which reads
   as a backend fault rather than a wrong URL. That is how
   the /api/proxmox feature-gate bug stayed invisible.   */
app.use('/api', function (req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

/* ── SPA fallback ───────────────────────────────────────
   Any non-API path returns index.html so that the
   single-page app can handle client-side navigation.  */
app.get('/*splat', function (req, res) {
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
